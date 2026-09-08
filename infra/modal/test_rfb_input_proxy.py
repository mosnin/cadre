import socket
import struct
import threading
import unittest
from unittest.mock import patch
from rfb_input_proxy import ClientMessages, Server, Handler

VERSION=b'RFB 003.008\n'
SETUP=b'\0'+bytes(19)+b'\2\0\0\2'+struct.pack('>ii',-308,-313)+b'\3'+bytes(9)
KEY=b'\4\1\0\0'+struct.pack('>I',65)
POINTER=b'\5\1\0\4\0\5'
CLIP=b'\6\0\0\0'+struct.pack('>i',3)+b'abc'

class ParserTest(unittest.TestCase):
    def test_every_split_preserves_protocol_and_only_counts_human_input(self):
        stream=VERSION+b'\1\1'+SETUP+KEY+POINTER+CLIP
        for split in range(len(stream)+1):
            parser=ClientMessages();messages=parser.feed(stream[:split])+parser.feed(stream[split:])
            self.assertEqual(b''.join(data for data,_ in messages),stream)
            self.assertEqual(sum(human for _,human in messages),3)
    def test_bytewise_fragmentation_and_normal_novnc_extensions(self):
        fence=b'\xf8'+bytes(7)+b'\2ok'
        continuous=b'\x96'+bytes(9)
        desktop=b'\xfb\0\5\0\3\x20\1\0'+bytes(16)
        extended_clip=b'\6\0\0\0'+struct.pack('>i',-4)+bytes(4)
        qemu=b'\xff\0'+bytes(10)
        stream=VERSION+b'\1\1'+fence+continuous+desktop+extended_clip+qemu
        parser=ClientMessages();messages=[]
        for byte in stream:messages+=parser.feed(bytes([byte]))
        self.assertEqual(b''.join(data for data,_ in messages),stream)
        self.assertEqual(sum(human for _,human in messages),3)
    def test_malformed_or_oversized_input_fails_closed(self):
        for payload in [b'\x7f',b'\6\0\0\0'+struct.pack('>i',2**30)]:
            parser=ClientMessages();parser.feed(VERSION+b'\1\1')
            with self.assertRaises(ValueError):parser.feed(payload)
    def test_plaintext_proxy_detects_input_before_forwarding_without_websocket_assumptions(self):
        upstream=socket.socket();upstream.bind(('127.0.0.1',0));upstream.listen()
        seen=[];received=[];done=threading.Event()
        def serve():
            connection,_=upstream.accept()
            with connection:
                connection.sendall(VERSION)
                while True:
                    data=connection.recv(1024)
                    if not data:break
                    received.append(data)
                    if b''.join(received).endswith(KEY):
                        self.assertEqual(seen,['screen']);done.set();break
            upstream.close()
        threading.Thread(target=serve,daemon=True).start()
        with Server(('127.0.0.1',0),Handler) as server,patch('rfb_input_proxy.input_epoch.advance',side_effect=seen.append):
            server.upstream=upstream.getsockname()[1];server.screen_key='screen'
            worker=threading.Thread(target=server.serve_forever,daemon=True);worker.start()
            try:
                with socket.create_connection(server.server_address,timeout=2) as client:
                    self.assertEqual(client.recv(12),VERSION)
                    for byte in VERSION+b'\1\1'+SETUP+KEY:client.sendall(bytes([byte]))
                    self.assertTrue(done.wait(2))
                self.assertEqual(b''.join(received),VERSION+b'\1\1'+SETUP+KEY)
            finally:server.shutdown();worker.join()

if __name__=='__main__':unittest.main()
