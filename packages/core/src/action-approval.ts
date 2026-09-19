import type { ActionApprovalRule as StoredActionApprovalRule } from "@cadre/contracts";

const APPROVAL_EXEMPT_TOOLS = new Set([
  "computer_observe",
  "computer_act",
  "list_files",
  "read_file",
  "write_file",
  "shell",
  "open_path",
  "launch_app",
  "remember",
  "request_takeover",
  "request_secret",
  "run_subagent",
  "spawn_bot",
  "create_group",
  "schedule_create",
  "schedule_list",
  "schedule_cancel",
]);

const APPROVAL_REQUIRED_BUILTIN_TOOLS = new Set(["destination.write", "delete_bot", "archive_bot"]);
const EXPLICIT_APPROVAL_BUILTIN_TOOLS = new Set(["create_space"]);

const READ_ONLY_CONNECTOR_PATTERN = /(^|_)(get|list|search|find|read)(_|$)/i;
const MUTATING_CONNECTOR_PATTERN =
  /(^|_)(accept|activate|add|apply|approve|archive|assign|bid|block|book|burn|buy|cancel|charge|checkout|claim|close|commit|confirm|copy|create|deactivate|delete|deploy|deposit|disable|dispatch|enable|execute|follow|forward|grant|import|install|invite|issue|join|leave|link|mark|merge|mint|modify|move|mute|order|patch|pay|place|post|promote|publish|purchase|push|put|redeem|refund|register|reject|release|remove|rename|replace|reply|reset|restore|resume|revoke|rollback|run|schedule|send|set|share|sign|start|stop|submit|subscribe|suspend|swap|sync|transfer|trigger|unassign|unblock|uninstall|unfollow|unlink|unmute|unsubscribe|update|upload|upsert|vote|wire|withdraw|write)(_|$)/i;
const COMPOUND_CONNECTOR_ACTION_PATTERN = /_(and|or|then)_/i;

const EMAIL_CONNECTOR_SLUGS = new Set(["gmail", "outlook", "microsoft_outlook"]);
const PURCHASE_CONNECTOR_SLUGS = new Set(["stripe", "shopify", "paypal", "square"]);

export type ActionApprovalRule = Pick<
  StoredActionApprovalRule,
  "effect" | "matchKind" | "matchValue"
>;

export function connectorKindFromToolName(toolName: string, connectorKinds: string[] = []): string {
  const normalizedTool = toolName.toLowerCase();
  const matched = connectorKinds
    .map((kind) => kind.toLowerCase())
    .filter((kind) => normalizedTool === kind || normalizedTool.startsWith(`${kind}_`))
    .sort((left, right) => right.length - left.length)[0];
  if (matched) return matched;
  const [segment] = toolName.split("_");
  return (segment ?? toolName).toLowerCase();
}

/**
 * Tool names arrive in every shape a server author felt like using. The verb patterns match
 * on underscore boundaries, so camelCase and PascalCase names (`sendEmail`, `CreateIssue`)
 * would otherwise slip past every check. Split on case and punctuation first.
 */
function normalizeConnectorToolName(toolName: string): string {
  return toolName
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .replace(/[^A-Za-z0-9]+/g, "_");
}

/**
 * A tool whose name announces a mutation. A server-supplied read-only hint is
 * never trusted for these: the hint comes from the tool provider, and honoring
 * it would let any user-added MCP server bypass approval and the effect ledger.
 */
export function connectorToolNamesMutation(toolName: string): boolean {
  const normalized = normalizeConnectorToolName(toolName);
  return (
    MUTATING_CONNECTOR_PATTERN.test(normalized) ||
    COMPOUND_CONNECTOR_ACTION_PATTERN.test(normalized)
  );
}

export function connectorToolRequiresApproval(toolName: string): boolean {
  if (connectorToolNamesMutation(toolName)) return true;
  return !READ_ONLY_CONNECTOR_PATTERN.test(normalizeConnectorToolName(toolName));
}

/**
 * Whether a provider's `readOnlyHint` may be honored. The hint is a boolean supplied by
 * whoever wrote the connector, so it never applies to a name that announces a mutation in
 * any casing. Only the name decides; the hint can narrow, never widen.
 */
export function connectorHintCanClaimReadOnly(toolName: string, readOnlyHint: unknown): boolean {
  return readOnlyHint === true && !connectorToolNamesMutation(toolName);
}

export function toolRequiresApproval(toolName: string, viaConnector: boolean): boolean {
  if (APPROVAL_EXEMPT_TOOLS.has(toolName)) return false;
  if (toolRequiresExplicitApproval(toolName)) return true;
  if (APPROVAL_REQUIRED_BUILTIN_TOOLS.has(toolName)) return true;
  if (viaConnector) return connectorToolRequiresApproval(toolName);
  return false;
}

