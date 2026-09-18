/* DOM helpers. Text always goes in as text, never as markup: CSV headers and
   file names are untrusted input. */

export const $ = (id) => document.getElementById(id);

export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key === "style") Object.assign(node.style, value);
    else if (key === "dataset") Object.assign(node.dataset, value);
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? "" : value);
  }
  for (const child of [].concat(children)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child);
  }
  return node;
}

const SVG_NS = "http://www.w3.org/2000/svg";

export function svg(tag, attrs = {}, children = []) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    node.setAttribute(key, value);
  }
  for (const child of [].concat(children)) if (child) node.append(child);
  return node;
}

export function svgText(attrs, content) {
  const node = svg("text", attrs);
  node.textContent = content;
  return node;
}

/** Announce to assistive technology. Results and state changes only — never a
    progress counter, which would flood the queue. */
export function announce(message) {
  const region = $("live");
  if (!region) return;
  region.textContent = "";
  // A fresh text node in the next frame makes repeated messages speak again.
  requestAnimationFrame(() => { region.textContent = message; });
}

export function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const anchor = el("a", { href: url, download: name });
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
