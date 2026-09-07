"""Deterministic transport boundary checks; no cloud credentials required."""
import importlib.util
import io
import json
import os
from pathlib import Path
import sys
import unittest
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'modal'))
spec = importlib.util.spec_from_file_location('fly_gateway', Path(__file__).with_name('gateway.py'))
gateway = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gateway)

class GatewayTest(unittest.TestCase):
    def handler(self, body=b'{}', token='Bearer test-rpc'):
        handler = object.__new__(gateway.Handler)
        handler.path = '/m/1234567890abcd/rpc'
        handler.headers = {'Authorization':token, 'Content-Length':str(len(body))}
        handler.rfile = io.BytesIO(body)
        handler.wfile = io.BytesIO()
        handler.connection = unittest.mock.Mock()
        handler.send_error = unittest.mock.Mock()
        handler.send_response = unittest.mock.Mock()
        handler.send_header = unittest.mock.Mock()
        handler.end_headers = unittest.mock.Mock()
        return handler

    @patch.dict(os.environ, {'FLY_MACHINE_ID':'1234567890abcd','CADRE_RPC_TOKEN':'test-rpc'})
    def test_large_workspace_file_reaches_the_shared_protocol(self):
        body=json.dumps({'op':'writeBatch','files':[{'path':'large.bin','content':'A'*(24*1024*1024)}]}).encode()
        handler=self.handler(body)
        with patch.object(gateway.subprocess,'run',return_value=unittest.mock.Mock(stdout=b'{"ok":true}')) as run:
            handler.do_POST()
        handler.send_error.assert_not_called()
        self.assertEqual(run.call_args.kwargs['input'],body)
        self.assertGreaterEqual(gateway.MAX_BODY, ((64*1024*1024+2)//3)*4+1024)

    @patch.dict(os.environ, {'FLY_MACHINE_ID':'1234567890abcd','CADRE_RPC_TOKEN':'test-rpc'})
    def test_oversized_request_is_rejected_before_reading(self):
        handler=self.handler()
        handler.headers['Content-Length']=str(gateway.MAX_BODY+1)
        with patch.object(gateway.subprocess,'run') as run:
            handler.do_POST()
        handler.send_error.assert_called_once_with(400)
        self.assertEqual(handler.rfile.tell(),0)
        run.assert_not_called()

    @patch.dict(os.environ, {'FLY_MACHINE_ID':'1234567890abcd','CADRE_RPC_TOKEN':'test-rpc'})
    def test_wrong_capability_cannot_execute(self):
        handler = self.handler(token='Bearer other-team-token')
        with patch.object(gateway.subprocess,'run') as run:
            handler.do_POST()
        handler.send_error.assert_called_once_with(403)
        run.assert_not_called()

    @patch.dict(os.environ, {'FLY_MACHINE_ID':'1234567890abcd','CADRE_RPC_TOKEN':'test-rpc'})
    def test_nonfinite_timeout_is_rejected_before_execution(self):
        handler = self.handler(b'{"timeoutMs":NaN}')
        with patch.object(gateway.subprocess,'run') as run:
            handler.do_POST()
        handler.send_error.assert_called_once_with(400)
        run.assert_not_called()

    @patch.dict(os.environ, {'FLY_MACHINE_ID':'1234567890abcd','CADRE_RPC_TOKEN':'test-rpc'})
    def test_authenticated_request_uses_stdin_without_a_shell(self):
        body=json.dumps({'op':'exec','argv':['echo','test']}).encode()
        handler=self.handler(body)
        with patch.object(gateway.subprocess,'run',return_value=unittest.mock.Mock(stdout=b'{"code":0}')) as run:
            handler.do_POST()
        self.assertEqual(run.call_args.args[0],['python3','/opt/cadre/computer_rpc.py'])
        self.assertEqual(run.call_args.kwargs['input'],body)
        self.assertNotIn('shell',run.call_args.kwargs)
        self.assertEqual(json.loads(handler.wfile.getvalue()),{'code':0})
