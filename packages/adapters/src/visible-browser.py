"""Operate the existing visible Chromium through its loopback DevTools endpoint.

No page-supplied JavaScript is executed. References name backend DOM nodes from
one accessibility snapshot and are invalidated after every action/navigation.
"""
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import uuid
from urllib.parse import urlsplit

ROLES = {'button', 'link', 'textbox', 'searchbox', 'combobox', 'checkbox', 'radio', 'tab', 'menuitem', 'switch', 'slider', 'spinbutton'}

# Roles whose accessibility children are the choices of a native dropdown.
LIST_ROLES = ('combobox', 'listbox')
OPTION_ROLES = ('menuitem', 'option')

# Wait for the page to stop changing rather than for a fixed interval. Two animation
# frames is enough for a rerender to land, so the ordinary action costs a twentieth of
# a second instead of a fifth. Only an autocomplete needs longer, and only until its
# suggestions are actually on screen.
#
# This runs in an isolated world: the page's own overrides of requestAnimationFrame or
# setTimeout do not apply, the page cannot observe it, and it returns nothing but a
# boolean. The CDP client's own deadline caps it regardless.
SETTLE = """function (autocomplete) {
  const field = this instanceof Element ? this : null;
  return new Promise((resolve) => {
    let frames = 0, finished = false;
    const finish = () => { if (!finished) { finished = true; resolve(true); } };
    setTimeout(finish, autocomplete ? 200 : 50);
    const suggestionsShowing = () => {
      const owned = ((field && (field.getAttribute('aria-controls') || field.getAttribute('aria-owns'))) || '')
        .split(/\s+/).filter(Boolean);
      const roots = owned.map((id) => document.getElementById(id)).filter(Boolean);
      const options = (roots.length ? roots : [document])
        .flatMap((root) => Array.from(root.querySelectorAll('[role="option"]')));
      return options.some((option) => {
        const box = option.getBoundingClientRect();
        return box.width && box.height && box.bottom > 0 && box.top < innerHeight &&
          (!option.checkVisibility || option.checkVisibility({checkOpacity: true, checkVisibilityCSS: true}));
      });
    };
    const frame = () => {
      if (finished) return;
      frames += 1;
      if (frames >= 2 && (!autocomplete || suggestionsShowing())) return finish();
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
}"""

# Send the text a person can actually see. An offscreen article body or a page footer
# fills the model's context without saying anything about the screen being acted on.
VISIBLE_TEXT = """function () {
  if (!document.body) return '';
  const seen = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node && seen.length < 200; node = walker.nextNode()) {
    const text = node.nodeValue.replace(/\s+/g, ' ').trim();
    if (text.length < 2) continue;
    const parent = node.parentElement;
    if (!parent || parent.closest('script,style,noscript')) continue;
    const box = parent.getBoundingClientRect();
    if (!box.width || !box.height || box.bottom <= 0 || box.top >= innerHeight) continue;
    if (parent.checkVisibility && !parent.checkVisibility({checkOpacity: true, checkVisibilityCSS: true})) continue;
    seen.push(text.slice(0, 240));
  }
  return seen.join('\n').slice(0, 8000);
}"""

# Choosing from a native dropdown by the option's own text. The caller has already
# checked that the text came from this element's snapshot, so nothing a model wrote
# reaches the page: it points at one of the choices the browser reported.
SELECT_OPTION = """function (label) {
  if (!(this instanceof HTMLSelectElement)) return false;
  const index = Array.from(this.options).findIndex((option) => option.text.replace(/\s+/g, ' ').trim() === label);
  if (index < 0) return false;
  if (this.selectedIndex !== index) {
    this.selectedIndex = index;
    this.dispatchEvent(new Event('input', {bubbles: true}));
    this.dispatchEvent(new Event('change', {bubbles: true}));
  }
  return true;
}"""


