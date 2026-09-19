import {
  OPENAI_COMPATIBLE_PROVIDER_ID,
  openAiCompatibleConnectReady,
  openAiCompatibleProbeSuccessMessage,
} from "@cadre/contracts";
import {
  featuredModelProviders,
  modelCatalogEntryMatchesQuery,
  selectedProviderOutsideSearchResults,
} from "@cadre/core";
import { Button, Input, NativeSelect, NativeSelectOption, Textarea } from "@cadre/ui-web";
import { Disclosure } from "@cadre/ui-web/components/ui/disclosure";
import { Trans, useLingui } from "@lingui/react/macro";
import { Check } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChatGptDeviceCodeHelp } from "../components/chatgpt-device-code-help";
import { authClient } from "../lib/auth";
import { useAuthCapabilities } from "../lib/auth-capabilities";
import { localizedProviderHint } from "../lib/localized-provider-hint";
import type { ModelCatalogEntry } from "../lib/model-auth";
import { rpc, selectSpace } from "../lib/rpc";
import { useModelOAuthSignIn } from "../lib/use-model-oauth-signin";
import { readSetupDraft, saveSetupDraft, setupDraftKey } from "../lib/workspace-setup-draft";
import { companyWorkspaceRequest } from "./CompanyWorkspaces";

