import base64
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch, MagicMock
import computer_rpc as rpc

class FileBoundaryTest(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.base=Path(self.tmp.name).resolve()
        self.old=rpc.ROOT;rpc.ROOT=self.base/'home';rpc.ROOT.mkdir()
        self.epoch_old=rpc.input_epoch.PUBLIC_STATE;rpc.input_epoch.PUBLIC_STATE=self.base/'public-input'
        self.state_old=rpc.screens.STATE;rpc.screens.STATE=self.base/'state';rpc.screens.STATE.mkdir()
    def tearDown(self):
        rpc.ROOT=self.old;rpc.input_epoch.PUBLIC_STATE=self.epoch_old;rpc.screens.STATE=self.state_old;self.tmp.cleanup()
    def test_bulk_file_round_trip_and_symlink_escape_rejection(self):
        with patch.object(os,'fchown'):
            rpc.run({'op':'writeBatch','files':[{'path':'notes/a.txt','content':base64.b64encode(b'hello').decode()}]})
        self.assertEqual(rpc.run({'op':'readBatch','paths':['notes/a.txt']}),[{'content':base64.b64encode(b'hello').decode()}])
        outside=self.base/'private';outside.mkdir();(outside/'secret').write_text('private')
        (rpc.ROOT/'escape').symlink_to(outside,target_is_directory=True)
        for op in ['read','write','list']:
            with self.assertRaises((OSError,ValueError)):
                rpc.run({'op':op,'path':'escape/secret' if op!='list' else 'escape','content':'eA=='})
        self.assertEqual((outside/'secret').read_text(),'private')
    def test_directory_substitution_cannot_redirect_an_open_read(self):
        parent=rpc.ROOT/'notes';parent.mkdir();(parent/'a.txt').write_text('allowed')
        outside=self.base/'private';outside.mkdir();(outside/'a.txt').write_text('private')
        original=os.open
        def swap(name,*args,**kwargs):
            fd=original(name,*args,**kwargs)
            if name=='notes':
                parent.rename(rpc.ROOT/'moved');parent.symlink_to(outside,target_is_directory=True)
            return fd
        with patch.object(os,'open',side_effect=swap):
            result=rpc.run({'op':'read','path':'notes/a.txt'})
        self.assertEqual(base64.b64decode(result['content']),b'allowed')
    def test_command_keeps_operation_marker_and_scoped_environment(self):
        operation='test-command'
        process=MagicMock(pid=123)
        def wait(**_):
            self.assertEqual((self.base/operation).read_text(),'123')
            return 0
        process.wait.side_effect=wait
        with patch.object(rpc,'marker',side_effect=lambda value:self.base/value), patch.object(rpc.screens,'resolve',return_value=('screen-hash',{'index':2})), patch.object(rpc.subprocess,'Popen',return_value=process) as popen:
            rpc.execute({'operationId':operation,'screenKey':'agent','argv':['true'],'env':{'TASK_TOKEN':'scoped','DISPLAY':':9','CADRE_HUMAN_INPUT_PATH':'/fake/epoch','CADRE_HUMAN_INPUT_EPOCH':'999'}})
        env=popen.call_args.kwargs['env']
        self.assertEqual(env['TASK_TOKEN'],'scoped');self.assertEqual(env['DISPLAY'],':3')
        self.assertEqual(env['CADRE_HUMAN_INPUT_EPOCH'],'0')
        self.assertEqual(env['CADRE_HUMAN_INPUT_PATH'],str(rpc.input_epoch.PUBLIC_STATE/'screen-hash'))
        self.assertFalse((self.base/operation).exists())

    def test_screen_capacity_does_not_block_non_graphical_commands(self):
        process=MagicMock(pid=123);process.wait.return_value=0
        with patch.object(rpc,'marker',side_effect=lambda value:self.base/value), patch.object(rpc.screens,'resolve',side_effect=rpc.screens.ScreenUnavailableError('full')), patch.object(rpc.subprocess,'Popen',return_value=process) as popen:
            self.assertEqual(rpc.execute({'operationId':'command','screenKey':'ninth','argv':['true']})['code'],0)
        self.assertEqual(popen.call_args.kwargs['env']['DISPLAY'],'')

    def test_platform_credentials_never_enter_shell_without_a_screen(self):
        for screen in [None, 'full-screen']:
            process=MagicMock(pid=123);process.wait.return_value=0
            request={'operationId':'private-command','argv':['true']}
            if screen: request['screenKey']=screen
            with patch.dict(os.environ,{'CADRE_RPC_TOKEN':'private-rpc','CADRE_SCREEN_VIEW_TOKEN':'private-view'}), patch.object(rpc,'marker',side_effect=lambda value:self.base/value), patch.object(rpc.screens,'resolve',side_effect=rpc.screens.ScreenUnavailableError('full')), patch.object(rpc.subprocess,'Popen',return_value=process) as popen:
                rpc.execute(request)
            self.assertNotIn('CADRE_RPC_TOKEN',popen.call_args.kwargs['env'])
            self.assertNotIn('CADRE_SCREEN_VIEW_TOKEN',popen.call_args.kwargs['env'])

    def test_directory_substitution_cannot_redirect_a_write(self):
        parent=rpc.ROOT/'notes';parent.mkdir()
        outside=self.base/'private';outside.mkdir();(outside/'a.txt').write_text('private')
        original=os.open
        def swap(name,*args,**kwargs):
            fd=original(name,*args,**kwargs)
            if name=='notes':
                parent.rename(rpc.ROOT/'moved');parent.symlink_to(outside,target_is_directory=True)
            return fd
        with patch.object(os,'open',side_effect=swap), patch.object(os,'fchown'):
            rpc.run({'op':'write','path':'notes/a.txt','content':base64.b64encode(b'allowed').decode()})
        self.assertEqual((outside/'a.txt').read_text(),'private')
        self.assertEqual((rpc.ROOT/'moved/a.txt').read_text(),'allowed')

    def test_native_action_batch_stops_after_human_input_changes_its_observation(self):
        key=rpc.screens.screen_key('agent');rpc.input_epoch.observed(key,'run:1',0)
        request={'screenKey':'agent','screenLease':'run:1','actions':[{'kind':'key','key':'Return'},{'kind':'key','key':'Tab'}]}
        with patch.object(rpc.screens,'resolve',return_value=(key,{'index':1})), patch.object(rpc.subprocess,'run',side_effect=lambda *a,**k:rpc.input_epoch.advance(key)) as run:
            with self.assertRaisesRegex(ValueError,'fresh computer observation'):rpc.actions(request)
            self.assertEqual(run.call_count,1)
        with patch.object(rpc.screens,'resolve',return_value=(key,{'index':1})), patch.object(rpc.subprocess,'run') as run:
            with self.assertRaises(ValueError):rpc.actions(request)
            run.assert_not_called()

    def test_shared_input_requires_a_live_runtime_grant_and_keeps_agent_lease(self):
        request={'op':'sharedInput','screenKey':'agent','actions':[{'kind':'key','key':'Return'}]}
        for state in [{},{'sharedUntil':rpc.time.time()-1}]:
            with patch.object(rpc.screens,'load',return_value=state), patch.object(rpc,'actions') as actions:
                with self.assertRaisesRegex(ValueError,'Open the computer viewer'):rpc.run(request)
                actions.assert_not_called()
        with patch.object(rpc.screens,'load',return_value={'sharedUntil':rpc.time.time()+60,'lease':'run:7'}), patch.object(rpc,'actions',return_value={'completed':1}) as actions:
            self.assertEqual(rpc.run(request),{'completed':1})
            actions.assert_called_once_with(request)
            self.assertNotIn('screenLease',request)

    def test_traversal_and_batch_limits(self):
        with self.assertRaises(ValueError):rpc.run({'op':'read','path':'../private'})
        with self.assertRaises(ValueError):rpc.run({'op':'readBatch','paths':['a']*9})
        with self.assertRaises(ValueError):rpc.run({'op':'writeBatch','files':[{}]*9})

if __name__=='__main__':unittest.main()
