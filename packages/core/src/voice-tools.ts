const text = (description: string) => ({ type: "string", description });
const tool = (
  name: string,
  description: string,
  properties: Record<string, unknown>,
  required: string[] = [],
) => ({
  type: "function" as const,
  name,
  description,
  parameters: { type: "object", properties, required, additionalProperties: false },
});

/** Shared capability contract; authenticated server handlers own every action. */
export const REALTIME_VOICE_TOOLS = [
  tool(
    "list_agents",
    "List the user's available agents and their current status. Use before choosing an agent; never invent an ID.",
    {},
  ),
  tool(
    "task_status",
    "Fetch fresh task status, pending input, and latest result for an agent. Defaults to the selected agent.",
    { agentId: text("An ID returned by list_agents or spawn_agent.") },
  ),
  tool(
    "start_task",
    "Start or steer work on the selected agent. Use for research, browsing, connector work, and requests to use temporary helpers. Preserve the user's full request.",
    { request: text("The complete task or follow-up.") },
    ["request"],
  ),
  tool(
    "delegate_task",
    "Start or steer work on an existing agent chosen from list_agents. Work continues independently of this voice call.",
    { agentId: text("The chosen agent ID."), request: text("The complete delegated task.") },
    ["agentId", "request"],
  ),
  tool(
    "spawn_agent",
    "Create a lasting agent with its own chat and start its task. Only when the user requests a new agent; use start_task for temporary helpers.",
    { name: text("A short agent name."), request: text("Its initial task and role.") },
    ["name", "request"],
  ),
  tool(
    "stop_task",
    "Stop an agent's task when the user asks. This does not undo completed actions.",
    { agentId: text("Agent ID; defaults to the selected agent.") },
  ),
  tool(
    "resume_agent",
    "Hand the selected agent's computer screen back and continue its task, only when the user asks it to resume or take control back.",
    {},
  ),
  tool(
    "list_connections",
    "Check which app connectors are configured and their saved connection status. Saved status alone does not prove a live tool works.",
    {},
  ),
];

export const REALTIME_VOICE_TOOL_NAMES = new Set(REALTIME_VOICE_TOOLS.map((item) => item.name));
