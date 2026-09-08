import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import computer_rpc as rpc


def pointer(kind,button='left'):
    return {'kind':'pointer','type':kind,'button':button,'x':20,'y':30}


class NativeActionsTest(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.old=rpc.screens.STATE;self.public=rpc.input_epoch.PUBLIC_STATE
        rpc.screens.STATE=Path(self.tmp.name)/'state';rpc.screens.STATE.mkdir()
        rpc.input_epoch.PUBLIC_STATE=Path(self.tmp.name)/'public'
        self.key=rpc.screens.screen_key('agent')
        rpc.input_epoch.observed(self.key,'run:1',0)
        self.resolve=patch.object(rpc.screens,'resolve',return_value=(self.key,{'index':1}));self.resolver=self.resolve.start()
    def tearDown(self):
        self.resolve.stop();rpc.screens.STATE=self.old;rpc.input_epoch.PUBLIC_STATE=self.public;self.tmp.cleanup()
    def request(self,actions,**options):
        return {'op':'actions','screenKey':'agent','screenLease':'run:1','actions':actions,**options}

    def test_unbalanced_and_overlapping_drags_are_rejected_before_any_action(self):
        cases=[[pointer('down')],[{'kind':'key','key':'Return'},pointer('down')],
            [pointer('up')],[pointer('down'),pointer('down'),pointer('up'),pointer('up')],
            [pointer('down'),pointer('click'),pointer('up')]]
        for actions in cases:
            with self.subTest(actions=actions),patch.object(rpc.subprocess,'run') as run:
                with self.assertRaises(ValueError):rpc.actions(self.request(actions))
                run.assert_not_called()
        self.resolver.assert_not_called()

    def test_complete_drag_reports_all_actions_without_extra_releases(self):
        with patch.object(rpc.subprocess,'run') as run:
            result=rpc.actions(self.request([pointer('down'),pointer('move'),pointer('up')]))
        self.assertEqual(result,{'completed':3});self.assertEqual(run.call_count,3)
        self.assertEqual(run.call_args.args[0],['xdotool','mouseup','1'])

    def test_epoch_interruption_releases_only_the_button_this_batch_pressed(self):
        def execute(argv,**kwargs):
            if 'mousedown' in argv:rpc.input_epoch.advance(self.key)
        with patch.object(rpc.subprocess,'run',side_effect=execute) as run:
            with self.assertRaises(ValueError) as error:
                rpc.actions(self.request([pointer('down','right'),pointer('move','right'),pointer('up','right')]))
        self.assertEqual(run.call_count,2)
        self.assertEqual(run.call_args.args[0],['xdotool','mouseup','3'])
        self.assertIn('fresh computer observation',str(error.exception))
        self.assertIn('Completed 1 of 3 actions',str(error.exception))
        self.assertIn('do not replay the entire batch',str(error.exception))
        self.assertNotIn('may have partially executed',str(error.exception))

    def test_uncertain_mousedown_is_cleaned_up_and_reports_partial_execution(self):
        count=0
        def execute(argv,**kwargs):
            nonlocal count
            count+=1
            if count==1:raise subprocess.TimeoutExpired(['private-clipboard-value'],20)
        with patch.object(rpc.subprocess,'run',side_effect=execute) as run:
            with self.assertRaises(ValueError) as error:rpc.actions(self.request([pointer('down'),pointer('up')]))
        self.assertEqual(run.call_args.args[0],['xdotool','mouseup','1'])
        message=str(error.exception)
        self.assertIn('Completed 0 of 2 actions',message)
        self.assertIn('Action 1 may have partially executed',message)
        self.assertNotIn('private-clipboard-value',message)

    def test_failed_mouseup_retries_owned_button_cleanup(self):
        count=0
        def execute(argv,**kwargs):
            nonlocal count
            count+=1
            if count==2:raise subprocess.CalledProcessError(1,argv)
        with patch.object(rpc.subprocess,'run',side_effect=execute) as run:
            with self.assertRaisesRegex(ValueError,'Completed 1 of 2 actions'):rpc.actions(self.request([pointer('down'),pointer('up')]))
        self.assertEqual(run.call_count,3)
        self.assertEqual(run.call_args.args[0],['xdotool','mouseup','1'])

    def test_cleanup_failure_is_disclosed_without_losing_partial_count(self):
        def execute(argv,**kwargs):
            if 'mousedown' in argv:rpc.input_epoch.advance(self.key)
            else:raise OSError('cleanup unavailable')
        with patch.object(rpc.subprocess,'run',side_effect=execute):
            with self.assertRaises(ValueError) as error:rpc.actions(self.request([pointer('down'),pointer('up')]))
        self.assertIn('Completed 1 of 2 actions',str(error.exception))
        self.assertIn('Could not confirm that every pressed button was released',str(error.exception))

    def test_non_pointer_failure_reports_progress_without_echoing_command_payload(self):
        with patch.object(rpc.subprocess,'run',side_effect=[None,subprocess.CalledProcessError(1,['private-clipboard-value'])]):
            with self.assertRaises(ValueError) as error:
                rpc.actions(self.request([{'kind':'key','key':'Return'},{'kind':'clipboard','text':'private-clipboard-value'}]))
        message=str(error.exception)
        self.assertIn('Completed 1 of 2 actions',message);self.assertIn('Action 2 may have partially executed',message)
        self.assertNotIn('private-clipboard-value',message)

    def test_observation_failure_reports_completed_effects_and_does_not_repeat_actions(self):
        with patch.object(rpc.subprocess,'run') as run,patch.object(rpc,'screenshot',side_effect=RuntimeError('capture failed')):
            with self.assertRaises(ValueError) as error:rpc.actions(self.request([{'kind':'key','key':'Return'}],observe=True))
        run.assert_called_once()
        self.assertIn('Completed 1 of 1 actions',str(error.exception))
        self.assertIn('Verify the current computer state and prior effects',str(error.exception))

    def test_explicit_human_pointer_events_can_span_calls_without_agent_cleanup(self):
        with patch.object(rpc.subprocess,'run') as run:
            for kind in ('down','up'):
                result=rpc.actions({'op':'sharedInput','screenKey':'agent','actions':[pointer(kind)]})
                self.assertEqual(result,{'completed':1})
        self.assertEqual(run.call_count,2)
        self.assertIn('mousedown',run.call_args_list[0].args[0])
        self.assertEqual(run.call_args_list[1].args[0],['xdotool','mouseup','1'])


if __name__=='__main__':unittest.main()
