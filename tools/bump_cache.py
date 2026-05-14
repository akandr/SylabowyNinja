#!/usr/bin/env python3
"""Bump the ?v=N cache-buster on every relative ES module import in src/.

Why: browsers (especially Chrome) aggressively cache modules loaded via
`import ... from './foo.js'`, even when the dev server sends `Cache-Control:
no-store`. The reliable workaround is to put a query string on the module
specifier itself; bumping the number forces a fresh fetch.

Usage:
  python3 tools/bump_cache.py            # auto-bump to (current max + 1)
  python3 tools/bump_cache.py 42         # set every import to ?v=42

Also updates index.html's <script type="module" src="src/main.js?v=N">.
"""
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "src"
INDEX = ROOT / "index.html"

IMPORT_RE = re.compile(r"from\s+'\./([A-Za-z0-9_-]+)\.js(\?v=(\d+))?'")
SCRIPT_RE = re.compile(r'(<script\s+type="module"\s+src="src/main\.js)(\?v=\d+)?(")')


def find_current_max() -> int:
    cur = 0
    for f in list(SRC.glob("*.js")) + [INDEX]:
        for m in re.finditer(r"\?v=(\d+)", f.read_text()):
            cur = max(cur, int(m.group(1)))
    return cur


def main() -> None:
    if len(sys.argv) > 1:
        v = int(sys.argv[1])
    else:
        v = find_current_max() + 1

    changed = []
    for f in SRC.glob("*.js"):
        s = f.read_text()
        new = IMPORT_RE.sub(lambda m: f"from './{m.group(1)}.js?v={v}'", s)
        if new != s:
            f.write_text(new)
            changed.append(f.relative_to(ROOT))

    s = INDEX.read_text()
    new = SCRIPT_RE.sub(lambda m: f'{m.group(1)}?v={v}{m.group(3)}', s)
    if new != s:
        INDEX.write_text(new)
        changed.append(INDEX.relative_to(ROOT))

    print(f"bumped to ?v={v}")
    for p in changed:
        print(f"  updated {p}")
    if not changed:
        print("  (no files needed updating)")


if __name__ == "__main__":
    main()
