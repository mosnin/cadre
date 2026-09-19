import type { AvatarStyle, ComputerStatus, Me } from "@cadre/contracts";
import {
  BotAvatar,
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
  Field,
  FieldLabel,
  Input,
  Label,
  Switch,
  Toggle,
} from "@cadre/ui-web";
import { Disclosure } from "@cadre/ui-web/components/ui/disclosure";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@cadre/ui-web/directory/select";
import { Trans, useLingui } from "@lingui/react/macro";
import { ChevronLeft, ChevronRight, XIcon } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ApprovalRulesSettings, AutoReviewSwitch } from "../components/ApprovalRulesSettings";
import { SuccessStatus } from "../components/ai/primitives";
import { ComputerMaintenanceActions } from "../components/ComputerMaintenanceActions";
import {
  ComputersUnavailableHint,
  computersAreUnavailable,
} from "../components/ComputersUnavailableHint";
import { SiteLoginsSettings } from "../components/SiteLoginsSettings";
import { SoftwareUpdateSection } from "../components/SoftwareUpdateSection";
import { authClient } from "../lib/auth";
import { useAuthCapabilities } from "../lib/auth-capabilities";
import { getActiveUiLocale, setUiLocale } from "../lib/i18n";
import { localTimezone } from "../lib/local-timezone";
import { rpc } from "../lib/rpc";
import {
  type AppearancePreference,
  getUiAppearancePreference,
  setUiAppearance,
} from "../lib/ui-appearance";
import { UI_LOCALE_LABELS, UI_LOCALES, type UiLocale } from "../lib/ui-locale";
import { type CompanyNotice, CompanyWorkspaceSettings } from "./CompanyWorkspaces";
import {
  type WorkspaceIntegrationNotice,
  WorkspaceIntegrationSettings,
} from "./WorkspaceIntegrations";

export type SettingsSectionId =
  | "account"
  | "plugins"
  | "bot"
  | "company"
  | "connections"
  | "appearance"
  | "avatars"
  | "language"
  | "region";

/** Outcome of an OAuth return, shown once in the section it belongs to. */
export type SettingsNotice =
  | { section: "company"; company: CompanyNotice }
  | { section: "connections"; integration: WorkspaceIntegrationNotice };

export type PreferencesPatch = Partial<
  Pick<Me, "locale" | "region" | "timezone" | "timezoneAutomatic">
>;

const DESKTOP_QUERY = "(min-width: 768px)";