export function OnboardingPage() {
  const { t } = useLingui();
  const navigate = useNavigate();
  const capabilities = useAuthCapabilities();
  const userId = authClient.useSession().data?.user.id;
  const draftKey = useRef<string | null>(null);
  const createdWorkspaceId = useRef<string | undefined>(undefined);
  const fieldId = useId();
  const [step, setStep] = useState<"loading" | "workspace" | "company" | "model" | "bot">(
    "loading",
  );
  const newWorkspace = new URLSearchParams(window.location.search).has("new");
  const [workspaceName, setWorkspaceName] = useState("");
  const [workspaceId, setWorkspaceId] = useState("");
  const [company, setCompany] = useState<{ companyName: string; connected: boolean } | null>(null);
  const [companyAvailable, setCompanyAvailable] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  useEffect(() => {
    const restored = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      savingRef.current = false;
      setSaving(false);
    };
    window.addEventListener("pageshow", restored);
    return () => window.removeEventListener("pageshow", restored);
  }, []);

  const nextAfterCompany = useRef<"model" | "bot">("bot");
  const [catalog, setCatalog] = useState<ModelCatalogEntry[]>([]);
  const [query, setQuery] = useState("");
  const [showAllProviders, setShowAllProviders] = useState(false);
  const [provider, setProvider] = useState("openrouter");
  const [modelId, setModelId] = useState("qwen/qwen3-235b-a22b");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [probeModels, setProbeModels] = useState<string[]>([]);
  const [probedBaseUrl, setProbedBaseUrl] = useState<string | null>(null);
  const [probing, setProbing] = useState(false);
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [needsModel, setNeedsModel] = useState(false);
  const probeRequestIdRef = useRef(0);

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
    onFinished: () => {
      setStep("bot");
    },
  });

  useEffect(() => {
    if (!capabilities || !userId) return;
    let alive = true;
    void Promise.all([
      rpc.me(),
      rpc.models.list().catch(() => []),
      rpc.spaces.list(),
      companyWorkspaceRequest().catch(() => null),
    ])
      .then(([me, models, workspaceList, companyStatus]) => {
        if (!alive) return;
        const key = setupDraftKey(userId, newWorkspace ? "new" : me.spaceId);
        const draft = readSetupDraft(key);
        draftKey.current = key;
        if (draft) {
          setName(draft.name);
          setTitle(draft.title);
          setDescription(draft.description);
          if (newWorkspace) setWorkspaceName(draft.workspaceName);
          createdWorkspaceId.current = draft.createdWorkspaceId;
        }
        setWorkspaceId(me.spaceId);
        if (!newWorkspace)
          setWorkspaceName(
            workspaceList.spaces.find((space) => space.id === me.spaceId)?.name ?? "",
          );
        const linked = companyStatus?.connections.find(
          (row: { spaceId: string }) => row.spaceId === me.spaceId,
        );
        setCompany(linked ?? null);
        setCompanyAvailable(companyStatus?.available ?? null);
        setCatalog(models);
        setNeedsModel(me.needsModel);
        const preferred =
          models.find(
            (entry) => entry.provider === me.defaultProvider && entry.id === me.defaultModel,
          ) ??
          models.find((entry) => entry.provider === me.defaultProvider) ??
          models[0];
        if (preferred) {
          setProvider(preferred.provider);
          setModelId(preferred.provider === OPENAI_COMPATIBLE_PROVIDER_ID ? "" : preferred.id);
        }
        nextAfterCompany.current = capabilities.hosted && !me.needsModel ? "bot" : "model";
        setStep(
          newWorkspace
            ? "workspace"
            : linked?.connected
              ? nextAfterCompany.current
              : draft?.step === "bot" && !me.needsModel
                ? "bot"
                : draft?.step === "model"
                  ? nextAfterCompany.current
                  : "company",
        );
      })
      .catch(() => {
        if (!alive) return;
        setError(t`Could not load setup. Reload to try again.`);
      });
    return () => {
      alive = false;
      probeRequestIdRef.current += 1;
    };
  }, [capabilities, userId, newWorkspace]);

  useEffect(() => {
    if (!draftKey.current || step === "loading") return;
    saveSetupDraft(draftKey.current, {
      step,
      workspaceName,
      name,
      title,
      description,
      createdWorkspaceId: createdWorkspaceId.current,
      savedAt: Date.now(),
    });
  }, [step, workspaceName, name, title, description]);

  const providers = useMemo(() => {
    const seen = new Map<string, ModelCatalogEntry>();
    for (const entry of catalog) {
      if (!seen.has(entry.provider)) seen.set(entry.provider, entry);
    }
    return [...seen.values()];
  }, [catalog]);

  const filteredProviders = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return providers;
    const matching = new Set(
      catalog
        .filter((entry) => modelCatalogEntryMatchesQuery(entry, q))
        .map((entry) => entry.provider),
    );
    return providers.filter((entry) => matching.has(entry.provider));
  }, [catalog, providers, query]);

  const displayedProviders = useMemo(
    () => (showAllProviders ? filteredProviders : featuredModelProviders(providers, provider)),
    [filteredProviders, provider, providers, showAllProviders],
  );

  const selectedProviderOutsideResults = useMemo(
    () =>
      showAllProviders
        ? selectedProviderOutsideSearchResults(filteredProviders, providers, provider)
        : undefined,
    [filteredProviders, provider, providers, showAllProviders],
  );

  const providerRows = selectedProviderOutsideResults
    ? [selectedProviderOutsideResults, ...displayedProviders]
    : displayedProviders;

  const modelsForProvider = useMemo(
    () => catalog.filter((entry) => entry.provider === provider),
    [catalog, provider],
  );

  const selected = modelsForProvider.find((entry) => entry.id === modelId) ?? modelsForProvider[0];
  const isOpenAiCompatible = provider === OPENAI_COMPATIBLE_PROVIDER_ID;
  const subscriptionSignIn = selected?.signIn !== undefined;
  const acceptsKey = selected?.auth !== "oauth";
  const signInLabel = selected?.oauthLabel ?? t`Sign in`;
  const openAiCompatibleReady = openAiCompatibleConnectReady({
    baseUrl,
    modelId,
    probedBaseUrl,
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

  async function probeServerModels() {
    const trimmedBaseUrl = baseUrl.trim();
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

  async function saveModel() {
    setError(null);
    try {
      if (isOpenAiCompatible) {
        await rpc.models.connect({
          provider,
          baseUrl: baseUrl.trim(),
          modelId: modelId.trim(),
          apiKey: apiKey.trim() || undefined,
          label: selected?.providerName ?? provider,
        });
      } else if (apiKey) {
        await rpc.models.connect({
          provider,
          apiKey,
          modelId,
          label: selected?.providerName ?? provider,
        });
      }
      setStep("bot");
    } catch (err) {
      setError(err instanceof Error ? err.message : t`Could not save model`);
    }
  }

  function beginSelectedSubscriptionSignIn() {
    void startSubscriptionSignIn({
      provider,
      modelId,
      label: selected?.providerName ?? provider,
    });
  }

  async function createBot() {
    if (savingRef.current || !name.trim()) return;
    savingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      const bot = await rpc.bots.create({
        name: name.trim(),
        title,
        description,
        instructions: description,
        notifyOnFinish: true,
      });
      // Onboarding continues conversationally in the thread: greeting first,
      // then the focus choice (immediate for the first bot).
      const started = await rpc.onboarding
        .start({ botId: bot.id })
        .then(() => true)
        .catch(() => false);
      if (started) {
        await rpc.onboarding.promptFocus({ botId: bot.id }).catch(() => undefined);
      }
      if (draftKey.current) saveSetupDraft(draftKey.current, null);
      navigate(`/app/${bot.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : t`Could not create your bot`);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  async function createWorkspace(event: React.FormEvent) {
    event.preventDefault();
    if (savingRef.current || !workspaceName.trim()) return;
    savingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      const spaceId =
        createdWorkspaceId.current ?? (await rpc.spaces.create({ name: workspaceName.trim() })).id;
      createdWorkspaceId.current = spaceId;
      if (draftKey.current)
        saveSetupDraft(draftKey.current, {
          step: "workspace",
          workspaceName,
          name,
          title,
          description,
          createdWorkspaceId: spaceId,
          savedAt: Date.now(),
        });
      if (!selectSpace(spaceId))
        throw new Error(
          t`Your browser could not select this workspace. Enable site storage and reopen it from Workspaces.`,
        );
      if (draftKey.current) saveSetupDraft(draftKey.current, null);
      window.location.assign("/onboarding?setup=company");
    } catch (err) {
      setError(err instanceof Error ? err.message : t`Could not create workspace`);
      savingRef.current = false;
      setSaving(false);
    }
  }

  async function connectCompany(create: boolean) {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      const result = await companyWorkspaceRequest(
        create ? "/connect?create=1" : "/connect",
        "POST",
        workspaceId,
      );
      window.location.assign(result.url);
    } catch {
      setError(t`Could not connect Company OS. Try again or continue without a company.`);
      savingRef.current = false;
      setSaving(false);
    }
  }

  return (
    <div className="min-h-full bg-background px-6 py-6 sm:py-10" data-testid="workspace-setup">
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4">
        <a href="/app" className="flex min-h-11 items-center gap-3 font-medium">
          <img src="/brand/cadre-icon.svg" alt="" className="cadre-mark size-7" />
          Cadre
        </a>
        <Button variant="ghost" onClick={() => navigate("/app?setup-paused=1")} disabled={saving}>
          <Trans>Close setup</Trans>
        </Button>
      </header>
      <div className="mx-auto w-full max-w-[560px] py-10 sm:py-16">
        {step !== "loading" ? (
          <nav
            aria-label={t`Setup progress`}
            className="mb-10 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-muted-foreground"
          >
            <span
              aria-current={step === "workspace" ? "step" : undefined}
              className={step === "workspace" ? "text-foreground" : ""}
            >
              <Trans>Workspace</Trans>
            </span>
            <span
              aria-current={step === "company" ? "step" : undefined}
              className={step === "company" ? "text-foreground" : ""}
            >
              <Trans>Company</Trans>
            </span>
            <span
              aria-current={step === "model" || step === "bot" ? "step" : undefined}
              className={step === "model" || step === "bot" ? "text-foreground" : ""}
            >
              <Trans>Agent</Trans>
            </span>
            <span>
              <Trans>First task</Trans>
            </span>
          </nav>
        ) : null}
        {step !== "workspace" && step !== "loading" ? (
          <p className="mb-3 truncate text-sm text-muted-foreground">
            {workspaceName}
            {company?.connected ? ` · ${company.companyName}` : ""}
          </p>
        ) : null}
        {step === "workspace" ? (
          <form onSubmit={createWorkspace}>
            <h1 className="text-[32px] font-medium tracking-tight">
              <Trans>Create a workspace</Trans>
            </h1>
            <p className="mt-3 text-muted-foreground">
              <Trans>Keep a business’s agents, conversations and context together.</Trans>
            </p>
            <label className="mt-8 block text-sm" htmlFor={`${fieldId}-workspace`}>
              <Trans>Workspace name</Trans>
            </label>
            <Input
              id={`${fieldId}-workspace`}
              className="mt-2"
              value={workspaceName}
              onChange={(event) => setWorkspaceName(event.target.value)}
              maxLength={60}
              required
              disabled={saving}
              autoComplete="off"
            />
            {error ? (
              <p role="alert" className="mt-3 text-sm text-destructive">
                {error}
              </p>
            ) : null}
            <Button className="mt-8" type="submit" disabled={saving || !workspaceName.trim()}>
              {saving ? t`Creating…` : t`Continue`}
            </Button>
          </form>
        ) : null}
        {step === "company" ? (
          <div>
            <h1 className="text-[32px] font-medium tracking-tight">
              <Trans>Connect your company</Trans>
            </h1>
            <p className="mt-3 text-muted-foreground">
              <Trans>Give agents access to the business context you authorize in Company OS.</Trans>
            </p>
            <div className="mt-8 flex flex-col items-start gap-3">
              <Button
                disabled={!companyAvailable || saving}
                onClick={() => void connectCompany(false)}
              >
                {saving ? t`Connecting…` : t`Connect Company OS`}
              </Button>
              <Button
                variant="ghost"
                disabled={!companyAvailable || saving}
                onClick={() => void connectCompany(true)}
              >
                <Trans>Create a company in Company OS</Trans>
              </Button>
            </div>
            {companyAvailable === false ? (
              <p className="mt-4 text-sm text-muted-foreground">
                <Trans>
                  Company OS is not configured on this deployment. You can connect it later in
                  Settings.
                </Trans>
              </p>
            ) : null}
            {companyAvailable === null ? (
              <p role="alert" className="mt-4 text-sm text-destructive">
                <Trans>Could not load Company OS. Reload to try again, or connect later.</Trans>
              </p>
            ) : null}
            {error ? (
              <p role="alert" className="mt-3 text-sm text-destructive">
                {error}
              </p>
            ) : null}
            <Button
              className="mt-8"
              variant="ghost"
              disabled={saving}
              onClick={() => {
                setError(null);
                setStep(nextAfterCompany.current);
              }}
            >
              <Trans>Continue without a company</Trans>
            </Button>
          </div>
        ) : null}
        {step === "loading" ? (
          error ? (
            <div role="alert">
              <p className="text-destructive">{error}</p>
              <Button className="mt-4" onClick={() => window.location.reload()}>
                <Trans>Reload</Trans>
              </Button>
            </div>
          ) : (
            <p className="text-muted-foreground">
              <Trans>Loading…</Trans>
            </p>
          )
        ) : null}
        {step === "model" ? (
          <div>
            <h1 className="text-[32px] font-medium text-foreground">
              <Trans>Connect a model</Trans>
            </h1>
            <div className="mt-8 flex items-center justify-between gap-4">
              <p className="text-sm font-medium text-foreground">
                <Trans>Provider</Trans>
              </p>
              <Button
                variant="link"
                size="xs"
                className="px-0 text-muted-foreground"
                onClick={() => {
                  setShowAllProviders((current) => !current);
                  setQuery("");
                }}
              >
                {showAllProviders ? (
                  <Trans>Show popular providers</Trans>
                ) : (
                  <Trans>Show all providers</Trans>
                )}
              </Button>
            </div>
            {showAllProviders ? (
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label={t`Search providers and models`}
                placeholder={t`Search providers and models`}
                className="mt-3"
              />
            ) : null}
            <fieldset
              aria-label={t`Model providers`}
              className={`mt-3 overflow-y-auto rounded-xl border border-border ${
                showAllProviders ? "max-h-64" : ""
              }`}
            >
              {providerRows.map((entry) => {
                const isSelected = entry.provider === provider;
                const isOutsideSearchResults =
                  entry.provider === selectedProviderOutsideResults?.provider;
                return (
                  <button
                    key={entry.provider}
                    type="button"
                    aria-pressed={isSelected}
                    onClick={() => {
                      if (isSelected) return;
                      cancelOAuthAttempt();
                      setProvider(entry.provider);
                      setModelId(
                        entry.provider === OPENAI_COMPATIBLE_PROVIDER_ID
                          ? ""
                          : (catalog.find((item) => item.provider === entry.provider)?.id ?? ""),
                      );
                      setBaseUrl("");
                      resetOpenAiCompatibleProbe();
                      setError(null);
                      setNotice(null);
                    }}
                    className={`flex min-h-11 w-full items-center gap-3 border-b border-border px-3.5 py-2.5 text-left last:border-0 ${
                      isSelected ? "bg-muted" : "hover:bg-accent"
                    }`}
                  >
                    <span className="flex min-w-0 flex-1 items-center gap-2">
                      <span
                        className={`truncate text-[15px] text-foreground ${isSelected ? "font-medium" : ""}`}
                      >
                        {entry.provider === "openai-codex"
                          ? "ChatGPT"
                          : (entry.providerName ?? entry.provider)}
                      </span>
                      {isOutsideSearchResults ? (
                        <span className="shrink-0 text-[11px] text-muted-foreground">
                          <Trans>Selected</Trans>
                        </span>
                      ) : null}
                    </span>
                    <span className="text-[12px] text-muted-foreground">
                      {localizedProviderHint(entry)}
                    </span>
                    <span className="flex size-5 shrink-0 items-center justify-center" aria-hidden>
                      {isSelected ? (
                        <span className="flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
                          <Check className="size-3" strokeWidth={2.5} />
                        </span>
                      ) : null}
                    </span>
                  </button>
                );
              })}
              {displayedProviders.length === 0 ? (
                <p className="px-3.5 py-6 text-center text-sm text-muted-foreground">
                  <Trans>No providers found</Trans>
                </p>
              ) : null}
            </fieldset>
            <div className="mt-6 block text-sm text-foreground">
              {isOpenAiCompatible ? (
                <>
                  <label htmlFor={`${fieldId}-base-url`} className="block font-medium">
                    <Trans>Server URL</Trans>
                    <Input
                      id={`${fieldId}-base-url`}
                      value={baseUrl}
                      onChange={(e) => updateBaseUrl(e.target.value)}
                      aria-label={t`OpenAI-compatible server URL`}
                      placeholder="http://127.0.0.1:8000/v1"
                      autoComplete="off"
                      className="mt-2"
                    />
                  </label>
                  <Disclosure
                    className="mt-2 text-[13px] leading-[1.5] text-muted-foreground"
                    summary={<Trans>Setup help</Trans>}
                  >
                    <p className="mt-1">
                      {t`Paste the OpenAI-compatible address from your server. Cadre adds /v1 if needed.`}
                    </p>
                  </Disclosure>
                  <div className="mt-3">
                    <Button
                      variant="outline"
                      disabled={probing || !baseUrl.trim()}
                      onClick={() => void probeServerModels()}
                    >
                      {probing ? <Trans>Finding…</Trans> : <Trans>Find models</Trans>}
                    </Button>
                  </div>
                  <div className="mt-4 block">
                    <span className="font-medium">
                      <Trans>Model</Trans>
                    </span>
                    {probeModels.length && probeModels.includes(modelId) ? (
                      <NativeSelect
                        value={modelId}
                        onChange={(e) => setModelId(e.target.value)}
                        aria-label={t`Models from server`}
                        className="mt-2 w-full"
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
                        onChange={(e) => setModelId(e.target.value)}
                        aria-label={t`Model id`}
                        placeholder="exact-model-id"
                        className="mt-2"
                      />
                    )}
                    {probeModels.length && !probeModels.includes(modelId) ? (
                      <Button
                        variant="link"
                        size="xs"
                        className="mt-2 px-0 text-muted-foreground"
                        onClick={() => setModelId(probeModels[0] ?? "")}
                      >
                        <Trans>Use a found model</Trans>
                      </Button>
                    ) : null}
                  </div>
                </>
              ) : (
                <>
                  <span className="font-medium">
                    <Trans>Model</Trans>
                  </span>
                  <NativeSelect
                    value={selected?.id ?? modelId}
                    onChange={(e) => {
                      cancelOAuthAttempt();
                      setModelId(e.target.value);
                    }}
                    aria-label={t`Model`}
                    className="mt-2 w-full"
                  >
                    {modelsForProvider.map((entry) => (
                      <NativeSelectOption key={`${entry.provider}:${entry.id}`} value={entry.id}>
                        {entry.label}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </>
              )}
            </div>
            {subscriptionSignIn ? (
              <div className="mt-4">
                <ChatGptDeviceCodeHelp provider={selected.provider} />
                {oauth ? (
                  <div className="rounded-lg border border-border px-3.5 py-3">
                    {oauth.mode === "auth-url" ? (
                      <>
                        <p className="text-sm text-muted-foreground">
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
                          />
                          <Button
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
                        <p className="text-sm text-muted-foreground">
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
                  <Button disabled={oauthPending} onClick={() => beginSelectedSubscriptionSignIn()}>
                    {oauthPending ? <Trans>Starting…</Trans> : signInLabel}
                  </Button>
                )}
              </div>
            ) : null}
            {acceptsKey ? (
              isOpenAiCompatible ? (
                <Disclosure
                  className="mt-4 text-sm text-muted-foreground"
                  summary={<Trans>API key</Trans>}
                >
                  <Input
                    aria-label={t`API key`}
                    value={apiKey}
                    onChange={(e) => updateApiKey(e.target.value)}
                    placeholder={t`Optional`}
                    type="password"
                    autoComplete="new-password"
                    className="mt-2"
                  />
                </Disclosure>
              ) : (
                <label
                  htmlFor={`${fieldId}-api-key`}
                  className="mt-4 block text-sm font-medium text-foreground"
                >
                  {subscriptionSignIn ? <Trans>Or paste an API key</Trans> : <Trans>API key</Trans>}
                  <Input
                    id={`${fieldId}-api-key`}
                    value={apiKey}
                    onChange={(e) => updateApiKey(e.target.value)}
                    placeholder="sk-…"
                    type="password"
                    autoComplete="new-password"
                    className="mt-2"
                  />
                </label>
              )
            ) : subscriptionSignIn ? null : (
              <p className="mt-4 text-sm text-muted-foreground">
                <Trans>
                  This provider cannot paste a key here. Skip if this deployment already has
                  credentials.
                </Trans>
              </p>
            )}
            {notice ? <p className="mt-3 text-sm text-success">{notice}</p> : null}
            {error ? <p className="mt-3 text-sm text-destructive">{error}</p> : null}
            <div className="mt-6 flex gap-3">
              <Button
                disabled={oauthPending || (isOpenAiCompatible && !openAiCompatibleReady)}
                onClick={() => void saveModel()}
              >
                <Trans>Continue</Trans>
              </Button>
              {needsModel ? null : (
                <Button
                  variant="ghost"
                  className="text-muted-foreground"
                  onClick={() => {
                    cancelOAuthAttempt();
                    setStep("bot");
                  }}
                >
                  <Trans>Skip for now</Trans>
                </Button>
              )}
            </div>
          </div>
        ) : null}
        {step === "bot" ? (
          <div>
            <h1 className="text-[32px] font-medium text-foreground">
              <Trans>Create your first agent</Trans>
            </h1>
            <label htmlFor={`${fieldId}-name`} className="mt-8 block text-sm text-muted-foreground">
              <Trans>Name</Trans>
              <Input
                id={`${fieldId}-name`}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t`Name this agent`}
                className="mt-2"
              />
            </label>
            <label
              htmlFor={`${fieldId}-description`}
              className="mt-4 block text-sm text-muted-foreground"
            >
              <Trans>Purpose</Trans>
              <Textarea
                id={`${fieldId}-description`}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={t`What should this agent help with?`}
                rows={4}
                className="mt-2"
              />
            </label>
            <Disclosure className="mt-6 text-sm" summary={t`Advanced settings`}>
              <label
                htmlFor={`${fieldId}-title`}
                className="mt-4 block text-sm text-muted-foreground"
              >
                <Trans>Title</Trans>
                <Input
                  id={`${fieldId}-title`}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={t`Role or specialty`}
                  className="mt-2"
                />
              </label>
            </Disclosure>
            {error ? <p className="mt-3 text-sm text-destructive">{error}</p> : null}
            <div className="mt-8 flex items-center gap-3">
              <Button
                variant="ghost"
                disabled={saving}
                onClick={() => {
                  setError(null);
                  setStep("company");
                }}
              >
                <Trans>Back</Trans>
              </Button>
              <Button disabled={saving || !name.trim()} onClick={() => void createBot()}>
                {saving ? t`Creating…` : t`Create agent`}
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
