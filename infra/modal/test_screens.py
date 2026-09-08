import concurrent.futures
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import screens

class ScreensTest(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(); self.old=screens.STATE;screens.STATE=Path(self.tmp.name)
        self.mock=patch.object(screens,'ensure',side_effect=lambda s,k:s);self.mock.start()
    def tearDown(self):
        self.mock.stop();screens.STATE=self.old;self.tmp.cleanup()
    def test_parallel_agents_get_distinct_screens(self):
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
            rows=list(pool.map(lambda i:screens.resolve(f'bot-{i}',f'run-{i}:1'),range(8)))
        self.assertEqual({s['index'] for _,s in rows},set(range(1,9)))
        with self.assertRaises(RuntimeError):screens.resolve('ninth','run:1')
    def test_stale_release_and_takeover_do_not_touch_new_grant(self):
        key,_=screens.resolve('bot','run:2')
        with self.assertRaises(RuntimeError):screens.resolve('bot','old:1')
        screens.release('bot','old:1');self.assertEqual(screens.load(key)['lease'],'run:2')
        screens.control('bot','user-old','old-token',True)
        screens.control('bot','user-new','new-token',True)
        screens.control('bot','user-old',None,False)
        self.assertEqual(screens.load(key)['token'],'new-token')
        screens.control('bot','user-new',None,False)
        self.assertNotIn('token',screens.load(key))
    def test_release_one_agent_keeps_peer_and_browser_screen(self):
        ka,a=screens.resolve('a','a:1');kb,b=screens.resolve('b','b:1')
        screens.release('a','a:1')
        self.assertNotIn('lease',screens.load(ka));self.assertEqual(screens.load(kb)['lease'],'b:1')
        self.assertEqual(screens.resolve('a','a:2')[1]['index'],a['index'])
    def test_user_control_is_not_reclaimed(self):
        for i in range(8):screens.resolve(str(i),f'{i}:1')
        screens.release('0','0:1');screens.control('0','human','token',True)
        with self.assertRaises(RuntimeError):screens.resolve('new','new:1')
        screens.control('0','human',None,False)
        with patch.object(screens,'retire') as retire:
            _,state=screens.resolve('new','new:1')
            self.assertEqual(state['index'],1);retire.assert_called_once()

    def test_failed_start_keeps_its_reserved_display_and_process(self):
        def failed(state,key):
            state['pid']=123
            raise RuntimeError('startup failed')
        with patch.object(screens,'ensure',side_effect=failed):
            with self.assertRaises(RuntimeError):screens.resolve('slow','slow:1')
        saved=screens.load(screens.screen_key('slow'))
        self.assertEqual(saved['pid'],123)
        self.assertEqual(screens.resolve('other','other:1')[1]['index'],2)

    def test_shared_viewer_keeps_screen_without_taking_agent_lease(self):
        key,state=screens.resolve('agent','run:1',shared_input=True)
        self.assertGreater(state['sharedUntil'],screens.time.time())
        self.assertNotIn('controlLease',state)
        screens.release('agent','run:1')
        same=screens.resolve('agent',shared_input=True)[1]
        self.assertEqual(same['sharedUntil'],state['sharedUntil'])
        self.assertNotIn('lease',same)
        for i in range(7):screens.resolve(f'other-{i}',f'{i}:1')
        with self.assertRaises(screens.ScreenUnavailableError):screens.resolve('new','new:1')

    def test_connected_viewer_refreshes_while_another_start_holds_registry_lock(self):
        key,state=screens.resolve('viewed',shared_input=True)
        state['sharedActiveUntil']=0;screens.save(key,state)
        with open(screens.STATE/'registry.lock','a') as lock:
            screens.fcntl.flock(lock,screens.fcntl.LOCK_EX)
            screens.touch_shared(key,state['index'],state['sharedUntil'])
        self.assertGreater(screens.shared_active_until(key,state),screens.time.time())
        for i in range(7):screens.resolve(f'other-{i}',f'{i}:1')
        with self.assertRaises(screens.ScreenUnavailableError):screens.resolve('new','new:1')
        # A stale marker from another incarnation must not pin a reused index.
        self.assertEqual(screens.shared_active_until(key,{**state,'index':2}),0)

    def test_closed_shared_viewer_does_not_pin_the_screen_for_token_lifetime(self):
        key,state=screens.resolve('old',shared_input=True)
        state['sharedActiveUntil']=0;screens.save(key,state)
        for i in range(7):screens.resolve(f'other-{i}',f'{i}:1')
        with patch.object(screens,'retire'):
            self.assertEqual(screens.resolve('new','new:1')[1]['index'],1)
        self.assertIsNone(screens.load(key))

    def test_lost_view_proxy_waits_for_existing_supervisor_without_duplicate_desktop(self):
        self.mock.stop()
        try:
            with patch.object(screens,'desktop_running',return_value=True), patch.object(screens,'ready',side_effect=lambda port:port!=6082), patch.object(screens.time,'sleep'), patch.object(screens.subprocess,'Popen') as popen:
                with self.assertRaisesRegex(RuntimeError,'desktop did not become ready'):
                    screens.ensure({'index':1,'pid':123},'key')
                popen.assert_not_called()
        finally:self.mock.start()

    def test_missing_control_vnc_does_not_duplicate_healthy_proxy(self):
        self.mock.stop()
        live={6082,5902,6083,6003}
        def start(argv,**kwargs):
            live.add(int(argv[argv.index('-rfbport')+1]))
            from unittest.mock import MagicMock
            return MagicMock(pid=124)
        try:
            with patch.object(screens,'ready',side_effect=lambda port:port in live), patch.object(screens.subprocess,'Popen',side_effect=start) as popen:
                screens.ensure({'index':1,'pid':123},'key')
                self.assertEqual(popen.call_count,1)
                self.assertEqual(popen.call_args.args[0][0],'x11vnc')
        finally:self.mock.start()

if __name__=='__main__':unittest.main()
