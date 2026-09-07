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
