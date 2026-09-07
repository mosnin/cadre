"""Operate the existing visible Chromium through its loopback DevTools endpoint.

No page-supplied JavaScript is executed. References name backend DOM nodes from
one accessibility snapshot and are invalidated after every action/navigation.
"""
import json
import os
from pathlib import Path
import sys
import time
import uuid
from urllib.parse import urlsplit

ROLES = {'button', 'link', 'textbox', 'searchbox', 'combobox', 'checkbox', 'radio', 'tab', 'menuitem', 'switch', 'slider', 'spinbutton'}


def bounded_request(req):
    if not isinstance(req, dict): raise ValueError('Browser request must be an object')
    action = req.get('action', 'snapshot')
    if action not in ('snapshot', 'navigate', 'click', 'fill', 'press', 'scroll', 'tabs', 'select_tab'):
        raise ValueError('Unknown browser action')
    if action == 'navigate':
        url = req.get('url', '')
        if not isinstance(url, str) or len(url) > 4096 or urlsplit(url).scheme not in ('http', 'https') or not urlsplit(url).hostname:
            raise ValueError('Use a complete http or https URL')
    if action in ('click', 'fill', 'press'):
        if not isinstance(req.get('snapshotId'), str) or not isinstance(req.get('ref'), str):
            raise ValueError('Use snapshotId and ref from a fresh browser snapshot')
    if action == 'fill' and (not isinstance(req.get('text'), str) or len(req['text']) > 16000):
        raise ValueError('Browser text must be at most 16000 characters')
    if action == 'press' and req.get('key') not in ('Enter', 'Tab', 'Escape', 'ArrowDown', 'ArrowUp', 'Space'):
        raise ValueError('Unsupported browser key')
    return action


