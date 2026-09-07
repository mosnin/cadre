"""Authenticated computer RPC and screen routing for one isolated team VM."""
import hmac
import json
import math
import socket
import os
import re
import subprocess
from http.server import ThreadingHTTPServer
from urllib.parse import urlsplit
from screen_gateway import Handler as ScreenHandler

MAX_BODY = 20 * 1024 * 1024

class Handler(ScreenHandler):
    def route_machine(self):
        match = re.match(r'^/m/([a-f0-9]{14,16})(/.*)$', self.path)
        if not match:
            self.send_error(404)
            return False
        if match[1] != os.environ.get('FLY_MACHINE_ID'):
            self.send_response(307)
            self.send_header('fly-replay', 'instance=' + match[1] + ';timeout=5s')
            self.end_headers()
            return False
        self.path = match[2]
        return True

    def do_GET(self):
        local_probe = self.client_address[0] == '127.0.0.1' and self.path == '/embed.html'
        if self.path != '/health' and not local_probe and not self.route_machine(): return
        if self.path == '/health':
            try:
                with socket.create_connection(('127.0.0.1', 6080), timeout=1): pass
            except OSError:
                self.send_error(503); return
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b'{"ok":true}')
            return
        # Shared readiness probe is local; external requests must name their VM.
        if self.client_address[0] == '127.0.0.1' and self.path == '/embed.html':
            super().do_GET()
        elif self.path.startswith('/'):
            super().do_GET()

    def do_POST(self):
        if not self.route_machine(): return
        if urlsplit(self.path).path != '/rpc':
            self.send_error(404); return
        expected = os.environ.get('CADRE_RPC_TOKEN', '')
        if not expected or not hmac.compare_digest(self.headers.get('Authorization', ''), 'Bearer ' + expected):
            self.send_error(403); return
        try:
            length = int(self.headers.get('Content-Length', '0'))
            if not 0 < length <= MAX_BODY: raise ValueError()
            self.connection.settimeout(30)
            body = self.rfile.read(length)
            if len(body) != length: raise ValueError()
            request = json.loads(body)
            if not isinstance(request, dict): raise ValueError()
            timeout = float(request.get('timeoutMs', 30000)) / 1000
            if not math.isfinite(timeout): raise ValueError()
            timeout = min(max(timeout, 1), 3600) + 15
        except (ValueError, TypeError, TimeoutError, OSError):
            self.send_error(400); return
        try:
            # Separate helpers retain the existing ownership, path and execution fences.
            result = subprocess.run(['python3','/opt/cadre/computer_rpc.py'], input=body,
                                    stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout)
            parsed = json.loads(result.stdout)
            response = json.dumps(parsed).encode()
        except (ValueError, subprocess.TimeoutExpired):
            response = b'{"error":"Computer operation did not complete"}'
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(response)))
        self.end_headers()
        self.wfile.write(response)

if __name__ == '__main__':
    ThreadingHTTPServer(('0.0.0.0', 8080), Handler).serve_forever()
