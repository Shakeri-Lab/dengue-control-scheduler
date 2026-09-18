/* Worker client: one request in flight, one pending slot, latest wins.

   A Python solve cannot be interrupted, so a superseded plan run is left to
   finish — its warm-up and no-control solutions are what make the next run
   fast, and throwing the worker away would discard them. Only a superseded
   climate load is worth terminating, since it has nothing cached yet. */

const PROTOCOL = 2;
const HEARTBEAT_MS = 25000;
const LRU_LIMIT = 16;

export class Engine {
  constructor(workerUrl, handlers) {
    this.workerUrl = workerUrl;
    this.handlers = handlers;          // {onBoot, onReady, onProgress, onResult, onClimate, onFatal}
    this.nextId = 1;
    this.inFlight = null;              // {id, request, key, startedAt}
    this.queued = null;                // {request, key} — replaced, never stacked
    this.cache = new Map();            // key -> result payload
    this.ready = false;
    this.bootFiles = 0;
    this.lastHeard = 0;
    this.restarted = false;
    this.spawn();
    setInterval(() => this.checkHeartbeat(), 5000);
  }

  spawn() {
    this.worker = new Worker(this.workerUrl);
    this.worker.onmessage = (event) => this.receive(event.data);
    this.worker.onerror = (event) =>
      this.handlers.onFatal(event.message || "worker error");
  }

  receive(message) {
    this.lastHeard = performance.now();
    switch (message.type) {
      case "boot":
        this.bootFiles += 1;
        this.handlers.onBoot({ ...message, done: this.bootFiles });
        break;
      case "ready":
        this.ready = true;
        this.handlers.onReady(message);
        this.pump();
        break;
      case "climate":
        if (this.isCurrent(message.id)) {
          this.inFlight = null;
          this.handlers.onClimate(message.payload);
        }
        this.pump();
        break;
      case "progress":
        if (this.isCurrent(message.id)) this.handlers.onProgress(message);
        break;
      case "result": {
        const entry = this.inFlight;
        if (entry && entry.id === message.id) {
          this.inFlight = null;
          if (message.payload.ok) this.remember(entry.key, message.payload);
          // A result is only current if nothing newer is queued for a
          // different plan; otherwise it is cached and quietly dropped.
          const superseded = this.queued && this.queued.key !== entry.key;
          if (!superseded) this.handlers.onResult(message.payload, entry.key);
        }
        this.pump();
        break;
      }
      case "fatal":
        this.ready = false;
        this.handlers.onFatal(message.message);
        break;
      default:
        break;
    }
  }

  isCurrent(id) {
    return this.inFlight && this.inFlight.id === id;
  }

  remember(key, payload) {
    this.cache.delete(key);
    this.cache.set(key, payload);
    while (this.cache.size > LRU_LIMIT) {
      this.cache.delete(this.cache.keys().next().value);
    }
  }

  /** Cached result for a key, if this session has already computed it. */
  peek(key) {
    return this.cache.get(key) || null;
  }

  submit(request, key) {
    if (request.type === "climate" && this.inFlight
        && this.inFlight.request.type === "climate") {
      // Nothing cached is at stake; drop the stale load immediately.
      this.worker.terminate();
      this.ready = false;
      this.inFlight = null;
      this.bootFiles = 0;
      this.spawn();
    }
    this.queued = { request, key };
    this.pump();
  }

  pump() {
    if (!this.ready || this.inFlight || !this.queued) return;
    const { request, key } = this.queued;
    this.queued = null;
    const id = this.nextId;
    this.nextId += 1;
    this.inFlight = { id, request, key, startedAt: performance.now() };
    this.lastHeard = performance.now();
    this.worker.postMessage({ v: PROTOCOL, id, ...request });
  }

  checkHeartbeat() {
    if (!this.inFlight || !this.lastHeard) return;
    if (performance.now() - this.lastHeard < HEARTBEAT_MS) return;
    const stalled = this.inFlight;
    this.worker.terminate();
    this.ready = false;
    this.inFlight = null;
    this.bootFiles = 0;
    this.spawn();
    if (!this.restarted) {
      this.restarted = true;        // resubmit once, then report the failure
      this.submit(stalled.request, stalled.key);
    } else {
      this.handlers.onFatal("out of memory");
    }
  }
}
