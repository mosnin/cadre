import { Trans, useLingui } from "@lingui/react/macro";
import type { AvatarStyle } from "@rakazo/contracts";
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
  Toggle,
} from "@rakazo/ui-web";
import { Disclosure } from "@rakazo/ui-web/components/ui/disclosure";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@rakazo/ui-web/directory/select";
import { XIcon } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ApprovalRulesSettings } from "../components/ApprovalRulesSettings";
import { SuccessStatus } from "../components/ai/primitives";
import {
  ComputersUnavailableHint,
  computersAreUnavailable,
} from "../components/ComputersUnavailableHint";
import { SiteLoginsSettings } from "../components/SiteLoginsSettings";
import { SoftwareUpdateSection } from "../components/SoftwareUpdateSection";
import { authClient } from "../lib/auth";
import { useAuthCapabilities } from "../lib/auth-capabilities";
import { getActiveUiLocale, setUiLocale } from "../lib/i18n";
import { rpc } from "../lib/rpc";
import {
  type AppearancePreference,
  getUiAppearancePreference,
  setUiAppearance,
} from "../lib/ui-appearance";
import { UI_LOCALE_LABELS, UI_LOCALES, type UiLocale } from "../lib/ui-locale";
import { CompanyConnectionDialog, CompanyWorkspaceSettings } from "./CompanyWorkspaces";

export function AccountSettingsOverlay({
  email,
  name,
  usage,
  focusUsage,
  avatarStyle,
  onAvatarStyleChange,
  isDeploymentOwner = false,
  sandboxProvider,
  messagingEnabled = false,
  onOpenMessaging,
  onClose,
}: {
  email?: string | null;
  name: string;
  usage?: { runs: number; inputTokens: number; outputTokens: number } | null;
  focusUsage?: boolean;
  avatarStyle: AvatarStyle;
  onAvatarStyleChange: (style: AvatarStyle) => Promise<void>;
  isDeploymentOwner?: boolean;
  sandboxProvider?: string | null;
  messagingEnabled?: boolean;
  onOpenMessaging?: () => void;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const [canAdmin, setCanAdmin] = useState(false);
  const [companySpaceId, setCompanySpaceId] = useState<string | null>(null);
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
  const [locale, setLocale] = useState<UiLocale>(() => getActiveUiLocale());
  const localeRequestRef = useRef(0);
  const [appearance, setAppearance] = useState<AppearancePreference>(() =>
    getUiAppearancePreference(),
  );
  const [avatarPending, setAvatarPending] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);

  function chooseLocale(next: UiLocale) {
    if (next === locale) return;
    const requestId = ++localeRequestRef.current;
    setLocale(next);
    void setUiLocale(next).then((activated) => {
      if (requestId !== localeRequestRef.current) return;
      setLocale(activated);
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

  if (companySpaceId !== null)
    return (
      <CompanyConnectionDialog
        initialSpaceId={companySpaceId}
        onClose={() => setCompanySpaceId(null)}
      />
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
        className="rk-scroll block max-h-[calc(100%-2rem)] w-[640px] overflow-y-auto overscroll-contain rounded-2xl p-6 sm:max-h-[calc(100%-5rem)] sm:max-w-[calc(100%-5rem)] sm:p-8"
      >
        <div className="flex items-start justify-between gap-6">
          <DialogTitle className="text-2xl font-medium text-foreground">
            <Trans>Settings</Trans>
          </DialogTitle>
          <DialogClose
            aria-label={t`Close user settings`}
            render={<Button variant="ghost" size="icon-sm" />}
          >
            <XIcon />
          </DialogClose>
        </div>

        <section className="mt-8">
          <h3 className="text-[15px] font-medium text-foreground">
            <Trans>Account</Trans>
          </h3>
          <p className="mt-3 text-[14px] text-foreground/75">{name}</p>
          {email ? <p className="mt-1 text-[13px] text-muted-foreground/70">{email}</p> : null}
        </section>

        <CompanyWorkspaceSettings onConnect={setCompanySpaceId} />
        <ChangePasswordSection />
        <SiteLoginsSettings />

        {messagingEnabled && onOpenMessaging ? (
          <section className="mt-8">
            <h3 className="text-[15px] font-medium text-foreground">
              <Trans>Messaging</Trans>
            </h3>
            <p className="mt-3 text-[13px] text-muted-foreground/70">
              <Trans>Chat apps, group channels, and agent connections.</Trans>
            </p>
            <Button variant="secondary" className="mt-3 rounded-full" onClick={onOpenMessaging}>
              <Trans>Manage messaging settings</Trans>
            </Button>
          </section>
        ) : null}

        <section className="mt-8">
          <h3 className="text-[15px] font-medium text-foreground">
            <Trans>Appearance</Trans>
          </h3>
          <AppearancePicker
            value={appearance}
            onChange={(next) => {
              setAppearance(next);
              setUiAppearance(next);
            }}
          />
        </section>

        <section className="mt-8">
          <h3 className="text-[15px] font-medium text-foreground">
            <Trans>Language</Trans>
          </h3>
          <UiLocalePicker value={locale} onChange={chooseLocale} />
        </section>

        <section className="mt-8">
          <h3 className="text-[15px] font-medium text-foreground">
            <Trans>Avatars</Trans>
          </h3>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {(["robot", "organic", "orb"] as const).map((style) => (
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
                  {style === "robot" ? (
                    <Trans>Robot</Trans>
                  ) : style === "organic" ? (
                    <Trans>Organic</Trans>
                  ) : (
                    <Trans>Orb</Trans>
                  )}
                </span>
              </Toggle>
            ))}
          </div>
          {avatarError ? (
            <p role="alert" className="mt-3 text-[12.5px] text-destructive">
              {avatarError}
            </p>
          ) : null}
        </section>

        <div
          ref={usageRef}
          tabIndex={-1}
          data-testid="usage-settings"
          className="mt-8 outline-none"
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
          <p className={`text-[12.5px] text-muted-foreground/80 ${usage ? "mt-2" : "mt-3"}`}>
            <Trans>Model spend uses your provider keys.</Trans>
          </p>
        </div>

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
          <div data-testid="computers-setup-settings" className="mt-8">
            <h3 className="text-[15px] font-medium text-foreground">
              <Trans>Computers</Trans>
            </h3>
            <ComputersUnavailableHint className="mt-3 text-[13px] leading-relaxed text-muted-foreground" />
          </div>
        ) : null}

        <Disclosure
          data-testid="advanced-settings"
          className="group mt-5 rounded-xl border border-border"
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
      </DialogContent>
    </Dialog>
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
    <section className="mt-8">
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
      className="mt-2"
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
