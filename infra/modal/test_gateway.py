import hashlib
import hmac
import time
import unittest
from unittest.mock import MagicMock, patch
import screen_gateway as gateway
import screens

class GatewayTest(unittest.TestCase):
    def request(self, key, token, control=False):
        handler=object.__new__(gateway.Handler)
        handler.path=f'/websockify?screen={key}&cadre_token={token}&view_only={str(not control).lower()}'
        handler.headers={'Upgrade':'websocket'}
        handler.connection=MagicMock();handler.send_error=MagicMock()
        return handler

    def test_view_capability_cannot_open_a_different_agent_screen(self):
        key=screens.screen_key('agent-b')
        token=hmac.new(b'secret',screens.screen_key('agent-a').encode(),hashlib.sha256).hexdigest()
        handler=self.request(key,token)
        with patch.dict(gateway.os.environ,{'CADRE_SCREEN_VIEW_TOKEN':'secret'}), patch.object(screens,'load',return_value={'index':2}), patch.object(gateway.socket,'create_connection') as connect:
            handler.do_GET()
        handler.send_error.assert_called_once_with(403);connect.assert_not_called()

    def test_valid_view_is_routed_to_its_own_display(self):
        key=screens.screen_key('agent-b')
        token=hmac.new(b'secret',key.encode(),hashlib.sha256).hexdigest()
        handler=self.request(key,token)
        with patch.dict(gateway.os.environ,{'CADRE_SCREEN_VIEW_TOKEN':'secret'}), patch.object(screens,'load',return_value={'index':2}), patch.object(gateway.socket,'create_connection',side_effect=OSError) as connect:
            handler.do_GET()
        handler.send_error.assert_not_called();connect.assert_called_once_with(('127.0.0.1',6084),timeout=10)

    def test_expired_and_wrong_control_grants_cannot_open_stream(self):
        for state in [{'index':1,'token':'right','expiresAt':time.time()-1},{'index':1,'token':'wrong','expiresAt':time.time()+100}]:
            handler=self.request(screens.screen_key('agent'),'right',True)
            with patch.object(screens,'load',return_value=state), patch.object(gateway.socket,'create_connection') as connect:
                handler.do_GET()
            handler.send_error.assert_called_once_with(403);connect.assert_not_called()

    def test_revocation_closes_an_already_open_control_stream(self):
        active={'index':1,'token':'right','expiresAt':time.time()+100}
        handler=self.request(screens.screen_key('agent'),'right',True)
        with patch.object(screens,'load',side_effect=[active,active,{}]), patch.object(gateway.socket,'create_connection') as connect, patch.object(gateway.select,'select',return_value=([],[],[])) as select:
            handler.do_GET()
        connect.assert_called_once_with(('127.0.0.1',6083),timeout=10);select.assert_called_once()

    def test_shared_capability_routes_control_without_exclusive_lease(self):
        key=screens.screen_key('agent');until=int(time.time())+300
        token=hmac.new(b'secret',f'shared:{key}:{until}'.encode(),hashlib.sha256).hexdigest()
        handler=self.request(key,token,True);handler.path+=f'&shared_until={until}'
        with patch.dict(gateway.os.environ,{'CADRE_SCREEN_VIEW_TOKEN':'secret'}), patch.object(screens,'load',return_value={'index':1,'sharedUntil':until}), patch.object(gateway.socket,'create_connection',side_effect=OSError) as connect:
            handler.do_GET()
        handler.send_error.assert_not_called();connect.assert_called_once_with(('127.0.0.1',6083),timeout=10)

    def test_shared_capability_rejects_view_tokens_expiry_and_other_screens(self):
        key=screens.screen_key('agent');until=int(time.time())+300
        cases=[(hmac.new(b'secret',key.encode(),hashlib.sha256).hexdigest(),until),
            (hmac.new(b'secret',f'shared:{screens.screen_key("other")}:{until}'.encode(),hashlib.sha256).hexdigest(),until),
            (hmac.new(b'secret',f'shared:{key}:1'.encode(),hashlib.sha256).hexdigest(),1)]
        for token,expiry in cases:
            handler=self.request(key,token,True);handler.path+=f'&shared_until={expiry}'
            with patch.dict(gateway.os.environ,{'CADRE_SCREEN_VIEW_TOKEN':'secret'}), patch.object(screens,'load',return_value={'index':1,'sharedUntil':until}), patch.object(gateway.socket,'create_connection') as connect:
                handler.do_GET()
            handler.send_error.assert_called_once_with(403);connect.assert_not_called()

    def test_shared_stream_closes_when_its_screen_grant_is_removed(self):
        key=screens.screen_key('agent');until=int(time.time())+300
        token=hmac.new(b'secret',f'shared:{key}:{until}'.encode(),hashlib.sha256).hexdigest()
        handler=self.request(key,token,True);handler.path+=f'&shared_until={until}'
        with patch.dict(gateway.os.environ,{'CADRE_SCREEN_VIEW_TOKEN':'secret'}), patch.object(screens,'load',side_effect=[{'index':1,'sharedUntil':until},{}]), patch.object(gateway.socket,'create_connection'), patch.object(gateway.select,'select',return_value=([],[],[])) as select:
            handler.do_GET()
        select.assert_called_once()


class StaticAssetConnectionTest(unittest.TestCase):
    def test_each_asset_request_returns_through_gateway_routing(self):
        import http.client
        import threading
        from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

        asset_requests = []
        class Assets(BaseHTTPRequestHandler):
            protocol_version = 'HTTP/1.1'
            def log_message(self, *_args): pass
            def do_GET(self):
                asset_requests.append(self.path)
                body = self.path.encode()
                self.send_response(200)
                self.send_header('Content-Length', str(len(body)))
                self.end_headers()
                self.wfile.write(body)

        class RoutedGateway(gateway.Handler):
            def do_GET(self):
                self.path = self.path.removeprefix('/machine')
                super().do_GET()

        upstream = ThreadingHTTPServer(('127.0.0.1', 0), Assets)
        proxy = ThreadingHTTPServer(('127.0.0.1', 0), RoutedGateway)
        servers = [upstream, proxy]
        for server in servers:
            threading.Thread(target=server.serve_forever, daemon=True).start()
        original_connect = gateway.socket.create_connection
        def connect(address, *args, **kwargs):
            if address == ('127.0.0.1', 6080): address = upstream.server_address
            return original_connect(address, *args, **kwargs)
        client = http.client.HTTPConnection(*proxy.server_address, timeout=2)
        try:
            with patch.object(gateway.socket, 'create_connection', side_effect=connect), patch.object(screens, 'load', return_value=None):
                for path in ['/embed.html', '/core/input/keyboard.js']:
                    client.request('GET', '/machine' + path)
                    self.assertEqual(client.getresponse().read().decode(), path)
                client.request('GET', '/machine/websockify?screen=' + screens.screen_key('agent'),
                               headers={'Upgrade': 'websocket', 'Connection': 'Upgrade'})
                response = client.getresponse()
                self.assertEqual(response.status, 403)
                response.read()
                self.assertEqual(asset_requests, ['/embed.html', '/core/input/keyboard.js'])
        finally:
            client.close()
            for server in servers:
                server.shutdown()
                server.server_close()

if __name__=='__main__':unittest.main()
