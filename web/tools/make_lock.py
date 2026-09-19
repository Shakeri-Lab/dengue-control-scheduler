# -*- coding: utf-8 -*-
"""Write web/model.lock.json: the model files the memoization was verified against.

The browser compares these hashes with the files it fetches and turns
memoization off if they differ, so a change to the model can never be served
from a cache that was reasoned about for the old code.

Run this only after tests/test_web_memo.py passes:

    uv run --python 3.12 --with numpy,scipy,pandas,pytest python -m pytest tests/test_web_memo.py
    uv run --python 3.12 python web/tools/make_lock.py
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, "web", "py"))

import driver  # noqa: E402


def main():
    lock = {
        "comment": "Memoization in web/py/driver.py is enabled only when the "
                   "model files hash to these values. Regenerate with "
                   "web/tools/make_lock.py after tests/test_web_memo.py passes.",
        "files": driver.model_hashes(ROOT),
    }
    path = os.path.join(ROOT, "web", "model.lock.json")
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(lock, handle, indent=2, sort_keys=True)
        handle.write("\n")
    print(f"wrote {path}")
    for name, digest in sorted(lock["files"].items()):
        print(f"  {digest[:12]}  {name}")


if __name__ == "__main__":
    main()