def snapshot_nodes(nodes):
    elements, content, refs = [], [], {}
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
        for prop in ('disabled', 'checked', 'required'):
            if prop in properties: row[prop] = properties[prop]
        # Never return field values; a page can already contain a user's credentials.
        elements.append(row)
        refs[ref] = {'backend': backend, 'role': role, 'name': name}
    return elements, '\n'.join(content)[:8000], refs


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
        newly_opened = [p for p in self.pages if self.state.get('pages') and p['targetId'] not in self.state['pages']]
        self.page = newly_opened[-1] if newly_opened else next((p for p in self.pages if p['targetId'] == self.state.get('target')), self.pages[-1])
        self.session = None

    def attach(self):
        self.session = self.cdp.call('Target.attachToTarget', {'targetId': self.page['targetId'], 'flatten': True})['sessionId']

    def call(self, method, params=None):
        return self.cdp.call(method, params, self.session)

    def loader(self):
        return self.call('Page.getFrameTree')['frameTree']['frame'].get('loaderId')

    def save(self, state):
        temporary = self.state_path.with_suffix('.tmp')
        temporary.write_text(json.dumps(state)); temporary.chmod(0o600); temporary.replace(self.state_path)

    def snapshot(self):
        nodes = self.call('Accessibility.getFullAXTree')['nodes']
        elements, content, refs = snapshot_nodes(nodes)
        snapshot_id = uuid.uuid4().hex
        state = {'snapshotId': snapshot_id, 'target': self.page['targetId'], 'loader': self.loader(), 'refs': refs, 'pages': [p['targetId'] for p in self.pages]}
        self.save(state)
        current = self.call('Runtime.evaluate', {'expression': '({url:location.href,title:document.title})', 'returnByValue': True})['result'].get('value', {})
        return {**current, 'snapshotId': snapshot_id, 'elements': elements, 'text': content, 'visible': True}

    def act(self, req):
        action = bounded_request(req)
        if action == 'tabs': return {'tabs': [{'id': p['targetId'], 'title': p['title'][:240], 'url': p['url']} for p in self.pages]}
        if action == 'select_tab':
            self.page = next((p for p in self.pages if p['targetId'] == req.get('tabId')), None)
            if not self.page: raise ValueError('Unknown tab. List tabs again.')
        self.attach()
        self.call('Page.bringToFront')
        if action in ('click', 'fill', 'press'):
            ref = validate_reference(self.state, req, self.page['targetId'], self.loader())
            # A rerender can replace a control without navigating. Refuse replaced nodes.
            tree = self.call('Accessibility.getPartialAXTree', {'backendNodeId': ref['backend'], 'fetchRelatives': False})['nodes']
            current = next((n for n in tree if n.get('backendDOMNodeId') == ref['backend'] and not n.get('ignored')), None)
            if not current or current.get('role', {}).get('value') != ref['role'] or str(current.get('name', {}).get('value', ''))[:240] != ref['name']:
                raise ValueError('The control changed. Take a fresh browser snapshot.')
            description = self.call('DOM.describeNode', {'backendNodeId': ref['backend']})['node']
            attributes = dict(zip(description.get('attributes', [])[::2], description.get('attributes', [])[1::2]))
            if action == 'fill' and ref['role'] not in ('textbox', 'searchbox', 'combobox', 'spinbutton'):
                raise ValueError('This control is not a text field. Take a fresh snapshot.')
            if action == 'fill' and (attributes.get('type', '').lower() == 'password' or attributes.get('autocomplete', '').lower() in ('one-time-code', 'current-password', 'new-password')):
                raise ValueError('Use protected secret entry or request user takeover for this field.')
            self.save({})  # Consume refs before mutation, even if the action times out.
            self.call('DOM.scrollIntoViewIfNeeded', {'backendNodeId': ref['backend']})
            if action == 'click':
                box = self.call('DOM.getBoxModel', {'backendNodeId': ref['backend']})['model']['content']
                x, y = sum(box[::2]) / 4, sum(box[1::2]) / 4
                for kind in ('mouseMoved', 'mousePressed', 'mouseReleased'):
                    self.call('Input.dispatchMouseEvent', {'type': kind, 'x': x, 'y': y, 'button': 'left' if kind != 'mouseMoved' else 'none', 'clickCount': 1})
            else:
                self.call('DOM.focus', {'backendNodeId': ref['backend']})
                if action == 'fill':
                    self.call('Input.dispatchKeyEvent', {'type': 'keyDown', 'key': 'a', 'code': 'KeyA', 'modifiers': 2, 'windowsVirtualKeyCode': 65})
                    self.call('Input.dispatchKeyEvent', {'type': 'keyUp', 'key': 'a', 'code': 'KeyA', 'modifiers': 2, 'windowsVirtualKeyCode': 65})
                    self.call('Input.insertText', {'text': req['text']})
                else:
                    codes = {'Enter': 13, 'Tab': 9, 'Escape': 27, 'ArrowDown': 40, 'ArrowUp': 38, 'Space': 32}
                    for kind in ('keyDown', 'keyUp'):
                        self.call('Input.dispatchKeyEvent', {'type': kind, 'key': ' ' if req['key'] == 'Space' else req['key'], 'code': req['key'], 'windowsVirtualKeyCode': codes[req['key']], **({'text': '\r'} if req['key'] == 'Enter' and kind == 'keyDown' else {})})
        elif action == 'navigate':
            self.save({})
            result = self.call('Page.navigate', {'url': req['url']})
            if result.get('errorText'): raise ValueError('Browser navigation failed')
        elif action == 'scroll':
            self.save({})
            self.call('Input.dispatchMouseEvent', {'type': 'mouseWheel', 'x': 640, 'y': 400, 'deltaX': 0, 'deltaY': -500 if req.get('direction') == 'up' else 500})
        if action != 'snapshot':
            time.sleep(.2)
            for _ in range(20):
                try:
                    ready = self.call('Runtime.evaluate', {'expression': 'document.readyState', 'returnByValue': True})['result'].get('value')
                    if ready in ('interactive', 'complete'): break
                except RuntimeError: pass
                time.sleep(.1)
        pages = [p for p in self.cdp.call('Target.getTargets')['targetInfos'] if p['type'] == 'page']
        new_pages = [p for p in pages if p['targetId'] not in {old['targetId'] for old in self.pages}]
        if new_pages:
            self.page = new_pages[-1]
            self.attach()
            self.call('Page.bringToFront')
        self.pages = pages
        return self.snapshot()


def main(req):
    bounded_request(req)
    profile = Path(os.environ.get('RAKAZO_BROWSER_PROFILE', ''))
    if not profile.is_absolute() or not (profile / 'DevToolsActivePort').is_file():
        raise ValueError('Structured browser control is unavailable. Use the visible desktop tools.')
    browser = VisibleBrowser(profile)
    try: return browser.act(req)
    finally: browser.cdp.close()


if __name__ == '__main__':
    try: print(json.dumps(main(json.loads(sys.argv[1]))))
    except ValueError as error: print(json.dumps({'error': str(error)}))
    except Exception: print(json.dumps({'error': 'Browser action could not finish. Take a fresh snapshot or use the visible desktop.'}))
