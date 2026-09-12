"""Exercise the production shell watchdog with owned fake VNC children."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

SOURCE = Path(__file__).parents[1] / 'sandboxes/computer/start.sh'

class DesktopWatchdogTest(unittest.TestCase):
    def test_stalled_listener_restarts_only_owned_view_child(self):
        source = SOURCE.read_text()
        start = source[source.index('start_view_vnc()'):source.index('\nNOVNC_ROOT=')]
        loop = source[source.index('VIEW_VNC_PID=""'):source.index('\necho "Xvfb exited"')]
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            fake = root / 'x11vnc'
            fake.write_text('#!/bin/sh\nprintf "%s\\n" "$*" >> "$LOG_DIR/starts"\nexec sleep 60\n')
            fake.chmod(0o755)
            # A unrelated process represents the browser: repairing VNC must not
            # terminate it. The shell owns only the children it starts below.
            browser = subprocess.Popen(['sleep', '60'])
            try:
                script = '''set -uo pipefail
export LOG_DIR="$TEST_ROOT" DISPLAY=:2
VIEW_VNC_PORT=5902
VIEW_PORT=6082
trap 'jobs -pr | xargs -r kill 2>/dev/null || true' EXIT
checks=0
xdpyinfo() { checks=$((checks + 1)); [[ "$checks" -le 7 ]]; }
vnc_ready() { return 1; }
port_ready() { [[ "$1" == "$VIEW_PORT" ]]; }
start_view_proxy() { echo unexpected-proxy >> "$LOG_DIR/errors"; }
sleep() { command sleep .15; }
''' + start + '\n' + loop
                result = subprocess.run(['bash', '-c', script], env={**os.environ, 'TEST_ROOT':directory, 'PATH':directory+os.pathsep+os.environ['PATH']}, check=True, timeout=5, capture_output=True)
                self.assertTrue((root/'starts').exists(), result.stderr.decode() + str(list(root.iterdir())))
                starts = (root/'starts').read_text().splitlines()
                self.assertEqual(len(starts),2)
                self.assertTrue(all('-rfbport 5902' in line and '-noshm' in line and '-no6' in line for line in starts))
                self.assertFalse((root/'errors').exists())
                self.assertIsNone(browser.poll())
            finally:
                browser.terminate(); browser.wait(timeout=2)

if __name__ == '__main__': unittest.main()
