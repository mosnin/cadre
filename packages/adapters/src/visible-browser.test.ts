import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const script = fileURLToPath(new URL("./visible-browser.py", import.meta.url));
function python(body: string) {
  return execFileSync(
    "python3",
    ["-c", `import runpy, json\nm = runpy.run_path(${JSON.stringify(script)})\n${body}`],
    { encoding: "utf8" },
  );
}

it("refuses executable navigation schemes and oversized field input", () => {
  expect(
    python(`
for request in [{'action':'navigate','url':'javascript:alert(1)'},{'action':'navigate','url':'file:///etc/passwd'},{'action':'fill','ref':'e1','snapshotId':'s','text':'a'*16001}]:
    try: m['bounded_request'](request)
    except ValueError: continue
    raise Exception('unsafe request accepted')
print('rejected')`),
  ).toContain("rejected");
});

it("rejects stale snapshots, navigated pages, and invented references", () => {
  expect(
    python(`
state={'snapshotId':'s','target':'tab','loader':'doc','refs':{'e1':{'backend':1}}}
for request,target,loader in [({'snapshotId':'old','ref':'e1'},'tab','doc'),({'snapshotId':'s','ref':'e1'},'new','doc'),({'snapshotId':'s','ref':'e1'},'tab','newdoc'),({'snapshotId':'s','ref':'e99'},'tab','doc')]:
    try: m['validate_reference'](state,request,target,loader)
    except ValueError: continue
    raise Exception('stale reference accepted')
print('rejected')`),
  ).toContain("rejected");
});

it("returns named controls without exposing stored field values", () => {
  const result = JSON.parse(
    python(`
nodes=[{'role':{'value':'textbox'},'name':{'value':'Password'},'value':{'value':'private-secret'},'backendDOMNodeId':8}, {'role':{'value':'button'},'name':{'value':'Save'},'backendDOMNodeId':9,'ignored':True}]
print(json.dumps(m['snapshot_nodes'](nodes)))`),
  );
  expect(result[0]).toEqual([{ ref: "e1", role: "textbox", name: "Password" }]);
  expect(JSON.stringify(result)).not.toContain("private-secret");
});

it("observes the human-selected tab without activating the previous agent tab", () => {
  expect(
    python(`
class FakeCDP:
    def call(self, method, params=None, session=None):
        if method == 'Target.attachToTarget': return {'sessionId':params['targetId']}
        if method == 'Target.detachFromTarget': return {}
        if method == 'Target.getTargets': return {'targetInfos':[{'type':'page','targetId':'old'},{'type':'page','targetId':'human'}]}
        if method == 'Runtime.evaluate': return {'result':{'value':{'visible':session == 'human','focused':session == 'human'}}}
        raise Exception('Unexpected mutation: '+method)
browser=m['VisibleBrowser'].__new__(m['VisibleBrowser'])
browser.cdp=FakeCDP()
browser.pages=[{'targetId':'old'},{'targetId':'human'}]
browser.session=None
browser.state={'target':'old','snapshotId':'s','loader':'doc','refs':{'e1':{'backend':1}}}
browser.snapshot=lambda: {'target':browser.page['targetId']}
browser.loader=lambda: 'doc'
assert browser.act({'action':'snapshot'}) == {'target':'human'}
try: browser.act({'action':'click','snapshotId':'s','ref':'e1'})
except ValueError as e: assert 'stale' in str(e)
else: raise Exception('acted on a tab the human left')
print('human tab preserved')`),
  ).toContain("human tab preserved");
});

it("invalidates same-page references after human input and accepts a fresh observation", () => {
  expect(
    python(`
import os,tempfile,pathlib
with tempfile.TemporaryDirectory() as root:
    path=pathlib.Path(root)/'epoch'
    path.write_text('7')
    os.environ['CADRE_HUMAN_INPUT_PATH']=str(path)
    observed=m['human_input_epoch']()
    assert observed=='7'
    path.write_text('8')
    try:m['validate_human_input'](observed)
    except ValueError as e:assert 'fresh browser snapshot' in str(e)
    else:raise Exception('stale human input epoch accepted')
    m['validate_human_input'](m['human_input_epoch']())
print('fenced')`),
  ).toContain("fenced");
});