function useDesktopLayout() {
  const [desktop, setDesktop] = useState(() => window.matchMedia(DESKTOP_QUERY).matches);
  useEffect(() => {
    const media = window.matchMedia(DESKTOP_QUERY);
    const onChange = () => setDesktop(media.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);
  return desktop;
}

export function AccountSettingsOverlay({
  email,
  name,
  usage,
  focusUsage,
  initialSection,
  notice,
  me,
  onPreferencesChange,
  avatarStyle,
  onAvatarStyleChange,
  isDeploymentOwner = false,
  sandboxProvider,
  messagingEnabled = false,
  onOpenMessaging,
  onOpenPlugins,
  onOpenLibrary,
  onOpenWorkforce,
  activeBot,
  computer,
  onComputerChanged,
  onClose,
}: {
  email?: string | null;
  name: string;
  usage?: { runs: number; inputTokens: number; outputTokens: number } | null;
  focusUsage?: boolean;
  initialSection?: SettingsSectionId;
  notice?: SettingsNotice | null;
  me?: Me | null;
  onPreferencesChange: (patch: PreferencesPatch) => Promise<void>;
  avatarStyle: AvatarStyle;
  onAvatarStyleChange: (style: AvatarStyle) => Promise<void>;
  isDeploymentOwner?: boolean;
  sandboxProvider?: string | null;
  messagingEnabled?: boolean;
  onOpenMessaging?: () => void;
  onOpenPlugins?: () => void;
  onOpenLibrary?: () => void;
  onOpenWorkforce?: () => void;
  activeBot?: { id: string; name: string } | null;
  computer?: ComputerStatus | null;
  onComputerChanged?: () => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const desktop = useDesktopLayout();
  const [canAdmin, setCanAdmin] = useState(false);
  useEffect(() => {
    let alive = true;
    rpc.admin
      .status()
      .then((status) => {
        if (alive) setCanAdmin(status.allowed || status.canClaim);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);
  const panelRef = useRef<HTMLDivElement>(null);
  const usageRef = useRef<HTMLDivElement>(null);
  const [section, setSection] = useState<SettingsSectionId | null>(
    initialSection ?? (focusUsage ? "account" : null),
  );
  const active: SettingsSectionId | null = section ?? (desktop ? "account" : null);
  const [locale, setLocale] = useState<UiLocale>(() => getActiveUiLocale());
  const localeRequestRef = useRef(0);
  const [appearance, setAppearance] = useState<AppearancePreference>(() =>
    getUiAppearancePreference(),
  );
  const [avatarPending, setAvatarPending] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [preferencesError, setPreferencesError] = useState<string | null>(null);

  async function savePreferences(patch: PreferencesPatch) {
    setPreferencesError(null);
    try {
      await onPreferencesChange(patch);
    } catch {
      setPreferencesError(t`Couldn't save`);
    }
  }

  function chooseLocale(next: UiLocale) {
    if (next === locale) return;
    const requestId = ++localeRequestRef.current;
    setLocale(next);
    void setUiLocale(next).then((activated) => {
      if (requestId !== localeRequestRef.current) return;
      setLocale(activated);
      void savePreferences({ locale: activated });
    });
  }

  async function chooseAvatarStyle(next: AvatarStyle) {
    if (avatarPending || next === avatarStyle) return;
    setAvatarPending(true);
    setAvatarError(null);
    try {
      await onAvatarStyleChange(next);
    } catch {
      setAvatarError(t`Couldn't update avatars`);
    } finally {
      setAvatarPending(false);
    }
  }

  const sections: { id: SettingsSectionId; label: string; hidden?: boolean }[] = [
    { id: "account", label: t`Account` },
    { id: "plugins", label: t`Plugins`, hidden: !onOpenPlugins && !onOpenLibrary },
    { id: "bot", label: t`Bot` },
    { id: "company", label: t`Company OS` },
    { id: "connections", label: t`Connections` },
    { id: "appearance", label: t`Appearance` },
    { id: "avatars", label: t`Avatars` },
    { id: "language", label: t`Language` },
    { id: "region", label: t`Region` },
  ];
  const visibleSections = sections.filter((entry) => !entry.hidden);
  const activeLabel = visibleSections.find((entry) => entry.id === active)?.label;

  const list = (
    <nav
      aria-label={t`Settings sections`}
      data-testid="settings-sections"
      className={`rk-scroll shrink-0 overflow-y-auto p-2 md:w-52 md:border-e md:border-border ${
        active && !desktop ? "hidden" : "flex-1 md:flex-none"
      }`}
    >
      {visibleSections.map((entry) => (
        <button
          key={entry.id}
          type="button"
          data-testid={`settings-section-${entry.id}`}
          aria-current={active === entry.id ? "page" : undefined}
          onClick={() => setSection(entry.id)}
          className="flex min-h-11 w-full items-center justify-between gap-3 rounded-xl px-3 text-left text-[14.5px] text-foreground/90 hover:bg-accent aria-[current=page]:bg-accent aria-[current=page]:text-foreground"
        >
          <span className="truncate">{entry.label}</span>
          <ChevronRight size={16} aria-hidden="true" className="text-muted-foreground md:hidden" />
        </button>
      ))}
    </nav>
  );

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        ref={panelRef}
        data-testid="user-settings"
        showCloseButton={false}
        initialFocus={() => (focusUsage ? usageRef.current : panelRef.current)}
        className="flex h-[640px] max-h-[calc(100%-2rem)] w-[880px] max-w-[calc(100%-2rem)] flex-col gap-0 overflow-hidden rounded-2xl p-0 sm:max-h-[calc(100%-5rem)] sm:max-w-[880px]"
      >
        <div className="flex items-center justify-between gap-6 px-5 pt-5 pb-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-1">
            {active && !desktop ? (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t`Back`}
                data-testid="settings-back"
                onClick={() => setSection(null)}
              >
                <ChevronLeft />
              </Button>
            ) : null}
            <DialogTitle className="truncate text-2xl font-medium text-foreground">
              {active && !desktop ? activeLabel : <Trans>Settings</Trans>}
            </DialogTitle>
          </div>
          <DialogClose
            aria-label={t`Close user settings`}
            render={<Button variant="ghost" size="icon-sm" />}
          >
            <XIcon />
          </DialogClose>
        </div>
        <div className="flex min-h-0 flex-1">
          {list}
          {active ? (
            <div
              data-testid={`settings-panel-${active}`}
              className="rk-scroll min-w-0 flex-1 overflow-y-auto overscroll-contain px-5 pt-2 pb-6 sm:px-6"
            >
              {desktop ? (
                <h2 className="text-[15px] font-medium text-foreground">{activeLabel}</h2>
              ) : null}
              {active === "account" ? (
                <div className="space-y-8">
                  <div>
                    <p className="mt-3 text-[14px] text-foreground/75">{name}</p>
                    {email ? (
                      <p className="mt-1 text-[13px] text-muted-foreground/70">{email}</p>
                    ) : null}
                  </div>
                  <div
                    ref={usageRef}
                    tabIndex={-1}
                    data-testid="usage-settings"
                    className="outline-none"
                  >
                    <h3 className="text-[15px] font-medium text-foreground">
                      <Trans>Usage</Trans>
                    </h3>
                    {usage ? (
                      <p className="mt-3 text-[14px] text-foreground/75">
                        <Trans>
                          {usage.runs} runs · {usage.inputTokens + usage.outputTokens} tokens
                        </Trans>
                      </p>
                    ) : null}
                    <p
                      className={`text-[12.5px] text-muted-foreground/80 ${usage ? "mt-2" : "mt-3"}`}
                    >
                      <Trans>Model spend uses your provider keys.</Trans>
                    </p>
                  </div>
                  <ChangePasswordSection />
                  {canAdmin && (
                    <Link
                      to="/app/admin"
                      className="block rounded-lg border px-4 py-3 text-sm font-medium hover:bg-muted"
                    >
                      <Trans>Administration</Trans>
                    </Link>
                  )}
                  <SoftwareUpdateSection isDeploymentOwner={isDeploymentOwner} />
                  {isDeploymentOwner && computersAreUnavailable(sandboxProvider) ? (
                    <div data-testid="computers-setup-settings">
                      <h3 className="text-[15px] font-medium text-foreground">
                        <Trans>Computers</Trans>
                      </h3>
                      <ComputersUnavailableHint className="mt-3 text-[13px] leading-relaxed text-muted-foreground" />
                    </div>
                  ) : null}
                </div>
              ) : null}
              {active === "plugins" ? (
                <div className="mt-3 space-y-2">
                  {onOpenPlugins ? (
                    <SettingsRow
                      label={t`Plugins`}
                      detail={t`Tools and skills`}
                      onClick={onOpenPlugins}
                    />
                  ) : null}
                  {onOpenLibrary ? (
                    <SettingsRow
                      label={t`Workspace library`}
                      detail={t`Skills and workflows`}
                      onClick={onOpenLibrary}
                    />
                  ) : null}
                </div>
              ) : null}
              {active === "bot" ? (
                <div className="mt-4 space-y-8">
                  <AutoReviewSwitch />
                  <TimeZoneSettings
                    automatic={me?.timezoneAutomatic ?? true}
                    timezone={me?.timezone ?? null}
                    onChange={savePreferences}
                  />
                  {activeBot && computer ? (
                    <div data-testid="bot-computer-settings">
                      <h3 className="text-[15px] font-medium text-foreground">
                        <Trans>Computer</Trans>
                      </h3>
                      <div className="mt-3 flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-[14px] text-foreground/75">
                            {activeBot.name}
                          </p>
                          <p className="text-[12.5px] text-muted-foreground/80">{computer.state}</p>
                        </div>
                        <ComputerMaintenanceActions
                          botId={activeBot.id}
                          computer={computer}
                          onChanged={onComputerChanged ?? (async () => undefined)}
                        />
                      </div>
                    </div>
                  ) : null}
                  {preferencesError ? (
                    <p role="alert" className="text-[12.5px] text-destructive">
                      {preferencesError}
                    </p>
                  ) : null}
                  <Disclosure
                    data-testid="advanced-settings"
                    className="group rounded-xl border border-border"
                    summary={
                      <span>
                        <span className="block text-[15px] text-foreground">
                          <Trans>Advanced</Trans>
                        </span>
                        <span className="mt-1 block text-[12.5px] text-muted-foreground/80">
                          <Trans>Optional controls most people never need</Trans>
                        </span>
                      </span>
                    }
                  >
                    <div className="border-t border-border px-4 pb-5">
                      <ApprovalRulesSettings />
                    </div>
                  </Disclosure>
                </div>
              ) : null}
              {active === "company" ? (
                <div className="mt-3">
                  <CompanyWorkspaceSettings
                    notice={notice?.section === "company" ? notice.company : null}
                    onOpenWorkforce={onOpenWorkforce}
                  />
                </div>
              ) : null}
              {active === "connections" ? (
                <div className="mt-4 space-y-8">
                  <WorkspaceIntegrationSettings
                    notice={notice?.section === "connections" ? notice.integration : null}
                  />
                  {messagingEnabled && onOpenMessaging ? (
                    <section>
                      <h3 className="text-[15px] font-medium text-foreground">
                        <Trans>Messaging</Trans>
                      </h3>
                      <p className="mt-3 text-[13px] text-muted-foreground/70">
                        <Trans>Chat apps, group channels, and agent connections.</Trans>
                      </p>
                      <Button
                        variant="secondary"
                        className="mt-3 rounded-full"
                        onClick={onOpenMessaging}
                      >
                        <Trans>Manage messaging settings</Trans>
                      </Button>
                    </section>
                  ) : null}
                </div>
              ) : null}
              {active === "appearance" ? (
                <AppearancePicker
                  value={appearance}
                  onChange={(next) => {
                    setAppearance(next);
                    setUiAppearance(next);
                  }}
                />
              ) : null}
              {active === "avatars" ? (
                <div>
                  <div className="mt-3 grid grid-cols-2 gap-3">
                    {(["robot", "organic"] as const).map((style) => (
                      <Toggle
                        key={style}
                        variant="outline"
                        pressed={style === avatarStyle}
                        disabled={avatarPending}
                        onPressedChange={() => void chooseAvatarStyle(style)}
                        className="h-auto justify-start gap-3 px-3.5 py-3 text-[14px] font-normal"
                      >
                        <BotAvatar
                          color="#D9508A"
                          identity="avatar-style-preview"
                          size={32}
                          variant={style}
                        />
                        <span>
                          {style === "robot" ? <Trans>Robot</Trans> : <Trans>Organic</Trans>}
                        </span>
                      </Toggle>
                    ))}
                  </div>
                  {avatarError ? (
                    <p role="alert" className="mt-3 text-[12.5px] text-destructive">
                      {avatarError}
                    </p>
                  ) : null}
                </div>
              ) : null}
              {active === "language" ? (
                <UiLocalePicker value={locale} onChange={chooseLocale} />
              ) : null}
              {active === "region" ? (
                <div>
                  <RegionPicker
                    value={me?.region ?? null}
                    locale={locale}
                    onChange={(region) => void savePreferences({ region })}
                  />
                  {preferencesError ? (
                    <p role="alert" className="mt-3 text-[12.5px] text-destructive">
                      {preferencesError}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SettingsRow({
  label,
  detail,
  onClick,
}: {
  label: string;
  detail?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-11 w-full items-center justify-between gap-3 rounded-xl border border-border px-4 py-3 text-left hover:bg-muted"
    >
      <span className="min-w-0">
        <span className="block text-[14.5px] text-foreground">{label}</span>
        {detail ? (
          <span className="mt-0.5 block text-[12.5px] text-muted-foreground/80">{detail}</span>
        ) : null}
      </span>
      <ChevronRight size={16} aria-hidden="true" className="shrink-0 text-muted-foreground" />
    </button>
  );
}

const FALLBACK_TIME_ZONES = [
  "UTC",
  "America/Los_Angeles",
  "America/Denver",
  "America/Chicago",
  "America/New_York",
  "America/Sao_Paulo",
  "Europe/London",
  "Europe/Berlin",
  "Europe/Istanbul",
  "Asia/Kolkata",
  "Asia/Shanghai",
  "Asia/Seoul",
  "Asia/Tokyo",
  "Australia/Sydney",
];

function listTimeZones(): string[] {
  try {
    const zones = Intl.supportedValuesOf("timeZone");
    if (zones.length) return zones;
  } catch {
    // Older engines lack supportedValuesOf.
  }
  return FALLBACK_TIME_ZONES;
}

function TimeZoneSettings({
  automatic,
  timezone,
  onChange,
}: {
  automatic: boolean;
  timezone: string | null;
  onChange: (patch: PreferencesPatch) => Promise<void>;
}) {
  const { t } = useLingui();
  const switchId = useId();
  const [pending, setPending] = useState(false);
  const zones = useMemo(() => {
    const list = listTimeZones();
    return timezone && !list.includes(timezone) ? [timezone, ...list] : list;
  }, [timezone]);
  const current = timezone ?? localTimezone();

  async function save(patch: PreferencesPatch) {
    setPending(true);
    try {
      await onChange(patch);
    } finally {
      setPending(false);
    }
  }

  return (
    <div data-testid="timezone-settings" className="space-y-4">
      <div className="flex items-start gap-3">
        <Switch
          id={switchId}
          data-testid="timezone-automatic"
          className="mt-0.5"
          checked={automatic}
          disabled={pending}
          onCheckedChange={(checked) =>
            void save(
              checked
                ? { timezone: localTimezone(), timezoneAutomatic: true }
                : { timezone: current, timezoneAutomatic: false },
            )
          }
        />
        <Label htmlFor={switchId} className="text-[14px] font-normal text-foreground/75">
          <Trans>Set time zone automatically</Trans>
        </Label>
      </div>
      {automatic ? (
        <p className="text-[13px] text-muted-foreground/80">{current}</p>
      ) : (
        <Select
          value={current}
          disabled={pending}
          onValueChange={(next) => {
            if (next !== current) void save({ timezone: next, timezoneAutomatic: false });
          }}
        >
          <SelectTrigger data-testid="timezone-select" role="combobox" ariaLabel={t`Time zone`}>
            {current}
          </SelectTrigger>
          <SelectContent>
            {zones.map((zone) => (
              <SelectItem key={zone} value={zone}>
                {zone}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}

const FALLBACK_REGIONS = [
  "AR",
  "AU",
  "AT",
  "BE",
  "BR",
  "CA",
  "CL",
  "CN",
  "CO",
  "DK",
  "FI",
  "FR",
  "DE",
  "IN",
  "ID",
  "IE",
  "IL",
  "IT",
  "JP",
  "KR",
  "MX",
  "NL",
  "NZ",
  "NO",
  "PL",
  "PT",
  "SG",
  "ZA",
  "ES",
  "SE",
  "CH",
  "TR",
  "AE",
  "GB",
  "US",
];

function listRegions(): string[] {
  try {
    // "region" is not a standard key; engines that support it return ISO 3166 codes.
    const regions = (Intl.supportedValuesOf as (key: string) => string[])("region");
    const codes = regions.filter((code) => /^[A-Z]{2}$/.test(code));
    if (codes.length) return codes;
  } catch {
    // Fall through to the curated list.
  }
  return FALLBACK_REGIONS;
}

function RegionPicker({
  value,
  locale,
  onChange,
}: {
  value: string | null;
  locale: string;
  onChange: (region: string | null) => void;
}) {
  const { t } = useLingui();
  const options = useMemo(() => {
    let names: Intl.DisplayNames | null = null;
    try {
      names = new Intl.DisplayNames([locale], { type: "region" });
    } catch {
      names = null;
    }
    const codes = listRegions();
    if (value && !codes.includes(value)) codes.unshift(value);
    return codes
      .map((code) => ({ code, label: names?.of(code) ?? code }))
      .sort((a, b) => a.label.localeCompare(b.label, locale));
  }, [locale, value]);
  const automatic = t`Automatic`;
  const currentLabel = value ? (options.find((o) => o.code === value)?.label ?? value) : automatic;
  return (
    <Select
      value={value ?? ""}
      onValueChange={(next) => {
        const region = next || null;
        if (region !== value) onChange(region);
      }}
      className="mt-3"
    >
      <SelectTrigger data-testid="region-select" role="combobox" ariaLabel={t`Region`}>
        {currentLabel}
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="">{automatic}</SelectItem>
        {options.map((option) => (
          <SelectItem key={option.code} value={option.code}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function ChangePasswordSection() {
  const capabilities = useAuthCapabilities();
  const { t } = useLingui();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function changePassword() {
    if (pending) return;
    if (newPassword !== confirmation) {
      setError(t`Passwords do not match`);
      return;
    }
    setPending(true);
    setSaved(false);
    setError(null);
    try {
      const result = await authClient.changePassword({
        currentPassword,
        newPassword,
        revokeOtherSessions: true,
      });
      if (result.error) {
        setError(result.error.message ?? t`Could not change password`);
        return;
      }
      setCurrentPassword("");
      setNewPassword("");
      setConfirmation("");
      setSaved(true);
    } catch {
      setError(t`Could not reach the server`);
    } finally {
      setPending(false);
    }
  }

  if (!capabilities || capabilities.provider === "convex-company-os") return null;
  return (
    <section>
      <h3 className="text-[15px] font-medium text-foreground">
        <Trans>Password</Trans>
      </h3>
      <div className="mt-3 grid gap-3">
        <SettingsPasswordInput
          label={t`Current password`}
          autoComplete="current-password"
          value={currentPassword}
          onChange={setCurrentPassword}
        />
        <SettingsPasswordInput
          label={t`New password`}
          autoComplete="new-password"
          value={newPassword}
          onChange={setNewPassword}
        />
        <SettingsPasswordInput
          label={t`Confirm password`}
          autoComplete="new-password"
          value={confirmation}
          onChange={setConfirmation}
        />
      </div>
      {error ? (
        <p role="alert" className="mt-3 text-[12.5px] text-destructive">
          {error}
        </p>
      ) : null}
      <div className="mt-4 flex items-center gap-3">
        <Button
          className="rounded-full"
          disabled={pending || currentPassword.length < 8 || newPassword.length < 8}
          onClick={() => void changePassword()}
        >
          {pending ? <Trans>Changing…</Trans> : <Trans>Change password</Trans>}
        </Button>
        {saved ? <SuccessStatus label={t`Password updated`} /> : null}
      </div>
    </section>
  );
}

function SettingsPasswordInput({
  label,
  autoComplete,
  value,
  onChange,
}: {
  label: string;
  autoComplete: "current-password" | "new-password";
  value: string;
  onChange: (value: string) => void;
}) {
  const id = useId();
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        type="password"
        autoComplete={autoComplete}
        minLength={8}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </Field>
  );
}

function AppearancePicker({
  value,
  onChange,
}: {
  value: AppearancePreference;
  onChange: (next: AppearancePreference) => void;
}) {
  const { t } = useLingui();
  const options: { value: AppearancePreference; label: string }[] = [
    { value: "system", label: t`System` },
    { value: "light", label: t`Light` },
    { value: "dark", label: t`Dark` },
  ];

  return (
    <fieldset
      aria-label={t`Appearance`}
      data-testid="ui-appearance-select"
      className="mt-3 grid min-w-0 grid-cols-3 gap-1 rounded-lg bg-muted p-1"
    >
      {options.map((option) => (
        <Toggle
          key={option.value}
          data-testid={`ui-appearance-${option.value}`}
          pressed={option.value === value}
          onPressedChange={() => onChange(option.value)}
          className="text-[13px] aria-pressed:bg-background aria-pressed:shadow-sm"
        >
          {option.label}
        </Toggle>
      ))}
    </fieldset>
  );
}

function UiLocalePicker({
  value,
  onChange,
}: {
  value: UiLocale;
  onChange: (locale: UiLocale) => void;
}) {
  const { t } = useLingui();
  return (
    <Select
      value={value}
      onValueChange={(next) => {
        if (UI_LOCALES.includes(next as UiLocale)) onChange(next as UiLocale);
      }}
      className="mt-3"
    >
      <SelectTrigger data-testid="ui-locale-select" role="combobox" ariaLabel={t`Language`}>
        {UI_LOCALE_LABELS[value]}
      </SelectTrigger>
      <SelectContent>
        {UI_LOCALES.map((locale) => (
          <SelectItem key={locale} value={locale}>
            {UI_LOCALE_LABELS[locale]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
