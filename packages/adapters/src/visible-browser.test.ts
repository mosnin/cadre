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