/** Security-boundary changes cannot be auto-reviewed or permanently allowed. */
export function toolRequiresExplicitApproval(toolName: string): boolean {
  return EXPLICIT_APPROVAL_BUILTIN_TOOLS.has(toolName);
}

function categoryMatches(category: string, toolName: string, connectorKind: string): boolean {
  const normalized = category.toLowerCase();
  const consequential = connectorToolRequiresApproval(toolName);
  if (normalized === "email") {
    if (EMAIL_CONNECTOR_SLUGS.has(connectorKind.toLowerCase())) return consequential;
    return consequential && /send.*mail|gmail_send|outlook_send/i.test(toolName);
  }
  if (normalized === "purchase") {
    if (PURCHASE_CONNECTOR_SLUGS.has(connectorKind.toLowerCase())) return consequential;
    return consequential && /purchase|pay_|charge|checkout|buy_/i.test(toolName);
  }
  return false;
}

function ruleMatches(rule: ActionApprovalRule, toolName: string, connectorKind: string): boolean {
  const value = rule.matchValue.toLowerCase();
  switch (rule.matchKind) {
    case "tool":
      return toolName.toLowerCase() === value;
    case "connector":
      return connectorKind.toLowerCase() === value;
    case "category":
      return categoryMatches(rule.matchValue, toolName, connectorKind);
    default:
      return false;
  }
}

function ruleSpecificity(rule: ActionApprovalRule): number {
  switch (rule.matchKind) {
    case "tool":
      return 3;
    case "connector":
      return 2;
    case "category":
      return 1;
    default:
      return 0;
  }
}

export type ActionApprovalSource = "require_approval" | "always_allow" | "default";

export type ActionApprovalResolved = {
  decision: "ask" | "allow";
  source: ActionApprovalSource;
  matchingRules: ActionApprovalRule[];
};

/** Deterministic rule resolution. Always-allow and require-approval both beat the default. */
export function resolveActionApprovalDetail(input: {
  toolName: string;
  connectorKind?: string;
  rules: ActionApprovalRule[];
}): ActionApprovalResolved {
  const connectorKind = input.connectorKind ?? connectorKindFromToolName(input.toolName);
  const matchingRules = input.rules.filter((rule) =>
    ruleMatches(rule, input.toolName, connectorKind),
  );
  if (matchingRules.length === 0) {
    return { decision: "allow", source: "default", matchingRules };
  }

  const highestSpecificity = Math.max(...matchingRules.map(ruleSpecificity));
  const winners = matchingRules.filter((rule) => ruleSpecificity(rule) === highestSpecificity);
  if (winners.some((rule) => rule.effect === "require_approval")) {
    return { decision: "ask", source: "require_approval", matchingRules };
  }
  return { decision: "allow", source: "always_allow", matchingRules };
}

export function resolveActionApproval(input: {
  toolName: string;
  connectorKind?: string;
  rules: ActionApprovalRule[];
}): "ask" | "allow" {
  return resolveActionApprovalDetail(input).decision;
}

export type AutoReviewJudgeDecision = "pass" | "ask" | "error";

/**
 * Pure combiner for Auto Review after rule resolution.
 * Rules win: require_approval asks, always_allow runs. Only the default path may call a judge.
 * The judge only escalates to ask; it never silent-denies.
 */
export function planActionGate(input: {
  resolved: ActionApprovalResolved;
  consequential: boolean;
  autoReviewEnabled: boolean;
  checkerConfigured: boolean;
}): "ask" | "allow" | "judge" {
  if (input.resolved.decision === "ask") return "ask";
  if (input.resolved.source === "always_allow") return "allow";
  if (
    input.consequential &&
    input.autoReviewEnabled &&
    input.checkerConfigured &&
    input.resolved.source === "default"
  ) {
    return "judge";
  }
  return "allow";
}

/** Map a judge outcome onto ask/allow. Errors fail closed on consequential tools. */
export function applyJudgeDecision(input: {
  decision: AutoReviewJudgeDecision;
  consequential: boolean;
}): "ask" | "allow" {
  if (input.decision === "pass") return "allow";
  if (input.decision === "ask") return "ask";
  return input.consequential ? "ask" : "allow";
}

export function isSecretAskBlock(block: {
  kind: string;
  input?: string;
  approvalEffectId?: string;
}): boolean {
  return block.kind === "ask" && block.input === "secret" && !block.approvalEffectId;
}

export function isApprovalAskBlock(block: {
  kind: string;
  approvalEffectId?: string;
  actions?: Array<{ id: string; label: string }>;
}): boolean {
  if (block.kind !== "ask" || !block.approvalEffectId || !block.actions?.length) return false;
  const actionIds = new Set(block.actions.map((action) => action.id));
  return (
    actionIds.has("allow") &&
    actionIds.has("deny") &&
    [...actionIds].every((id) => id === "allow" || id === "always" || id === "deny")
  );
}
