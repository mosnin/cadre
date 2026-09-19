import type { ActionApprovalRule, ActionAutoReviewSettings } from "@cadre/contracts";
import { Button, Label, Switch } from "@cadre/ui-web";
import { t } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useId, useState } from "react";
import { rpc } from "../lib/rpc";

function describeRule(rule: ActionApprovalRule): string {
  if (rule.effect === "require_approval") {
    if (rule.matchKind === "category") {
      if (rule.matchValue === "email") return t`Ask before email actions`;
      if (rule.matchValue === "purchase") return t`Ask before purchase actions`;
      return t`Ask before ${rule.matchValue} actions`;
    }
    if (rule.matchKind === "connector") return t`Ask before ${rule.matchValue} connector`;
    return t`Ask before ${rule.matchValue}`;
  }
  if (rule.matchKind === "category") {
    if (rule.matchValue === "email") return t`Allow email actions without asking`;
    if (rule.matchValue === "purchase") return t`Allow purchase actions without asking`;
    return t`Allow ${rule.matchValue} actions without asking`;
  }
  if (rule.matchKind === "connector") return t`Allow ${rule.matchValue} connector without asking`;
  return t`Allow ${rule.matchValue} without asking`;
}

/** The auto-review switch on its own, for the Bot settings section. */
export function AutoReviewSwitch() {
  const { t } = useLingui();
  const autoReviewId = useId();
  const [autoReview, setAutoReview] = useState<ActionAutoReviewSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    rpc.autoReview
      .get()
      .then((next) => {
        if (alive) setAutoReview(next);
      })
      .catch((err) => {
        if (alive) setError(err instanceof Error ? err.message : t`Could not load Auto Review`);
      });
    return () => {
      alive = false;
    };
  }, []);

  async function toggle(enabled: boolean) {
    if (saving || !autoReview) return;
    setSaving(true);
    setError(null);
    try {
      setAutoReview(await rpc.autoReview.set({ enabled }));
    } catch (err) {
      setError(err instanceof Error ? err.message : t`Could not save Auto Review`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex items-start gap-3">
      <Switch
        id={autoReviewId}
        data-testid="auto-review-toggle"
        className="mt-0.5"
        checked={autoReview?.enabled ?? false}
        disabled={saving || !autoReview}
        onCheckedChange={(checked) => void toggle(checked)}
      />
      <div>
        <Label htmlFor={autoReviewId} className="text-[14px] font-normal text-foreground/75">
          <Trans>Flag unexpected actions</Trans>
        </Label>
        {autoReview?.enabled && !autoReview.checkerAvailable ? (
          <p className="mt-1 text-[13px] text-muted-foreground">
            <Trans>Add a model in Settings to use this.</Trans>
          </p>
        ) : null}
        {error ? <p className="mt-1 text-[13px] text-destructive">{error}</p> : null}
      </div>
    </div>
  );
}

export function ApprovalRulesSettings() {
  const { t } = useLingui();
  const [rules, setRules] = useState<ActionApprovalRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingPreset, setSavingPreset] = useState<"email" | "purchase" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      setRules(await rpc.approvalRules.list());
    } catch (err) {
      setError(err instanceof Error ? err.message : t`Could not load approval rules`);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function setPreset(matchValue: "email" | "purchase") {
    if (loading || savingPreset) return;
    if (
      rules.some(
        (rule) =>
          rule.effect === "require_approval" &&
          rule.matchKind === "category" &&
          rule.matchValue === matchValue,
      )
    ) {
      return;
    }
    setSavingPreset(matchValue);
    setError(null);
    try {
      const saved = await rpc.approvalRules.set({
        effect: "require_approval",
        matchKind: "category",
        matchValue,
      });
      setRules((current) => [...current, saved]);
    } catch (err) {
      setError(err instanceof Error ? err.message : t`Could not save rule`);
    } finally {
      setSavingPreset(null);
    }
  }

  async function removeRule(id: string) {
    setError(null);
    try {
      await rpc.approvalRules.remove({ id });
      setRules((current) => current.filter((rule) => rule.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : t`Could not remove rule`);
    }
  }

  return (
    <div data-testid="action-confirmation-settings" className="pt-5">
      <h3 className="text-[15px] font-medium text-foreground">
        <Trans>Action confirmations</Trans>
      </h3>
      <p className="mt-2 text-[13.5px] leading-[1.5] text-muted-foreground">
        <Trans>
          Bots act without asking by default. Add an exception only when you want to review a type
          of action first.
        </Trans>
      </p>
      <div className="mt-4 flex flex-col items-start gap-2">
        <Button
          variant="outline"
          disabled={loading || savingPreset !== null}
          onClick={() => void setPreset("email")}
        >
          <Trans>Ask before sending external email</Trans>
        </Button>
        <Button
          variant="outline"
          disabled={loading || savingPreset !== null}
          onClick={() => void setPreset("purchase")}
        >
          <Trans>Ask before purchases</Trans>
        </Button>
      </div>
      {error ? <p className="mt-3 text-[13px] text-destructive">{error}</p> : null}
      {loading ? (
        <p className="mt-4 text-[13px] text-muted-foreground">
          <Trans>Loading rules…</Trans>
        </p>
      ) : rules.length === 0 ? (
        <p className="mt-4 text-[13px] text-muted-foreground">
          <Trans>No exceptions. Actions run automatically.</Trans>
        </p>
      ) : (
        <ul className="mt-4 space-y-2">
          {rules.map((rule) => (
            <li
              key={rule.id}
              className="flex items-center justify-between gap-3 rounded-lg border border-border px-3.5 py-2"
            >
              <span className="text-[13.5px] text-foreground/75">{describeRule(rule)}</span>
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground"
                onClick={() => void removeRule(rule.id)}
              >
                <Trans>Remove</Trans>
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