it("preserves dispatched action uncertainty when the follow-up observation fails", () => {
  expect(
    python(`
class FakeCDP:
    def call(self, method, params=None, session=None):
        if method == 'Target.getTargets': return {'targetInfos':[{'type':'page','targetId':'tab'}]}
        raise Exception('unexpected call')
browser=m['VisibleBrowser'].__new__(m['VisibleBrowser'])
browser.cdp=FakeCDP()
browser.pages=[{'targetId':'tab'}]
browser.visible_page=lambda: browser.pages[0]
browser.attach=lambda: None
browser.save=lambda state: None
calls=[]
def call(method, params=None):
    calls.append(method)
    if method == 'Page.navigate': return {}
    if method == 'Runtime.evaluate': return {'result':{'value':'complete'}}
    raise Exception('unexpected call')
browser.call=call
def snapshot(): raise ValueError('The user changed this screen')
browser.snapshot=snapshot
try: browser.act({'action':'navigate','url':'https://example.test'})
except ValueError as e:
    assert 'was dispatched' in str(e) and 'Do not repeat' in str(e)
else: raise Exception('lost uncertain action outcome')
assert calls.count('Page.navigate') == 1
try: browser.act({'action':'snapshot'})
except ValueError as e: assert 'was dispatched' not in str(e)
else: raise Exception('snapshot failure swallowed')
print('outcome preserved')`),
  ).toContain("outcome preserved");
});

it("requires a protected fill to name the host and the field it belongs to", () => {
  expect(
    python(`
import os
os.environ['CADRE_PROTECTED_TEXT']='secret'
for request in [{'action':'fill_protected','snapshotId':'s','ref':'e1'},{'action':'fill_protected','snapshotId':'s','ref':'e1','secretHost':' ','secretField':'password'},{'action':'fill_protected','snapshotId':'s','ref':'e1','secretHost':'bank.example','secretField':'anything'}]:
    try: m['bounded_request'](request)
    except ValueError: continue
    raise Exception('unbound protected fill accepted')
print(m['bounded_request']({'action':'fill_protected','snapshotId':'s','ref':'e1','secretHost':'bank.example','secretField':'password'}))`),
  ).toContain("fill_protected");
});

it("types a saved login only into its own site, never a subdomain impostor", () => {
  const matches = JSON.parse(
    python(`
pairs=[('bank.example','bank.example'),('accounts.bank.example','bank.example'),('BANK.EXAMPLE.','bank.example'),('bank.example.evil.test','bank.example'),('evilbank.example','bank.example'),('','bank.example')]
print(json.dumps([m['host_matches'](page, saved) for page, saved in pairs]))`),
  );
  expect(matches).toEqual([true, true, true, false, false, false]);
});

it("lists a native dropdown's own choices and still exposes no field value", () => {
  const result = JSON.parse(
    python(`
nodes=[{'nodeId':'1','role':{'value':'combobox'},'name':{'value':'Country'},'value':{'value':'private-secret'},'backendDOMNodeId':4,'childIds':['2','3','4']},
 {'nodeId':'2','role':{'value':'menuitem'},'name':{'value':'Ireland'}},
 {'nodeId':'3','role':{'value':'menuitem'},'name':{'value':'Japan'},'ignored':True},
 {'nodeId':'4','role':{'value':'StaticText'},'name':{'value':'Pick one'}}]
print(json.dumps(m['snapshot_nodes'](nodes)))`),
  );
  expect(result[0]).toEqual([
    { ref: "e1", role: "combobox", name: "Country", options: ["Ireland"] },
  ]);
  expect(JSON.stringify(result)).not.toContain("private-secret");
});

