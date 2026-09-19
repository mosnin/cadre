import type { Me } from "@cadre/contracts";
import {
  OPENAI_COMPATIBLE_PROVIDER_ID,
  openAiCompatibleConnectReady,
  openAiCompatibleProbeSuccessMessage,
} from "@cadre/contracts";
import { modelCatalogEntryMatchesQuery } from "@cadre/core";
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Input,
  NativeSelect,
  NativeSelectOption,
} from "@cadre/ui-web";
import { Disclosure } from "@cadre/ui-web/components/ui/disclosure";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxInput,
  ComboboxItem,
  ComboboxLabel,
  ComboboxList,
  ComboboxTrigger,
} from "@cadre/ui-web/directory/combobox";
import { Plural, Trans, useLingui } from "@lingui/react/macro";
import { X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { ChatGptDeviceCodeHelp } from "../components/chatgpt-device-code-help";
import { localizedProviderHint } from "../lib/localized-provider-hint";
import type { ModelCatalogEntry, ModelCredential } from "../lib/model-auth";
import { rpc } from "../lib/rpc";
import { useModelOAuthSignIn } from "../lib/use-model-oauth-signin";

export function ModelSettingsOverlay({ onClose }: { onClose: () => void }) {
  const { t } = useLingui();
  const [catalog, setCatalog] = useState<ModelCatalogEntry[]>([]);
  const [credentials, setCredentials] = useState<ModelCredential[]>([]);
  const [me, setMe] = useState<Me | null>(null);
  const [provider, setProvider] = useState("");
  const [providerQuery, setProviderQuery] = useState("");
  const [modelId, setModelId] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [probeModels, setProbeModels] = useState<string[]>([]);
  const [probedBaseUrl, setProbedBaseUrl] = useState<string | null>(null);
  const [probing, setProbing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<"connect" | "default" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const detailScrollRef = useRef<HTMLDivElement>(null);
  const refreshRevisionRef = useRef(0);
  const selectionRevisionRef = useRef(0);
  const probeRequestIdRef = useRef(0);
  const selectedLabelRef = useRef<string | undefined>(undefined);

  const {
    oauth,
    pasteCode,
    setPasteCode,
    oauthPending,
    cancelOAuthAttempt,
    startSubscriptionSignIn,
    submitOAuthCode,
  } = useModelOAuthSignIn({
    onClearError: () => setError(null),
    onError: setError,
    onFinished: async (controller) => {
      await refresh();
      if (controller.signal.aborted) return;
      setNotice(t`Connected and using ${selectedLabelRef.current ?? "this model"}.`);
    },
  });

  async function refresh() {
    const refreshRevision = ++refreshRevisionRef.current;
    const selectionRevision = selectionRevisionRef.current;
    const [nextCatalog, nextCredentials, nextMe] = await Promise.all([
      rpc.models.list(),
      rpc.models.credentials(),
      rpc.me(),
    ]);
    if (refreshRevision !== refreshRevisionRef.current) return;
    const nextProvider =
      provider && nextCatalog.some((entry) => entry.provider === provider)
        ? provider
        : (nextMe.defaultProvider ?? nextCatalog[0]?.provider ?? "");
    const nextCredential = nextCredentials.find((entry) => entry.provider === nextProvider);
    const nextModel =
      nextProvider === OPENAI_COMPATIBLE_PROVIDER_ID
        ? (nextCredential?.modelId ??
          (nextMe.defaultProvider === OPENAI_COMPATIBLE_PROVIDER_ID ? nextMe.defaultModel : "") ??
          "")
        : (nextCatalog.find((entry) => entry.provider === nextProvider && entry.id === modelId)
            ?.id ??
          nextCatalog.find(
            (entry) => entry.provider === nextProvider && entry.id === nextMe.defaultModel,
          )?.id ??
          nextCatalog.find((entry) => entry.provider === nextProvider)?.id ??
          "");
    setCatalog(nextCatalog);
    setCredentials(nextCredentials);
    setMe(nextMe);
    if (selectionRevision === selectionRevisionRef.current) {
      resetOpenAiCompatibleProbe();
      setProvider(nextProvider);
      setModelId(nextModel);
      if (nextProvider === OPENAI_COMPATIBLE_PROVIDER_ID) {
        setBaseUrl(nextCredential?.baseUrl ?? "");
      }
    }
  }

  useEffect(() => {
    void refresh()
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : t`Could not load model settings`),
      )
      .finally(() => setLoading(false));
    return () => {
      refreshRevisionRef.current += 1;
      probeRequestIdRef.current += 1;
    };
  }, []);

  const groups = useMemo(() => {
    const grouped = new Map<string, ModelCatalogEntry[]>();
    for (const entry of catalog) {
      const entries = grouped.get(entry.provider) ?? [];
      entries.push(entry);
      grouped.set(entry.provider, entries);
    }
    return [...grouped].map(([id, entries]) => ({
      id,
      name: entries[0]?.providerName ?? id,
      entries,
    }));
  }, [catalog]);
  const filteredGroups = useMemo(() => {
    const query = providerQuery.trim().toLowerCase();
    if (!query) return groups;
    return groups.filter((group) =>
      group.entries.some((entry) => modelCatalogEntryMatchesQuery(entry, query)),
    );
  }, [groups, providerQuery]);
  const modelsForProvider = catalog.filter((entry) => entry.provider === provider);
  const selected = modelsForProvider.find((entry) => entry.id === modelId) ?? modelsForProvider[0];
  selectedLabelRef.current = selected?.label;
  const isOpenAiCompatible = provider === OPENAI_COMPATIBLE_PROVIDER_ID;
  const credential = credentials.find((entry) => entry.provider === provider);
  const currentEntry = catalog.find(
    (entry) => entry.provider === me?.defaultProvider && entry.id === me?.defaultModel,
  );
  const isActive =
    me?.defaultProvider === selected?.provider &&
    me?.defaultModel === (isOpenAiCompatible ? modelId.trim() : selected?.id);
  const acceptsKey = selected?.auth !== "oauth";
  const subscriptionSignIn = selected?.signIn !== undefined;
  const busy = pending !== null || oauthPending;
  const effectiveBaseUrl = baseUrl.trim();
  const openAiCompatibleReady = openAiCompatibleConnectReady({
    baseUrl: effectiveBaseUrl,
    modelId,
    probedBaseUrl,
    storedBaseUrl: credential?.baseUrl,
  });

  function resetOpenAiCompatibleProbe() {
    probeRequestIdRef.current += 1;
    setProbeModels([]);
    setProbedBaseUrl(null);
    setProbing(false);
  }

  function updateBaseUrl(nextBaseUrl: string) {
    setBaseUrl(nextBaseUrl);
    resetOpenAiCompatibleProbe();
    setError(null);
    setNotice(null);
  }

  function updateApiKey(nextApiKey: string) {
    setApiKey(nextApiKey);
    resetOpenAiCompatibleProbe();
  }

  function chooseProvider(nextProvider: string) {
    cancelOAuthAttempt();
    selectionRevisionRef.current += 1;
    setProvider(nextProvider);
    setModelId(
      nextProvider === OPENAI_COMPATIBLE_PROVIDER_ID
        ? (credentials.find((entry) => entry.provider === nextProvider)?.modelId ?? "")
        : (catalog.find((entry) => entry.provider === nextProvider)?.id ?? ""),
    );
    setBaseUrl(
      nextProvider === OPENAI_COMPATIBLE_PROVIDER_ID
        ? (credentials.find((entry) => entry.provider === nextProvider)?.baseUrl ?? "")
        : "",
    );
    detailScrollRef.current?.scrollTo({ top: 0 });
    setApiKey("");
    resetOpenAiCompatibleProbe();
    setError(null);
    setNotice(null);
  }

  async function probeServerModels() {
    const trimmedBaseUrl = effectiveBaseUrl;
    if (!trimmedBaseUrl) return;
    resetOpenAiCompatibleProbe();
    const requestId = probeRequestIdRef.current;
    setProbing(true);
    setError(null);
    setNotice(null);
    try {
      const result = await rpc.models.probeOpenAiCompatible({
        baseUrl: trimmedBaseUrl,
        apiKey: apiKey.trim() || undefined,
      });
      if (requestId !== probeRequestIdRef.current) return;
      setProbeModels(result.models);
      setProbedBaseUrl(trimmedBaseUrl);
      setModelId((current) => current.trim() || result.models[0] || "");
      setNotice(openAiCompatibleProbeSuccessMessage(result.models.length));
    } catch (err) {
      if (requestId !== probeRequestIdRef.current) return;
      setError(err instanceof Error ? err.message : t`Could not reach this model server`);
    } finally {
      if (requestId === probeRequestIdRef.current) setProbing(false);
    }
  }

  async function setModelDefault() {
    if (!selected || !credential) return;
    const activeModelId = isOpenAiCompatible ? modelId.trim() : selected.id;
    if (isOpenAiCompatible && !activeModelId) return;
    setError(null);
    setNotice(null);
    setPending("default");
    try {
      await rpc.models.setDefault({ provider: selected.provider, modelId: activeModelId });
      await refresh();
      setNotice(isOpenAiCompatible ? t`Model updated.` : t`Now using ${selected.label}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : t`Could not change the default model`);
    } finally {
      setPending(null);
    }
  }

  async function connectKey() {
    if (!selected) return;
    if (isOpenAiCompatible) {
      if (!effectiveBaseUrl || !modelId.trim()) return;
    } else if (!apiKey.trim()) {
      return;
    }
    setError(null);
    setNotice(null);
    setPending("connect");
    try {
      await rpc.models.connect(
        isOpenAiCompatible
          ? {
              provider: selected.provider,
              baseUrl: effectiveBaseUrl,
              modelId: modelId.trim(),
              apiKey: apiKey.trim() || undefined,
              label: selected.providerName ?? selected.provider,
            }
          : {
              provider: selected.provider,
              apiKey: apiKey.trim(),
              modelId: selected.id,
              label: selected.providerName ?? selected.provider,
            },
      );
      setApiKey("");
      await refresh();
      detailScrollRef.current?.scrollTo({ top: 0 });
      setNotice(isOpenAiCompatible ? t`Saved.` : t`Connected and using ${selected.label}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : t`Could not connect this provider`);
    } finally {
      setPending(null);
    }
  }

  function handleClose() {
    cancelOAuthAttempt(false);
    onClose();
  }

  function beginSelectedSubscriptionSignIn() {
    if (!selected) return;
    setNotice(null);
    void startSubscriptionSignIn({
      provider: selected.provider,
      modelId: selected.id,
      label: selected.providerName ?? selected.provider,
    });
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) handleClose();
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="flex h-[760px] max-h-[calc(100%-2rem)] w-[1080px] max-w-[calc(100%-2rem)] flex-col gap-0 overflow-hidden rounded-2xl bg-card p-0 sm:max-w-[1080px]"
      >
        <DialogHeader className="flex-row items-start justify-between px-6 pt-6 sm:px-8 sm:pt-7">
          <div>
            <DialogTitle className="text-2xl text-foreground">
              <Trans>Models</Trans>
            </DialogTitle>
            <DialogDescription className="mt-1 text-[13.5px] text-muted-foreground/70">
              {loading ? (
                <Trans>Loading model catalog…</Trans>
              ) : (
                <Trans>Choose a model for your agents.</Trans>
              )}
            </DialogDescription>
          </div>
          <DialogClose
            render={<Button variant="ghost" size="icon-sm" aria-label={t`Close model settings`} />}
          >
            <X />
          </DialogClose>
        </DialogHeader>

        <div className="mx-6 mt-5 rounded-xl border border-border px-4 py-3 sm:mx-8">
          <div className="text-[12.5px] uppercase tracking-[0.08em] text-muted-foreground/80">
            <Trans>Active model</Trans>
          </div>
          <div className="mt-1 text-[16px] text-foreground">
            {currentEntry?.label ?? me?.defaultModel ?? t`Deployment default`}
          </div>
          <div className="mt-1 text-[13px] text-muted-foreground">
            {currentEntry?.providerName ?? me?.defaultProvider ?? (
              <Trans>Configured by deployment</Trans>
            )}
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-hidden px-6 py-6 sm:px-8 md:flex-row">
          <div className="flex min-h-0 shrink-0 flex-col md:w-[310px]">
            <div className="mb-3 text-[13.5px] text-muted-foreground">
              <Trans>Providers</Trans>
            </div>
            <label className="sr-only" htmlFor="model-provider-search">
              <Trans>Search providers</Trans>
            </label>
            <Input
              id="model-provider-search"
              value={providerQuery}
              onChange={(event) => setProviderQuery(event.target.value)}
              placeholder={t`Search providers`}
              className="h-10 rounded-xl px-3.5"
            />
            <div className="rk-scroll mt-3 max-h-[240px] overflow-y-auto rounded-xl border border-border md:min-h-0 md:max-h-none md:flex-1">
              {filteredGroups.length ? (
                filteredGroups.map((group) => {
                  const connected = credentials.some((entry) => entry.provider === group.id);
                  return (
                    <button
                      key={group.id}
                      type="button"
                      onClick={() => chooseProvider(group.id)}
                      className={`flex w-full items-center gap-3 border-b border-border px-3.5 py-3 text-start last:border-0 ${
                        group.id === provider ? "bg-muted" : "hover:bg-accent"
                      }`}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[15px] text-foreground">
                          {group.name}
                        </span>
                        <span className="mt-0.5 block text-[12px] text-muted-foreground/80">
                          <Plural value={group.entries.length} one="# model" other="# models" />
                          {" · "}
                          {localizedProviderHint(group.entries[0]!)}
                        </span>
                      </span>
                      {connected ? (
                        <span className="text-[12px] text-success">
                          <Trans>Connected</Trans>
                        </span>
                      ) : null}
                    </button>
                  );
                })
              ) : (
                <p className="px-3.5 py-4 text-[13px] text-muted-foreground">
                  <Trans>No providers found.</Trans>
                </p>
              )}
            </div>
          </div>

          <div ref={detailScrollRef} className="rk-scroll min-h-0 min-w-0 flex-1 overflow-y-auto">
            {error ? <p className="mb-4 text-sm text-destructive">{error}</p> : null}
            {notice ? <p className="mb-4 text-sm text-success">{notice}</p> : null}
            {selected ? (
              <>
                <div className="block text-[13.5px] text-muted-foreground">
                  {isOpenAiCompatible ? (
                    <>
                      <label className="block" htmlFor="model-base-url">
                        <Trans>Server URL</Trans>
                        <Input
                          id="model-base-url"
                          value={baseUrl}
                          onChange={(event) => updateBaseUrl(event.target.value)}
                          aria-label={t`OpenAI-compatible server URL`}
                          placeholder="http://127.0.0.1:8000/v1"
                          autoComplete="off"
                          className="mt-2 h-10 text-foreground"
                        />
                      </label>
                      <Disclosure
                        className="mt-2 text-[13px] leading-[1.5] text-muted-foreground"
                        summary={<Trans>Setup help</Trans>}
                      >
                        <p className="mt-1">
                          {t`Paste the OpenAI-compatible address from your server. The /v1 path is added if needed.`}
                        </p>
                      </Disclosure>
                      <div className="mt-3 flex items-center gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={busy || probing || !effectiveBaseUrl}
                          onClick={() => void probeServerModels()}
                        >
                          {probing ? <Trans>Finding…</Trans> : <Trans>Find models</Trans>}
                        </Button>
                      </div>
                      <div className="mt-4 block">
                        <span>
                          <Trans>Model</Trans>
                        </span>
                        {probeModels.length && probeModels.includes(modelId) ? (
                          <NativeSelect
                            className="mt-2 w-full text-foreground"
                            value={modelId}
                            onChange={(event) => {
                              cancelOAuthAttempt();
                              selectionRevisionRef.current += 1;
                              setModelId(event.target.value);
                              setError(null);
                              setNotice(null);
                            }}
                            aria-label={t`Models from server`}
                          >
                            {probeModels.map((id) => (
                              <NativeSelectOption key={id} value={id}>
                                {id}
                              </NativeSelectOption>
                            ))}
                            <NativeSelectOption value="">
                              <Trans>Other model…</Trans>
                            </NativeSelectOption>
                          </NativeSelect>
                        ) : (
                          <Input
                            value={modelId}
                            onChange={(event) => {
                              cancelOAuthAttempt();
                              selectionRevisionRef.current += 1;
                              setModelId(event.target.value);
                              setError(null);
                              setNotice(null);
                            }}
                            aria-label={t`Model id`}
                            placeholder="exact-model-id"
                            className="mt-2 h-10 text-foreground"
                          />
                        )}
                        {probeModels.length && !probeModels.includes(modelId) ? (
                          <Button
                            type="button"
                            variant="link"
                            className="mt-2 h-auto px-0 text-[13px] text-muted-foreground underline"
                            onClick={() => setModelId(probeModels[0] ?? "")}
                          >
                            <Trans>Use a found model</Trans>
                          </Button>
                        ) : null}
                      </div>
                    </>
                  ) : (
                    <>
                      <span>
                        <Trans>Model</Trans>
                      </span>
                      <ModelPicker
                        options={modelsForProvider}
                        value={selected.id}
                        onChange={(nextModelId) => {
                          cancelOAuthAttempt();
                          selectionRevisionRef.current += 1;
                          setModelId(nextModelId);
                          setError(null);
                          setNotice(null);
                        }}
                      />
                    </>
                  )}
                </div>
                {!isOpenAiCompatible && selected.billing ? (
                  <p className="mt-2 text-[13px] leading-[1.5] text-muted-foreground">
                    {selected.billing}
                  </p>
                ) : null}

                {!isOpenAiCompatible ? (
                  <div className="mt-5 rounded-xl border border-border px-4 py-3">
                    <div className="text-[12.5px] uppercase tracking-[0.08em] text-muted-foreground/80">
                      <Trans>Personal credential</Trans>
                    </div>
                    <div className="mt-1 text-[15px] text-foreground">
                      {credential ? (
                        <Trans>Connected · {credential.label}</Trans>
                      ) : (
                        <Trans>Not connected</Trans>
                      )}
                    </div>
                    <div className="mt-1 text-[13px] text-muted-foreground">
                      {credential ? (
                        <Trans>
                          Your key or subscription token is stored securely and is never shown here.
                        </Trans>
                      ) : (
                        <Trans>Connect this provider to use it as your personal model.</Trans>
                      )}
                    </div>
                  </div>
                ) : null}

                {subscriptionSignIn ? (
                  <div className="mt-5">
                    <ChatGptDeviceCodeHelp provider={selected.provider} />
                    {oauth ? (
                      <div className="rounded-xl border border-border px-4 py-3">
                        {oauth.mode === "auth-url" ? (
                          <>
                            <p className="text-sm leading-[1.5] text-muted-foreground">
                              <Trans>
                                Finish signing in at{" "}
                                <a
                                  href={oauth.verificationUri}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-foreground underline"
                                >
                                  {new URL(oauth.verificationUri).hostname}
                                </a>
                                . The final page may not load; paste its URL or code here.
                              </Trans>
                            </p>
                            <div className="mt-3 flex items-center gap-2">
                              <Input
                                value={pasteCode}
                                onChange={(e) => setPasteCode(e.target.value)}
                                aria-label={t`Authorization code or callback URL`}
                                autoComplete="off"
                                spellCheck={false}
                                placeholder="http://localhost:53692/callback?code=…"
                                className="text-foreground md:text-[13px]"
                              />
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                disabled={!pasteCode.trim()}
                                onClick={() => void submitOAuthCode()}
                              >
                                <Trans>Submit</Trans>
                              </Button>
                            </div>
                            <p className="mt-2 text-sm text-muted-foreground">
                              <Trans>Waiting for sign-in…</Trans>
                            </p>
                          </>
                        ) : (
                          <>
                            <p className="text-sm leading-[1.5] text-muted-foreground">
                              <Trans>
                                Enter this code at{" "}
                                <a
                                  href={oauth.verificationUri}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-foreground underline"
                                >
                                  {oauth.verificationUri.replace(/^https:\/\//, "")}
                                </a>
                              </Trans>
                            </p>
                            <p className="mt-2 font-mono text-[22px] tracking-[0.2em] text-foreground">
                              {oauth.userCode}
                            </p>
                            <p className="mt-2 text-sm text-muted-foreground">
                              <Trans>Waiting for sign-in…</Trans>
                            </p>
                          </>
                        )}
                      </div>
                    ) : (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={busy}
                        onClick={() => beginSelectedSubscriptionSignIn()}
                      >
                        {oauthPending ? (
                          <Trans>Starting…</Trans>
                        ) : (
                          (selected.oauthLabel ?? t`Sign in`)
                        )}
                      </Button>
                    )}
                  </div>
                ) : null}

                {acceptsKey ? (
                  <div className="mt-5">
                    {isOpenAiCompatible ? (
                      <Disclosure
                        className="text-[13.5px] text-muted-foreground"
                        summary={<Trans>API key</Trans>}
                      >
                        <Input
                          aria-label={t`API key`}
                          value={apiKey}
                          onChange={(event) => updateApiKey(event.target.value)}
                          placeholder={t`Optional`}
                          type="password"
                          autoComplete="new-password"
                          className="mt-2 h-10 text-foreground"
                        />
                      </Disclosure>
                    ) : (
                      <label
                        className="block text-[13.5px] text-muted-foreground"
                        htmlFor="model-api-key"
                      >
                        {credential ? (
                          <Trans>Replace API key</Trans>
                        ) : subscriptionSignIn ? (
                          <Trans>Or connect an API key</Trans>
                        ) : (
                          <Trans>API key</Trans>
                        )}
                        <Input
                          id="model-api-key"
                          value={apiKey}
                          onChange={(event) => updateApiKey(event.target.value)}
                          placeholder="sk-…"
                          type="password"
                          autoComplete="new-password"
                          className="mt-2 h-10 text-foreground"
                        />
                      </label>
                    )}
                    <Button
                      type="button"
                      variant="secondary"
                      className="mt-3 rounded-full"
                      size="sm"
                      disabled={
                        busy ||
                        (isOpenAiCompatible ? !openAiCompatibleReady : apiKey.trim().length < 8)
                      }
                      onClick={() => void connectKey()}
                    >
                      {pending === "connect" ? (
                        <Trans>Saving…</Trans>
                      ) : isOpenAiCompatible ? (
                        <Trans>Save</Trans>
                      ) : credential ? (
                        <Trans>Replace API key</Trans>
                      ) : (
                        <Trans>Connect API key</Trans>
                      )}
                    </Button>
                  </div>
                ) : null}

                {selected.auth === "oauth" && !subscriptionSignIn ? (
                  <p className="mt-5 text-sm leading-[1.5] text-muted-foreground">
                    <Trans>
                      This subscription sign-in is not available yet. Use a deployment credential or
                      choose another provider.
                    </Trans>
                  </p>
                ) : null}

                {credential && !isActive ? (
                  <div className="mt-6">
                    <Button
                      type="button"
                      variant="secondary"
                      className="rounded-full"
                      size="sm"
                      disabled={busy || (isOpenAiCompatible && !modelId.trim())}
                      onClick={() => void setModelDefault()}
                    >
                      {pending === "default" ? (
                        <Trans>Switching…</Trans>
                      ) : (
                        <Trans>Use this model</Trans>
                      )}
                    </Button>
                  </div>
                ) : null}
              </>
            ) : loading ? (
              <p className="text-muted-foreground">
                <Trans>Loading model catalog…</Trans>
              </p>
            ) : (
              <p className="text-muted-foreground">
                <Trans>No model catalog is available.</Trans>
              </p>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ModelPicker({
  options,
  value,
  onChange,
}: {
  options: ModelCatalogEntry[];
  value: string;
  onChange: (value: string) => void;
}) {
  const { t } = useLingui();
  const groups = new Map<string, ModelCatalogEntry[]>();
  for (const option of options) {
    const name = option.providerName ?? option.provider;
    groups.set(name, [...(groups.get(name) ?? []), option]);
  }
  return (
    <Combobox
      value={value}
      onValueChange={onChange}
      className="mt-2"
      filter={(id, query, keywords) =>
        [id, ...keywords].join(" ").toLowerCase().includes(query.trim().toLowerCase())
      }
    >
      <ComboboxTrigger>
        <ComboboxInput aria-label={t`Model`} placeholder={t`Search models`} />
      </ComboboxTrigger>
      <ComboboxContent>
        <ComboboxList ariaLabel={t`Model options`}>
          {[...groups].map(([name, entries]) => (
            <ComboboxGroup key={name}>
              <ComboboxLabel className="normal-case tracking-normal text-xs">{name}</ComboboxLabel>
              {entries.map((option) => (
                <ComboboxItem
                  key={`${option.provider}:${option.id}`}
                  value={option.id}
                  textValue={option.label}
                  keywords={[option.label, option.providerName ?? option.provider]}
                  className="min-h-11"
                >
                  <span className="flex-1">{option.label}</span>
                  {option.billing.toLowerCase().includes("free") ? (
                    <span className="text-xs text-muted-foreground">{t`Free`}</span>
                  ) : null}
                </ComboboxItem>
              ))}
            </ComboboxGroup>
          ))}
          <ComboboxEmpty>{t`No models found`}</ComboboxEmpty>
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}