def bounded_request(req):
    if not isinstance(req, dict): raise ValueError('Browser request must be an object')
    action = req.get('action', 'snapshot')
    if action not in ('snapshot', 'navigate', 'click', 'fill', 'fill_protected', 'press', 'scroll', 'select', 'tabs', 'select_tab'):
        raise ValueError('Unknown browser action')
    if action == 'fill_protected':
        if not isinstance(os.environ.get('CADRE_PROTECTED_TEXT'), str) or not os.environ.get('CADRE_PROTECTED_TEXT'):
            raise ValueError('Protected text is missing')
        if not isinstance(req.get('secretHost'), str) or not req['secretHost'].strip():
            raise ValueError('A protected fill must name the host the credential belongs to')
        if req.get('secretField') not in ('username', 'password'):
            raise ValueError('A protected fill must name the username or password field')
    if action == 'navigate':
        url = req.get('url', '')
        if not isinstance(url, str) or len(url) > 4096 or urlsplit(url).scheme not in ('http', 'https') or not urlsplit(url).hostname:
            raise ValueError('Use a complete http or https URL')
    if action in ('click', 'fill', 'fill_protected', 'press', 'select'):
        if not isinstance(req.get('snapshotId'), str) or not isinstance(req.get('ref'), str):
            raise ValueError('Use snapshotId and ref from a fresh browser snapshot')
    if action == 'fill' and (not isinstance(req.get('text'), str) or len(req['text']) > 16000):
        raise ValueError('Browser text must be at most 16000 characters')
    if action == 'select' and (not isinstance(req.get('option'), str) or not req['option'] or len(req['option']) > 240):
        raise ValueError('Choose one of the options the snapshot listed for this control')
    if action == 'press' and req.get('key') not in ('Enter', 'Tab', 'Escape', 'ArrowDown', 'ArrowUp', 'Space'):
        raise ValueError('Unsupported browser key')
    return action


def node_options(node, by_id):
    """The choices of a native dropdown, read from its own accessibility children.

    A model can only ever pick one of these, and the page is only ever asked for an
    option it already reported, so choosing from a dropdown writes nothing.
    """
    options = []
    for child in node.get('childIds', []):
        item = by_id.get(child)
        if not item or item.get('ignored'): continue
        if item.get('role', {}).get('value') not in OPTION_ROLES: continue
        label = str(item.get('name', {}).get('value', '')).strip()[:120]
        if label and label not in options: options.append(label)
        if len(options) >= 50: break
    return options


def snapshot_nodes(nodes):
    elements, content, refs = [], [], {}
    by_id = {node.get('nodeId'): node for node in nodes}
    for node in nodes:
        if node.get('ignored'): continue
        role = node.get('role', {}).get('value', '')
        name = str(node.get('name', {}).get('value', ''))[:240]
        if role in ('StaticText', 'heading') and name and len(content) < 120: content.append(name)
        backend = node.get('backendDOMNodeId')
        if role not in ROLES or not backend or len(elements) >= 200: continue
        ref = 'e' + str(len(elements) + 1)
        properties = {p['name']: p.get('value', {}).get('value') for p in node.get('properties', [])}
        row = {'ref': ref, 'role': role, 'name': name}
        # State a decision needs to tell one control from another. Never a field value:
        # a page can already contain a user's credentials.
        for prop in ('disabled', 'checked', 'required', 'selected', 'expanded'):
            if prop in properties: row[prop] = properties[prop]
        options = node_options(node, by_id) if role in LIST_ROLES else []
        if options: row['options'] = options
        elements.append(row)
        refs[ref] = {'backend': backend, 'role': role, 'name': name, 'options': options}
    return elements, '\n'.join(content)[:8000], refs


def human_input_epoch():
    path = os.environ.get('CADRE_HUMAN_INPUT_PATH')
    if not path: return os.environ.get('CADRE_HUMAN_INPUT_EPOCH', '0')
    try: return Path(path).read_text().strip() or '0'
    except FileNotFoundError: return '0'


def validate_human_input(observed):
    if observed != human_input_epoch():
        raise ValueError('The user changed this screen. Take a fresh browser snapshot before acting.')


