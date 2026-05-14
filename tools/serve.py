#!/usr/bin/env python3
"""Tiny static file server that disables all caching.

Use this instead of `python3 -m http.server` while developing — Chrome caches
ES modules very aggressively (often even Cmd+Shift+R isn't enough), which
makes JS edits appear not to take effect.

Usage:  python3 tools/serve.py [port]
"""
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()


class ReusableServer(ThreadingHTTPServer):
    allow_reuse_address = True


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    try:
        httpd = ReusableServer(("", port), NoCacheHandler)
    except OSError as e:
        print(f"Could not bind port {port}: {e}", file=sys.stderr)
        print(f"Hint: another server is using it. Free it with:\n"
              f"  lsof -ti tcp:{port} | xargs kill -9", file=sys.stderr)
        sys.exit(1)
    print(f"Serving on http://localhost:{port}  (no-cache)")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
