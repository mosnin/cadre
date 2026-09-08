"""Observe human input in plaintext RFB, after websockify decodes WebSockets.

The dedicated no-auth loopback control server is the sole upstream. No input
payload is persisted or logged; only per-screen generation counters change.
"""
import select
import socket
import socketserver
import struct
import sys
import input_epoch

MAX_CLIPBOARD=1024*1024


class ClientMessages:
    def __init__(self):
        self.buffer=bytearray();self.phase='version'

    def feed(self,data):
        self.buffer.extend(data);messages=[]
        while self.buffer:
            size=0;human=False
            if self.phase=='version':
                if len(self.buffer)<12:break
                version=bytes(self.buffer[:12])
                if version not in (b'RFB 003.003\n',b'RFB 003.007\n',b'RFB 003.008\n'):
                    raise ValueError('Unsupported RFB version')
                size=12;self.phase='init' if version==b'RFB 003.003\n' else 'security'
            elif self.phase=='security':
                if self.buffer[0]!=1:raise ValueError('Only loopback no-auth RFB is supported')
                size=1;self.phase='init'
            elif self.phase=='init':size=1;self.phase='messages'
            else:
                kind=self.buffer[0]
                if kind in (0,3,4,5,150):
                    size={0:20,3:10,4:8,5:6,150:10}[kind];human=kind in (4,5)
                elif kind==2:
                    if len(self.buffer)<4:break
                    count=int.from_bytes(self.buffer[2:4],'big')
                    if count>4096:raise ValueError('Too many RFB encodings')
                    size=4+count*4
                elif kind==6:
                    if len(self.buffer)<8:break
                    length=abs(struct.unpack('>i',self.buffer[4:8])[0])
                    if length>MAX_CLIPBOARD:raise ValueError('Clipboard exceeds limit')
                    size=8+length;human=True
                elif kind==250:size=4;human=True
                elif kind==248:
                    if len(self.buffer)<9:break
                    size=9+self.buffer[8]
                elif kind==251:
                    if len(self.buffer)<8:break
                    size=8+self.buffer[6]*16;human=True
                elif kind==255:
                    if len(self.buffer)<2:break
                    if self.buffer[1]!=0:raise ValueError('Unsupported extended key event')
                    size=12;human=True
                else:raise ValueError('Unsupported RFB client message')
            if len(self.buffer)<size:break
            messages.append((bytes(self.buffer[:size]),human));del self.buffer[:size]
        return messages


class Handler(socketserver.BaseRequestHandler):
    def handle(self):
        parser=ClientMessages()
        try:
            with socket.create_connection(('127.0.0.1',self.server.upstream),timeout=5) as upstream:
                upstream.settimeout(None)
                while True:
                    ready,_,_=select.select([self.request,upstream],[],[],30)
                    for source in ready:
                        data=source.recv(65536)
                        if not data:return
                        if source is upstream:self.request.sendall(data)
                        else:
                            for message,human in parser.feed(data):
                                if human:input_epoch.advance(self.server.screen_key)
                                upstream.sendall(message)
        except (OSError,ValueError):return


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address=True
    daemon_threads=True


if __name__=='__main__':
    port,upstream,key=int(sys.argv[1]),int(sys.argv[2]),sys.argv[3]
    with Server(('127.0.0.1',port),Handler) as server:
        server.upstream=upstream;server.screen_key=key;server.serve_forever()