def host_matches(page_host, saved_host):
    page_host = (page_host or '').strip().lower().rstrip('.')
    saved_host = (saved_host or '').strip().lower().rstrip('.')
    if not page_host or not saved_host: return False
    return page_host == saved_host or page_host.endswith('.' + saved_host)


def validate_reference(state, req, target, loader):
    if state.get('snapshotId') != req.get('snapshotId') or state.get('target') != target or state.get('loader') != loader:
        raise ValueError('The browser snapshot is stale. Take a new snapshot before acting.')
    ref = state.get('refs', {}).get(req.get('ref'))
    if not ref: raise ValueError('Unknown browser reference. Take a new snapshot.')
    return ref


class VisibleBrowser:
    def __init__(self, profile):
        sys.path.insert(0, '/opt/cadre')
        from browser_sessions import Browser
        self.browser = Browser(profile)
        self.cdp = self.browser.cdp
        self.state_path = profile / 'cadre-browser-snapshot.json'
        try: self.state = json.loads(self.state_path.read_text())
        except (FileNotFoundError, ValueError): self.state = {}
        self.pages = [p for p in self.cdp.call('Target.getTargets')['targetInfos'] if p['type'] == 'page']
        if not self.pages: raise ValueError('The visible browser has no tab. Open the browser first.')
        self.page = None
        self.session = None

    def attach(self):
        if self.session:
            try: self.cdp.call('Target.detachFromTarget', {'sessionId': self.session})
            except RuntimeError: pass
        self.session = self.cdp.call('Target.attachToTarget', {'targetId': self.page['targetId'], 'flatten': True})['sessionId']

    def visible_page(self):
        # Observe the tab the human sees. Reading a snapshot must never activate
        # the agent's remembered tab or steal focus from a human-selected tab.
        #
        # Asking costs an attach and an evaluation per tab, on every action, and
        # the answer is nearly always the tab this browser was last acting on.
        # Asking that one first ends the loop on its first pass; the order is
        # all that changes, so a human who moved to another tab is still found.
        remembered = self.state.get('target')
        pages = self.pages
        if remembered:
            pages = sorted(pages, key=lambda page: page['targetId'] != remembered)
        visible = []
        for page in pages:
            self.page = page
            try:
                self.attach()
                visibility = self.call('Runtime.evaluate', {'expression': '({visible:document.visibilityState === "visible",focused:document.hasFocus()})', 'returnByValue': True})['result'].get('value', {})
                if visibility.get('visible'):
                    if visibility.get('focused'): return page
                    visible.append(page)
            except RuntimeError: continue  # A human may have closed this tab.
        if len(visible) == 1: return visible[0]
        if len(visible) > 1:
            raise ValueError('Several browser windows are visible. Select a tab explicitly before acting.')
        raise ValueError('No browser tab is visible. Open a browser tab or select one explicitly.')

    def call(self, method, params=None):
        return self.cdp.call(method, params, self.session)

    def loader(self):
        return self.call('Page.getFrameTree')['frameTree']['frame'].get('loaderId')

    def top_frame_url(self, backend):
        # The document URL comes from the browser's own frame tree, never from page
        # JavaScript, which a hostile page controls. The node must also live in the top
        # frame: an iframe carries its own origin and the frame tree URL would not describe it.
        frame = self.call('Page.getFrameTree')['frameTree']['frame']
        try:
            self.call('Page.enable')
            context = self.call('Page.createIsolatedWorld', {'frameId': frame['frameId']})['executionContextId']
            self.call('DOM.resolveNode', {'backendNodeId': backend, 'executionContextId': context})
        except RuntimeError:
            raise ValueError('A saved login can only be typed into the top-level page, not a frame. Request user takeover for this field.')
        return frame.get('url', '')

    def validate_secret_target(self, req, backend, attributes):
        field_type = attributes.get('type', '').lower()
        autocomplete = attributes.get('autocomplete', '').lower()
        if req['secretField'] == 'password':
            if field_type != 'password' and autocomplete not in ('current-password', 'new-password'):
                raise ValueError('That field is not a password field. Take a fresh snapshot and choose the password field.')
        elif field_type == 'password':
            raise ValueError('That field is a password field. Use field password for it.')
        url = self.top_frame_url(backend)
        parts = urlsplit(url)
        if parts.scheme != 'https':
            raise ValueError('A saved login is only typed into pages served over https.')
        if not host_matches(parts.hostname, req['secretHost']):
            raise ValueError('This page is not ' + req['secretHost'] + '. A saved login is only typed into the site it belongs to.')
    def isolated_world(self):
        # Reads and waits run beside the page, not inside it: the page cannot observe
        # them and its own overrides of the DOM and timer APIs do not apply.
        self.call('Page.enable')
        frame = self.call('Page.getFrameTree')['frameTree']['frame']['id']
        return self.call('Page.createIsolatedWorld', {'frameId': frame, 'worldName': 'cadre'})['executionContextId']

    def run(self, script, backend=None, argument=None):
        """Run one of this file's own scripts beside the page, optionally on a node."""
        context = self.isolated_world()
        if backend is None:
            return self.call('Runtime.evaluate', {'expression': '(' + script + ')()', 'contextId': context, 'awaitPromise': True, 'returnByValue': True})['result'].get('value')
        target = self.call('DOM.resolveNode', {'backendNodeId': backend, 'executionContextId': context})['object']['objectId']
        return self.call('Runtime.callFunctionOn', {'functionDeclaration': script, 'objectId': target, 'arguments': [{'value': argument}], 'awaitPromise': True, 'returnByValue': True})['result'].get('value')

    def settle(self, backend, autocomplete):
        try:
            if backend is None:
                self.call('Runtime.evaluate', {'expression': '(' + SETTLE + ')(false)', 'contextId': self.isolated_world(), 'awaitPromise': True, 'returnByValue': True})
            else:
                self.run(SETTLE, backend, autocomplete)
        except (RuntimeError, TimeoutError, KeyError):
            # A page mid-navigation has no node and no world to wait in, which is the
            # ordinary case after a click that follows a link. Navigation still polls
            # readyState briefly; other actions already waited two frames.
            time.sleep(.05)

    def show_cursor(self, viewport_x, viewport_y, origin=None):
        """Warp the real X cursor so the VNC viewer sees the click. Never blocks the click."""
        try:
            origin = origin or self.state.get('chrome') or {}
            if not origin:
                origin = self.call('Runtime.evaluate', {
                    'expression': '({x:window.screenX,y:window.screenY,chrome:Math.max(0,window.outerHeight-window.innerHeight),border:Math.max(0,window.outerWidth-window.innerWidth)})',
                    'returnByValue': True,
                })['result'].get('value') or {}
            sx = int(origin.get('x', 0) + origin.get('border', 0) / 2 + viewport_x)
            sy = int(origin.get('y', 0) + origin.get('chrome', 0) + viewport_y)
            env = {**os.environ, 'DISPLAY': os.environ.get('DISPLAY', ':1')}
            subprocess.Popen(
                ['xdotool', 'mousemove', '--', str(sx), str(sy)],
                env=env,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
        except Exception:
            pass

    def visible_text(self, fallback):
        try:
            text = self.run(VISIBLE_TEXT)
        except (RuntimeError, TimeoutError, KeyError):
            return fallback
        return text if isinstance(text, str) and text.strip() else fallback

    def save(self, state):
        temporary = self.state_path.with_suffix('.tmp')
        temporary.write_text(json.dumps(state)); temporary.chmod(0o600); temporary.replace(self.state_path)

    def snapshot(self):
        epoch = human_input_epoch()
        nodes = self.call('Accessibility.getFullAXTree')['nodes']
        elements, content, refs = snapshot_nodes(nodes)
        snapshot_id = uuid.uuid4().hex
        state = {'snapshotId': snapshot_id, 'target': self.page['targetId'], 'loader': self.loader(), 'refs': refs, 'pages': [p['targetId'] for p in self.pages], 'humanInputEpoch': epoch}
        current = self.call('Runtime.evaluate', {'expression': '({url:location.href,title:document.title,x:window.screenX,y:window.screenY,chrome:Math.max(0,window.outerHeight-window.innerHeight),border:Math.max(0,window.outerWidth-window.innerWidth)})', 'returnByValue': True})['result'].get('value', {})
        state['chrome'] = {key: current.get(key, 0) for key in ('x', 'y', 'chrome', 'border')}
        text = self.visible_text(content)
        validate_human_input(epoch)
        self.save(state)
        return {'url': current.get('url'), 'title': current.get('title'), 'snapshotId': snapshot_id, 'elements': elements, 'text': text, 'visible': True}

    def act(self, req):
        action = bounded_request(req)
        starting_epoch = human_input_epoch()
        settle_node, settle_autocomplete = None, False
        if action == 'tabs': return {'tabs': [{'id': p['targetId'], 'title': p['title'][:240], 'url': p['url']} for p in self.pages]}
        if action == 'select_tab':
            self.page = next((p for p in self.pages if p['targetId'] == req.get('tabId')), None)
            if not self.page: raise ValueError('Unknown tab. List tabs again.')
        else:
            self.page = self.visible_page()
        self.attach()
        if action == 'select_tab':
            validate_human_input(starting_epoch)
            self.call('Page.bringToFront')
        if action in ('click', 'fill', 'fill_protected', 'press', 'select'):
            validate_human_input(self.state.get('humanInputEpoch', '0'))
            ref = validate_reference(self.state, req, self.page['targetId'], self.loader())
            # A rerender can replace a control without navigating. Refuse replaced nodes.
            tree = self.call('Accessibility.getPartialAXTree', {'backendNodeId': ref['backend'], 'fetchRelatives': False})['nodes']
            current = next((n for n in tree if n.get('backendDOMNodeId') == ref['backend'] and not n.get('ignored')), None)
            if not current or current.get('role', {}).get('value') != ref['role'] or str(current.get('name', {}).get('value', ''))[:240] != ref['name']:
                raise ValueError('The control changed. Take a fresh browser snapshot.')
            description = self.call('DOM.describeNode', {'backendNodeId': ref['backend']})['node']
            attributes = dict(zip(description.get('attributes', [])[::2], description.get('attributes', [])[1::2]))
            if action in ('fill', 'fill_protected') and ref['role'] not in ('textbox', 'searchbox', 'combobox', 'spinbutton'):
                raise ValueError('This control is not a text field. Take a fresh snapshot.')
            if action == 'select' and req['option'] not in ref.get('options', []):
                raise ValueError('That option was not in this control. Take a fresh snapshot.')
            if action == 'fill' and (attributes.get('type', '').lower() == 'password' or attributes.get('autocomplete', '').lower() in ('one-time-code', 'current-password', 'new-password')):
                raise ValueError('Use protected secret entry or request user takeover for this field.')
            validate_human_input(self.state.get('humanInputEpoch', '0'))
            option = req['option'] if action == 'select' else None
            settle_node = ref['backend']
            # Only a combobox opens a suggestion list worth waiting for.
            settle_autocomplete = action in ('fill', 'fill_protected') and ref['role'] == 'combobox'
            chrome = self.state.get('chrome')
            self.save({})  # Consume refs before mutation, even if the action times out.
            self.call('DOM.scrollIntoViewIfNeeded', {'backendNodeId': ref['backend']})
            if action == 'select':
                # A native dropdown has no on-screen list to click: Chromium renders it
                # outside the page. Choosing the option the snapshot reported is the only
                # way to operate one, and it still writes nothing the page did not supply.
                self.call('DOM.focus', {'backendNodeId': ref['backend']})
                if not self.run(SELECT_OPTION, ref['backend'], option):
                    raise ValueError('This control is not a dropdown, or that option is gone. Take a fresh snapshot.')
            elif action == 'click':
                box = self.call('DOM.getBoxModel', {'backendNodeId': ref['backend']})['model']['content']
                x, y = sum(box[::2]) / 4, sum(box[1::2]) / 4
                self.show_cursor(x, y, chrome)
                for kind in ('mouseMoved', 'mousePressed', 'mouseReleased'):
                    self.call('Input.dispatchMouseEvent', {'type': kind, 'x': x, 'y': y, 'button': 'left' if kind != 'mouseMoved' else 'none', 'clickCount': 1})
            else:
                self.call('DOM.focus', {'backendNodeId': ref['backend']})
                if action in ('fill', 'fill_protected'):
                    self.call('Input.dispatchKeyEvent', {'type': 'keyDown', 'key': 'a', 'code': 'KeyA', 'modifiers': 2, 'windowsVirtualKeyCode': 65})
                    self.call('Input.dispatchKeyEvent', {'type': 'keyUp', 'key': 'a', 'code': 'KeyA', 'modifiers': 2, 'windowsVirtualKeyCode': 65})
                    # A protected value is typed from the environment and never appears in the
                    # request, the snapshot, or this process's arguments. The page is checked
                    # here, immediately before the keystrokes, so a navigation cannot race it.
                    if action == 'fill_protected': self.validate_secret_target(req, ref['backend'], attributes)
                    self.call('Input.insertText', {'text': os.environ['CADRE_PROTECTED_TEXT'] if action == 'fill_protected' else req['text']})
                else:
                    codes = {'Enter': 13, 'Tab': 9, 'Escape': 27, 'ArrowDown': 40, 'ArrowUp': 38, 'Space': 32}
                    for kind in ('keyDown', 'keyUp'):
                        self.call('Input.dispatchKeyEvent', {'type': kind, 'key': ' ' if req['key'] == 'Space' else req['key'], 'code': req['key'], 'windowsVirtualKeyCode': codes[req['key']], **({'text': '\r'} if req['key'] == 'Enter' and kind == 'keyDown' else {})})
        elif action == 'navigate':
            validate_human_input(starting_epoch)
            self.save({})
            result = self.call('Page.navigate', {'url': req['url']})
            if result.get('errorText'): raise ValueError('Browser navigation failed')
        elif action == 'scroll':
            validate_human_input(starting_epoch)
            self.save({})
            self.call('Input.dispatchMouseEvent', {'type': 'mouseWheel', 'x': 640, 'y': 400, 'deltaX': 0, 'deltaY': -500 if req.get('direction') == 'up' else 500})
        try:
            if action == 'navigate':
                # A navigation that has been asked for has not yet replaced the document,
                # so the old page would still read as ready. Nothing to observe yet.
                time.sleep(.2)
                for _ in range(5):
                    try:
                        ready = self.call('Runtime.evaluate', {'expression': 'document.readyState', 'returnByValue': True})['result'].get('value')
                        if ready in ('interactive', 'complete'): break
                    except RuntimeError: pass
                    time.sleep(.05)
            elif action != 'snapshot':
                self.settle(settle_node, settle_autocomplete)
            pages = [p for p in self.cdp.call('Target.getTargets')['targetInfos'] if p['type'] == 'page']
            self.pages = pages
            self.page = self.visible_page()
            self.attach()
            return self.snapshot()
        except Exception as error:
            if action == 'snapshot': raise
            raise ValueError(
                'The browser action was dispatched, but its result could not be observed. '
                'Do not repeat the action automatically: take a fresh browser snapshot and '
                'verify its effects before deciding what to do next.'
            ) from error



def main(req):
    bounded_request(req)
    profile = Path(os.environ.get('CADRE_BROWSER_PROFILE', ''))
    if not profile.is_absolute() or not (profile / 'DevToolsActivePort').is_file():
        raise ValueError('Structured browser control is unavailable. Use the visible desktop tools.')
    browser = VisibleBrowser(profile)
    try: return browser.act(req)
    finally: browser.cdp.close()


if __name__ == '__main__':
    try: print(json.dumps(main(json.loads(sys.argv[1]))))
    except ValueError as error: print(json.dumps({'error': str(error)}))
    except Exception: print(json.dumps({'error': 'Browser action could not finish. Take a fresh snapshot or use the visible desktop.'}))
