import { Button, Input, Textarea } from "@cadre/ui-web";
import { useLingui } from "@lingui/react/macro";
import { Plus, Trash2 } from "lucide-react";
import { AGENT_TYPES_MAX, type AgentTypeDraft, agentNameIssue } from "../../lib/subagents";

/** Edits a bot's custom sub-agent types. Controlled: the parent owns the list and validation. */
export function AgentTypesEditor({
  agents,
  onChange,
}: {
  agents: AgentTypeDraft[];
  onChange: (next: AgentTypeDraft[]) => void;
}) {
  const { t } = useLingui();
  const patch = (index: number, change: Partial<AgentTypeDraft>) =>
    onChange(agents.map((agent, i) => (i === index ? { ...agent, ...change } : agent)));
  const issueText = (name: string) => {
    const issue = agentNameIssue(name, agents);
    if (issue === "name-invalid")
      return t`Use 2–32 lowercase letters, digits or dashes, starting with a letter.`;
    if (issue === "name-duplicate") return t`Another sub-agent type already uses this name.`;
    return undefined;
  };
  return (
    <div className="mt-5" data-testid="agent-types-editor">
      <div className="text-[14px] text-muted-foreground">{t`Sub-agent types`}</div>
      {agents.map((agent, index) => {
        const issue = issueText(agent.name);
        return (
          <fieldset key={index} className="mt-3 rounded-xl border border-border p-3">
            <div className="flex items-center gap-2">
              <Input
                aria-label={t`Sub-agent type name`}
                aria-invalid={issue ? true : undefined}
                placeholder="data-analyst"
                value={agent.name}
                maxLength={32}
                onChange={(event) => patch(index, { name: event.target.value })}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={t`Remove sub-agent type`}
                onClick={() => onChange(agents.filter((_, i) => i !== index))}
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
            {issue ? <p className="mt-1 text-[13px] text-destructive">{issue}</p> : null}
            <Input
              className="mt-2"
              aria-label={t`Sub-agent type description`}
              placeholder={t`When to use this sub-agent`}
              value={agent.description}
              onChange={(event) => patch(index, { description: event.target.value })}
            />
            <Textarea
              className="mt-2"
              rows={3}
              aria-label={t`Sub-agent type instructions`}
              placeholder={t`Instructions`}
              value={agent.instructions}
              onChange={(event) => patch(index, { instructions: event.target.value })}
            />
            <Input
              className="mt-2"
              aria-label={t`Sub-agent type tools`}
              placeholder={t`Tools, comma separated (optional)`}
              value={(agent.tools ?? []).join(", ")}
              onChange={(event) =>
                patch(index, {
                  tools: event.target.value.split(",").map((tool) => tool.trimStart()),
                })
              }
            />
            <Input
              className="mt-2"
              aria-label={t`Sub-agent type model`}
              placeholder={t`Model (optional)`}
              value={agent.model ?? ""}
              onChange={(event) => patch(index, { model: event.target.value })}
            />
          </fieldset>
        );
      })}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="mt-3"
        disabled={agents.length >= AGENT_TYPES_MAX}
        onClick={() => onChange([...agents, { name: "", description: "", instructions: "" }])}
      >
        <Plus className="size-4" />
        {t`Add sub-agent type`}
      </Button>
    </div>
  );
}