it("chooses a dropdown option the snapshot listed, and nothing else", () => {
  expect(
    python(`
for request in [{'action':'select','snapshotId':'s','ref':'e1'},{'action':'select','snapshotId':'s','ref':'e1','option':''},{'action':'select','snapshotId':'s','ref':'e1','option':'x'*241}]:
    try: m['bounded_request'](request)
    except ValueError: continue
    raise Exception('unusable selection accepted')

def browser(calls):
    b=m['VisibleBrowser'].__new__(m['VisibleBrowser'])
    b.pages=[{'targetId':'tab'}]
    b.page=b.pages[0]
    b.visible_page=lambda: b.pages[0]
    b.attach=lambda: None
    b.save=lambda state: None
    b.loader=lambda: 'doc'
    b.snapshot=lambda: {'ok':True}
    b.state={'snapshotId':'s','target':'tab','loader':'doc','humanInputEpoch':'0','refs':{'e1':{'backend':4,'role':'combobox','name':'Country','options':['Ireland','Japan']}}}
    class FakeCDP:
        def call(self, method, params=None, session=None): return {'targetInfos':[{'type':'page','targetId':'tab'}]}
    b.cdp=FakeCDP()
    def call(method, params=None):
        calls.append((method, params))
        if method == 'Accessibility.getPartialAXTree': return {'nodes':[{'backendDOMNodeId':4,'role':{'value':'combobox'},'name':{'value':'Country'}}]}
        if method == 'DOM.describeNode': return {'node':{'attributes':[]}}
        if method == 'Page.getFrameTree': return {'frameTree':{'frame':{'id':'f','loaderId':'doc'}}}
        if method == 'Page.createIsolatedWorld': return {'executionContextId':11}
        if method == 'DOM.resolveNode': return {'object':{'objectId':'o'}}
        if method == 'Runtime.callFunctionOn': return {'result':{'value':True}}
        if method == 'Runtime.evaluate': return {'result':{'value':'complete'}}
        return {}
    b.call=call
    return b

calls=[]
b=browser(calls)
try: b.act({'action':'select','snapshotId':'s','ref':'e1','option':'Narnia'})
except ValueError as e: assert 'not in this control' in str(e), str(e)
else: raise Exception('accepted an option the browser never reported')
assert not any(method.startswith('Input.') for method, _ in calls)

calls=[]
b=browser(calls)
assert b.act({'action':'select','snapshotId':'s','ref':'e1','option':'Japan'}) == {'ok':True}
chosen=[params for method, params in calls if method == 'Runtime.callFunctionOn']
assert chosen[0]['arguments'] == [{'value':'Japan'}]
# A selection is a choice, never typing: no text or key ever reaches the page.
assert not any(method.startswith('Input.') for method, _ in calls)
assert ('DOM.focus', {'backendNodeId':4}) in calls
print('selected')`),
  ).toContain("selected");
});

it("waits for the page to settle, longer only for a suggestion list", () => {
  expect(
    python(`
def budget(role, action):
    waits=[]
    b=m['VisibleBrowser'].__new__(m['VisibleBrowser'])
    def call(method, params=None):
        if method == 'Page.enable': return {}
        if method == 'Page.getFrameTree': return {'frameTree':{'frame':{'id':'f'}}}
        if method == 'Page.createIsolatedWorld': return {'executionContextId':11}
        if method == 'DOM.resolveNode': return {'object':{'objectId':'o'}}
        if method == 'Runtime.callFunctionOn':
            waits.append(params['arguments'][0]['value'])
            return {'result':{'value':True}}
        raise Exception('unexpected '+method)
    b.call=call
    b.settle(4, action in ('fill','fill_protected') and role == 'combobox')
    return waits

assert budget('combobox','fill') == [True]
assert budget('textbox','fill') == [False]
assert budget('button','click') == [False]
# The script itself asks for two animation frames and caps each wait.
assert 'requestAnimationFrame' in m['SETTLE'] and 'frames >= 2' in m['SETTLE']
assert 'autocomplete ? 200 : 50' in m['SETTLE']
print('settled')`),
  ).toContain("settled");
});

it("reuses one worker session instead of opening a new CDP connection per action", () => {
  expect(
    python(`
import os, pathlib, tempfile, threading, time
with tempfile.TemporaryDirectory() as root:
    path = str(pathlib.Path(root) / 'w.sock')
    seen = []
    def fake_run(req, browser=None):
        live = browser if browser is not None else object()
        seen.append('new' if browser is None else 'reuse')
        return {'ok': req.get('action')}, live
    m['serve'].__globals__['run_request'] = fake_run
    threading.Thread(target=lambda: m['serve'](path), daemon=True).start()
    for _ in range(50):
        if os.path.exists(path): break
        time.sleep(0.02)
    first = m['call_worker']({'action': 'snapshot'}, path)
    second = m['call_worker']({'action': 'click', 'snapshotId': 's', 'ref': 'e1'}, path)
    assert first == {'ok': 'snapshot'}
    assert second == {'ok': 'click'}
    assert seen == ['new', 'reuse']
print('reused')`),
  ).toContain("reused");
});

it("does not poll readyState after a click, and warps the visible cursor first", () => {
  expect(
    python(`
popened=[]
class FakePopen:
    def __init__(self, argv, **kwargs):
        popened.append(argv)
b=m['VisibleBrowser'].__new__(m['VisibleBrowser'])
b.state={'chrome':{'x':10,'y':20,'chrome':80,'border':0}}
calls=[]
b.call=lambda method, params=None: calls.append(method) or {'result':{'value':{}}}
m['subprocess'].Popen = FakePopen
b.show_cursor(12, 34)
assert calls == []
assert popened[0] == ['xdotool', 'mousemove', '--', '22', '134']
src=open(${JSON.stringify(script)}).read()
assert "for _ in range(20)" not in src
assert "for _ in range(5)" in src
assert "state['chrome']" in src
print('pointer')`),
  ).toContain("pointer");
});
