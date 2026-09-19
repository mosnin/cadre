import type { AgentSkill, AgentSkillCatalogEntry, CapabilityInstall } from "@cadre/contracts";
import { buildSkillMd, parseSkillMd, validatePluginBundle } from "@cadre/core";
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Input,
  Textarea,
} from "@cadre/ui-web";
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useId, useRef, useState } from "react";
import { rpc } from "../lib/rpc";

export function WorkspaceLibrary({
  onClose,
  onChange,
}: {
  onClose: () => void;
  onChange: () => void;
}) {
  const { t } = useLingui();
  const fieldId = useId();
  const [skills, setSkills] = useState<AgentSkillCatalogEntry[]>([]);
  const [plugins, setPlugins] = useState<CapabilityInstall[]>([]);
  const [loading, setLoading] = useState(true);
  const [choosingPlugin, setChoosingPlugin] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const [editor, setEditor] = useState<AgentSkill | "new" | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [content, setContent] = useState("");
  const [copyOrigin, setCopyOrigin] = useState<Record<string, unknown> | null>(null);
  const [pendingPlugin, setPendingPlugin] = useState<{
    name: string;
    files: { path: string; content: string }[];
  } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<
    AgentSkillCatalogEntry | CapabilityInstall | null
  >(null);
  const generation = useRef(0);
  const skillUpload = useRef<HTMLInputElement>(null);
  const pluginUpload = useRef<HTMLInputElement>(null);
  const bundleUpload = useRef<HTMLInputElement>(null);

  async function refresh() {
    const current = ++generation.current;
    const [nextSkills, installs] = await Promise.all([
      rpc.agentSkills.list(),
      rpc.capabilities.list(),
    ]);
    if (current !== generation.current) return;
    setSkills(nextSkills);
    setPlugins(installs.filter((item) => item.kind === "plugin"));
    setLoading(false);
  }
  useEffect(() => {
    void refresh().catch((cause) => {
      setError(cause instanceof Error ? cause.message : t`Could not load library`);
      setLoading(false);
    });
    return () => {
      generation.current++;
    };
  }, []);

  async function run(action: () => Promise<void>) {
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t`Could not save changes`);
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  async function refreshSaved() {
    onChange();
    try {
      await refresh();
    } catch {
      setLoading(false);
      setError(t`Changes saved. Reload the library to see them.`);
    }
  }
  function create() {
    setCopyOrigin(null);
    setEditor("new");
    setName("");
    setDescription("");
    setContent("");
    setError("");
  }
  async function open(skill: AgentSkillCatalogEntry) {
    await run(async () => {
      const full = await rpc.agentSkills.get({ skillId: skill.id });
      setEditor(full);
      setContent(full.content);
    });
  }
  async function save() {
    await run(async () => {
      if (editor === "new")
        await rpc.agentSkills.create({
          content: buildSkillMd({
            name,
            description,
            body: content,
            frontmatter: copyOrigin ?? undefined,
          }),
        });
      else if (editor && !editor.readOnly)
        await rpc.agentSkills.update({ skillId: editor.id, content });
      else return;
      setEditor(null);
      await refreshSaved();
    });
  }
  const readOnly = editor !== null && editor !== "new" && editor.readOnly;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !saving.current) onClose();
      }}
    >
      <DialogContent className="max-w-2xl" showCloseButton={!busy}>
        <DialogHeader>
          <DialogTitle>
            {editor
              ? editor === "new"
                ? t`New skill or workflow`
                : editor.name
              : t`Workspace library`}
          </DialogTitle>
        </DialogHeader>
        {error ? (
          <div className="space-y-2">
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
            <Button variant="ghost" disabled={busy} onClick={() => void run(refresh)}>
              <Trans>Reload library</Trans>
            </Button>
          </div>
        ) : null}
        {editor ? (
          <form
            className="space-y-6"
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            {editor === "new" ? (
              <>
                <label htmlFor={`${fieldId}-name`} className="block space-y-2">
                  <span>
                    <Trans>Name</Trans>
                  </span>
                  <Input
                    autoFocus
                    id={`${fieldId}-name`}
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    required
                    maxLength={80}
                    disabled={busy}
                  />
                </label>
                <label htmlFor={`${fieldId}-description`} className="block space-y-2">
                  <span>
                    <Trans>When to use it</Trans>
                  </span>
                  <Input
                    id={`${fieldId}-description`}
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                    required
                    maxLength={2000}
                    disabled={busy}
                  />
                </label>
              </>
            ) : null}
            <label htmlFor={`${fieldId}-content`} className="block space-y-2">
              <span>{editor === "new" ? t`Steps and instructions` : t`SKILL.md`}</span>
              <Textarea
                className="min-h-64 font-mono text-sm"
                id={`${fieldId}-content`}
                value={content}
                onChange={(event) => setContent(event.target.value)}
                readOnly={readOnly}
                disabled={busy}
                maxLength={100000}
              />
            </label>
            <div className="flex gap-3 justify-end">
              <Button type="button" variant="ghost" disabled={busy} onClick={() => setEditor(null)}>
                <Trans>Back</Trans>
              </Button>
              {!readOnly ? (
                <Button type="submit" disabled={busy}>
                  {busy ? t`Saving…` : t`Save`}
                </Button>
              ) : (
                <Button
                  type="button"
                  disabled={busy}
                  onClick={(event) => {
                    // This action replaces itself with Submit during the same click.
                    event.preventDefault();
                    setName(`${editor.name.slice(0, 65)} copy`);
                    setDescription(editor.description);
                    const parsed = parseSkillMd(content);
                    const [, pluginId, ...path] = editor.id.split(":");
                    setCopyOrigin(
                      editor.source === "plugin"
                        ? { "cadre-plugin-id": pluginId, "cadre-plugin-entry": path.join(":") }
                        : null,
                    );
                    setContent("error" in parsed ? content : parsed.body);
                    setEditor("new");
                  }}
                >
                  <Trans>Make a copy</Trans>
                </Button>
              )}
            </div>
          </form>
        ) : pendingPlugin ? (
          <div className="space-y-6">
            <label htmlFor={`${fieldId}-plugin`} className="block space-y-2">
              <span>
                <Trans>Plugin name</Trans>
              </span>
              <Input
                autoFocus
                id={`${fieldId}-plugin`}
                value={pendingPlugin.name}
                maxLength={120}
                disabled={busy}
                onChange={(event) =>
                  setPendingPlugin({ ...pendingPlugin, name: event.target.value })
                }
              />
            </label>
            <p className="text-sm text-muted-foreground">
              <Trans>
                {pendingPlugin.files.length} files will be saved in this workspace. Hooks and
                servers are not activated by importing.
              </Trans>
            </p>
            <div className="max-h-48 overflow-auto text-sm">
              {pendingPlugin.files
                .filter((file) => file.path.endsWith("SKILL.md"))
                .map((file) => (
                  <p className="py-1 break-all" key={file.path}>
                    {file.path}
                  </p>
                ))}
            </div>
            <div className="flex gap-3 justify-end">
              <Button variant="ghost" disabled={busy} onClick={() => setPendingPlugin(null)}>
                <Trans>Back</Trans>
              </Button>
              <Button
                disabled={busy || !pendingPlugin.name.trim()}
                onClick={() =>
                  void run(async () => {
                    await rpc.capabilities.install({
                      kind: "plugin",
                      name: pendingPlugin.name.trim(),
                      source: "workspace-upload",
                      config: validatePluginBundle(pendingPlugin),
                    });
                    setPendingPlugin(null);
                    await refreshSaved();
                  })
                }
              >
                {busy ? t`Importing…` : t`Import plugin`}
              </Button>
            </div>
          </div>
        ) : confirmDelete ? (
          <div className="space-y-6">
            <p>
              <Trans>Remove {confirmDelete.name} from this workspace?</Trans>
            </p>
            <div className="flex justify-end gap-3">
              <Button variant="ghost" disabled={busy} onClick={() => setConfirmDelete(null)}>
                <Trans>Cancel</Trans>
              </Button>
              <Button
                variant="destructive"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    if ("kind" in confirmDelete)
                      await rpc.capabilities.remove({ id: confirmDelete.id });
                    else await rpc.agentSkills.remove({ skillId: confirmDelete.id });
                    setConfirmDelete(null);
                    await refreshSaved();
                  })
                }
              >
                <Trans>Remove</Trans>
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-8">
            <div className="flex flex-wrap gap-3">
              <Button disabled={busy} onClick={create}>
                <Trans>New skill or workflow</Trans>
              </Button>
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => skillUpload.current?.click()}
              >
                <Trans>Import SKILL.md</Trans>
              </Button>
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => setChoosingPlugin(!choosingPlugin)}
              >
                <Trans>Import plugin</Trans>
              </Button>
            </div>
            {choosingPlugin ? (
              <div className="flex flex-wrap gap-3">
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() => pluginUpload.current?.click()}
                >
                  <Trans>Choose folder</Trans>
                </Button>
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() => bundleUpload.current?.click()}
                >
                  <Trans>Choose bundle file</Trans>
                </Button>
              </div>
            ) : null}
            <input
              ref={bundleUpload}
              type="file"
              accept=".json,application/json"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (!file) return;
                void run(async () => {
                  if (file.size > 40000000) throw new Error(t`Plugin bundle is too large`);
                  const raw = JSON.parse(await file.text());
                  const bundle = validatePluginBundle(raw);
                  setPendingPlugin({
                    name:
                      typeof raw.name === "string"
                        ? raw.name.slice(0, 120)
                        : file.name.replace(/\.json$/i, ""),
                    files: bundle.files,
                  });
                  setChoosingPlugin(false);
                });
              }}
            />
            <input
              ref={skillUpload}
              type="file"
              accept=".md,text/markdown"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (!file) return;
                void run(async () => {
                  if (file.size > 100000) throw new Error(t`Skill files must be 100 KB or less`);
                  await rpc.agentSkills.create({ content: await file.text() });
                  await refreshSaved();
                });
              }}
            />
            <input
              ref={pluginUpload}
              type="file"
              multiple
              {...{ webkitdirectory: "" }}
              hidden
              onChange={(event) => {
                const files = Array.from(event.target.files ?? []);
                event.target.value = "";
                if (!files.length) return;
                void run(async () => {
                  if (
                    files.length > 5000 ||
                    files.reduce((size, file) => size + file.size, 0) > 20000000
                  )
                    throw new Error(
                      t`Choose a plugin folder with at most 5000 text files and 20 MB`,
                    );
                  const root = files[0]?.webkitRelativePath.split("/")[0] ?? "Plugin";
                  const bundle = validatePluginBundle({
                    files: await Promise.all(
                      files.map(async (file) => ({
                        path: file.webkitRelativePath.split("/").slice(1).join("/") || file.name,
                        content: await file.text(),
                      })),
                    ),
                  });
                  setPendingPlugin({ name: root, files: bundle.files });
                  setChoosingPlugin(false);
                });
              }}
            />
            {loading ? (
              <p role="status">
                <Trans>Loading library…</Trans>
              </p>
            ) : (
              <>
                {plugins.length ? (
                  <section className="space-y-3">
                    <h2 className="font-medium">
                      <Trans>Plugins</Trans>
                    </h2>
                    {plugins.map((plugin) => (
                      <div key={plugin.id} className="flex items-center justify-between gap-4 py-2">
                        <span className="min-w-0 flex-1 break-words">{plugin.name}</span>
                        <Button
                          variant="ghost"
                          disabled={busy}
                          aria-label={t`Export ${plugin.name}`}
                          onClick={() =>
                            void run(async () => {
                              const bundle = validatePluginBundle(plugin.config);
                              const url = URL.createObjectURL(
                                new Blob(
                                  [JSON.stringify({ name: plugin.name, ...bundle }, null, 2)],
                                  { type: "application/json" },
                                ),
                              );
                              const link = document.createElement("a");
                              link.href = url;
                              link.download = `${plugin.name.replace(/[^a-zA-Z0-9_-]/g, "-")}.json`;
                              link.click();
                              window.setTimeout(() => URL.revokeObjectURL(url), 1000);
                            })
                          }
                        >
                          <Trans>Export</Trans>
                        </Button>
                        <Button
                          variant="ghost"
                          disabled={busy}
                          onClick={() => setConfirmDelete(plugin)}
                          aria-label={t`Remove ${plugin.name}`}
                        >
                          <Trans>Remove</Trans>
                        </Button>
                      </div>
                    ))}
                  </section>
                ) : null}
                <section className="space-y-3">
                  <h2 className="font-medium">
                    <Trans>Skills and workflows</Trans>
                  </h2>
                  {skills.filter((skill) => skill.source !== "builtin").length ? (
                    skills
                      .filter((skill) => skill.source !== "builtin")
                      .map((skill) => (
                        <div className="flex items-center gap-3" key={skill.id}>
                          <Button
                            variant="ghost"
                            className="h-auto min-h-11 flex-1 justify-start text-left whitespace-normal py-3"
                            disabled={busy}
                            onClick={() => void open(skill)}
                          >
                            <span className="min-w-0">
                              <span className="block break-words">{skill.name}</span>
                              <span className="block text-sm font-normal text-muted-foreground">
                                {skill.description}
                              </span>
                            </span>
                          </Button>
                          {!skill.readOnly ? (
                            <Button
                              variant="ghost"
                              disabled={busy}
                              aria-label={t`Remove ${skill.name}`}
                              onClick={() => setConfirmDelete(skill)}
                            >
                              <Trans>Remove</Trans>
                            </Button>
                          ) : null}
                        </div>
                      ))
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      <Trans>
                        Save instructions here, or ask an agent to create a reusable skill or
                        workflow.
                      </Trans>
                    </p>
                  )}
                </section>
              </>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
