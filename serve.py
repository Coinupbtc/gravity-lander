#!/usr/bin/env python3
"""apollo-descent-host: static host for the Gravity Lander game on LAN.
Binds 0.0.0.0 so the user's iPhone (192.168.50.x) can open the game.
Long cache: only when the client this is a dev game; send no-store so the
iPhone always re-fetches the latest index.html (avoids stale-cache white
screens), but allow sub-resource caching with cache-busting ?v= querystrings.

Tailscale serves this under https://…/apollo/ (prefix stripped before we see
the request). index.html itself redirects /apollo → /apollo/ and sets <base>
so relative script URLs never escape to the root proxy (that was the real
iPhone white-screen: /apollo without slash → /three.min.js → 404 on :8060).
"""
import http.server, os, socketserver, sys, threading, mimetypes

ROOT = os.path.dirname(os.path.abspath(__file__))
PORT = int(os.environ.get("APOLLO_PORT", "8070"))
HOST = "0.0.0.0"  # LAN-visible

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)
    def end_headers(self):
        # index.html: no-store so edits/cache-bust always reach the iPhone.
        if self.path in ("/", "/index.html"):
            self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
            self.send_header("Pragma", "no-cache")
            self.send_header("Expires", "0")
        else:
            self.send_header("Cache-Control", "no-cache")
        super().end_headers()
    def log_message(self, *a):
        pass  # quiet

class Threaded(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True

def main():
    httpd = Threaded((HOST, PORT), Handler)
    print(f"apollo-descent host on http://{HOST}:{PORT}/ (root={ROOT})", flush=True)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        httpd.server_close()

if __name__ == "__main__":
    main()
