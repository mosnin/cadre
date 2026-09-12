"""The only tunneled sandbox port. Static viewer assets are public; RFB requires a capability."""
import hmac
import http.client
import hashlib
import re
import screens
import json
import os
from pathlib import Path
import select
import socket
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit
import time

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_args): pass  # Never log screen capability URLs.
    def do_GET(self):
        parsed = urlsplit(self.path)
        query = parse_qs(parsed.query)
        upgrade = self.headers.get('Upgrade', '').lower() == 'websocket'
        key = query.get('screen', [''])[0]
        if key and not re.fullmatch('[a-f0-9]{64}',key):
            self.send_error(403); return
        key = key or screens.screen_key()
        state = screens.load(key)
        if upgrade and query.get('screen') and not state:
            self.send_error(403); return
        state = state or {'index':0}
        index = state['index']
        port = 6080 + index * 2 if upgrade else 6080
        shared_until = 0
        if upgrade:
            token = query.get('cadre_token', [''])[0]
            if query.get('view_only', ['true'])[0] == 'false' and query.get('shared_until'):
                try: shared_until = int(query['shared_until'][0])
                except (ValueError, TypeError):
                    self.send_error(403); return
                expected = ''
                root_token = os.environ.get('CADRE_SCREEN_VIEW_TOKEN', '')
                if root_token and time.time() < shared_until <= state.get('sharedUntil',0):
                    expected = hmac.new(root_token.encode(),f'shared:{key}:{shared_until}'.encode(),hashlib.sha256).hexdigest()
                port = 6081 + index * 2
            elif query.get('view_only', ['true'])[0] == 'false':
                try: state = screens.load(key) or {}
                except (FileNotFoundError, json.JSONDecodeError): state = {}
                expected = state.get('token', '') if state.get('expiresAt', 0) > time.time() else ''
                port = 6081 + index * 2
            else:
                expected = os.environ.get('CADRE_SCREEN_VIEW_TOKEN', '')
                if query.get('screen'):
                    expected = hmac.new(expected.encode(), key.encode(), hashlib.sha256).hexdigest()
            if not expected or not hmac.compare_digest(token, expected):
                self.send_error(403); return
        elif parsed.path == '/websockify':
            self.send_error(403); return
        if not upgrade:
            self.serve_asset(parsed.path or '/')
            return
        try:
            with socket.create_connection(('127.0.0.1', port), timeout=10) as upstream:
                lines = [f'GET {parsed.path or "/"} HTTP/1.1', f'Host: 127.0.0.1:{port}']
                for header, value in self.headers.items():
                    if header.lower() not in ('host', 'authorization', 'cookie'):
                        lines.append(f'{header}: {value}')
                upstream.sendall(('\r\n'.join(lines) + '\r\n\r\n').encode())
                upstream.settimeout(None)
                self.connection.settimeout(None)
                deadline = time.monotonic() + 3600
                last_shared_touch = 0.0
                while time.monotonic() < deadline:
                    ready, _, _ = select.select([self.connection, upstream], [], [], 5)
                    for source in ready:
                        data = source.recv(65536)
                        if not data: return
                        (upstream if source is self.connection else self.connection).sendall(data)
                    if upgrade and query.get('view_only', ['true'])[0] == 'false':
                        try: current = screens.load(key) or {}
                        except (FileNotFoundError, json.JSONDecodeError): return
                        if shared_until:
                            if current.get('index') != index or not time.time() < shared_until <= current.get('sharedUntil',0): return
                            if time.monotonic()-last_shared_touch >= 10:
                                screens.touch_shared(key,index,shared_until)
                                last_shared_touch=time.monotonic()
                        elif current.get('token') != token or current.get('expiresAt', 0) <= time.time(): return
        except (OSError, TimeoutError): return

    def serve_asset(self, path):
        # HTTP asset requests must each return through machine routing. A raw
        # keep-alive tunnel forwards later /m/... requests without stripping the
        # route and can bypass the checks on a later WebSocket upgrade.
        upstream = http.client.HTTPConnection('127.0.0.1', 6080, timeout=10)
        self.close_connection = True
        try:
            headers = {key: value for key, value in self.headers.items()
                       if key.lower() not in ('host', 'authorization', 'cookie',
                           'connection', 'upgrade', 'content-length', 'transfer-encoding', 'expect')}
            headers['Connection'] = 'close'
            upstream.request('GET', path, headers=headers)
            response = upstream.getresponse()
            self.send_response(response.status)
            for key, value in response.getheaders():
                if key.lower() not in ('connection', 'transfer-encoding', 'keep-alive', 'server', 'date'):
                    self.send_header(key, value)
            self.send_header('Connection', 'close')
            self.end_headers()
            while data := response.read(65536):
                self.wfile.write(data)
        except (OSError, http.client.HTTPException):
            return
        finally:
            upstream.close()

if __name__ == '__main__':
    ThreadingHTTPServer(('0.0.0.0', 8080), Handler).serve_forever()
