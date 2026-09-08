import tempfile
import os
import unittest
from pathlib import Path
import input_epoch as epoch
import screens


class EpochTest(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.old=screens.STATE;self.public=epoch.PUBLIC_STATE
        screens.STATE=Path(self.tmp.name)/'private';screens.STATE.mkdir()
        epoch.PUBLIC_STATE=Path(self.tmp.name)/'public'
    def tearDown(self):
        screens.STATE=self.old;epoch.PUBLIC_STATE=self.public;self.tmp.cleanup()
    def test_human_input_invalidates_only_its_screen_and_requires_fresh_observation(self):
        epoch.observed('a','run:1',0);epoch.observed('b','run:2',0)
        epoch.advance('a')
        with self.assertRaisesRegex(ValueError,'fresh computer observation'):epoch.require_fresh('a','run:1')
        epoch.require_fresh('b','run:2')
        epoch.observed('a','run:1',epoch.current('a'));epoch.require_fresh('a','run:1')
        with self.assertRaises(ValueError):epoch.require_fresh('a','another:2')
    def test_input_during_capture_does_not_certify_the_stale_capture(self):
        before=epoch.current('a');epoch.advance('a');epoch.observed('a','run:1',before)
        with self.assertRaises(ValueError):epoch.require_fresh('a','run:1')
    def test_public_counter_has_no_grants_and_cannot_be_written_by_desktop_user(self):
        previous=os.umask(0o077)
        try:
            self.assertEqual(epoch.advance('a'),1);self.assertEqual(epoch.advance('a'),2)
        finally:os.umask(previous)
        path=epoch.public_path('a')
        self.assertEqual(path.read_text(),'2')
        self.assertEqual(path.stat().st_mode & 0o777,0o444)
        self.assertEqual(path.parent.stat().st_mode & 0o777,0o755)

if __name__=='__main__':unittest.main()
