import type {
  AccessibilityToolResult,
  AgentToolExecutionResult,
  ConnectorTool,
} from "@cadre/adapter-kit";

/**
 * Accessibility tools for computers that report `capabilities.accessibility` (Burst devices).
 * Argument names follow open-codex-computer-use's tool definitions; the device runs them.
 * Agent tool name -> device `ax` tool.
 */
const AX_TOOL_FOR: Record<string, string> = {
  computer_apps: "list_apps",
  computer_app_state: "get_app_state",
  computer_click_element: "click",
  computer_secondary_action: "perform_secondary_action",
  computer_scroll_element: "scroll",
  computer_drag: "drag",
  computer_type: "type_text",
  computer_key: "press_key",
  computer_set_value: "set_value",
};

export const ACCESSIBILITY_TOOL_NAMES = new Set(Object.keys(AX_TOOL_FOR));
/** Tools that only read state. */
export const ACCESSIBILITY_READ_ONLY_TOOLS = new Set(["computer_apps", "computer_app_state"]);
/** Tools whose results carry a screenshot for the model. */
export const ACCESSIBILITY_IMAGE_TOOLS = new Set(
  [...ACCESSIBILITY_TOOL_NAMES].filter((name) => name !== "computer_apps"),
);

const app = { type: "string", description: "App name or bundle identifier" };
const elementIndex = {
  type: "string",
  description: "Element index from the latest computer_app_state",
};

function schema(properties: Record<string, unknown>, required: string[]) {
  return { type: "object", properties, required, additionalProperties: false };
}

const PREFER_INDEX =
  "Prefer element_index from computer_app_state over pixel coordinates: it is faster and more reliable.";

export const accessibilityAgentTools: ConnectorTool[] = [
  {
    name: "computer_apps",
    description:
      "List the apps on this computer: running apps and ones used recently. Use before computer_app_state to find the app name.",
    inputSchema: schema({}, []),
    readOnly: true,
  },
  {
    name: "computer_app_state",
    description: `Get an app's key window as a numbered accessibility tree plus a screenshot. Call it once before interacting with an app and again after the window changes. ${PREFER_INDEX}`,
    inputSchema: schema(
      {
        app,
        text_limit: {
          anyOf: [
            { type: "integer", minimum: 1 },
            { type: "string", enum: ["max"] },
          ],
          description:
            'Maximum text characters to return. "max" returns all text. Defaults to 500.',
        },
        max_tree_nodes: {
          type: "integer",
          minimum: 1,
          description: "Maximum tree nodes to render. Defaults to 1200.",
        },
        max_tree_depth: {
          type: "integer",
          minimum: 1,
          description: "Maximum tree depth to render. Defaults to 64.",
        },
      },
      ["app"],
    ),
    readOnly: true,
  },
  {
    name: "computer_click_element",
    description: `Click an element by element_index, or by x and y in screenshot pixels. ${PREFER_INDEX}`,
    inputSchema: schema(
      {
        app,
        element_index: elementIndex,
        x: { type: "number", description: "X in screenshot pixel coordinates" },
        y: { type: "number", description: "Y in screenshot pixel coordinates" },
        click_count: { type: "integer", description: "Number of clicks. Defaults to 1" },
        mouse_button: { type: "string", enum: ["left", "right", "middle"] },
      },
      ["app"],
    ),
  },
  {
    name: "computer_secondary_action",
    description:
      "Invoke a secondary accessibility action an element lists in computer_app_state, such as Raise or ShowMenu.",
    inputSchema: schema({ app, element_index: elementIndex, action: { type: "string" } }, [
      "app",
      "element_index",
      "action",
    ]),
  },
  {
    name: "computer_scroll_element",
    description: "Scroll an element by element_index in a direction by a number of pages.",
    inputSchema: schema(
      {
        app,
        element_index: elementIndex,
        direction: { type: "string", enum: ["up", "down", "left", "right"] },
        pages: { type: "number", description: "Pages to scroll; fractions allowed. Defaults to 1" },
      },
      ["app", "element_index", "direction"],
    ),
  },
  {
    name: "computer_drag",
    description:
      "Drag from one point to another in screenshot pixel coordinates. Use only when no element supports the action.",
    inputSchema: schema(
      {
        app,
        from_x: { type: "number" },
        from_y: { type: "number" },
        to_x: { type: "number" },
        to_y: { type: "number" },
      },
      ["app", "from_x", "from_y", "to_x", "to_y"],
    ),
  },
  {
    name: "computer_type",
    description:
      "Type literal text with the keyboard into the focused element. For a known text field prefer computer_set_value.",
    inputSchema: schema({ app, text: { type: "string" } }, ["app", "text"]),
  },
  {
    name: "computer_key",
    description:
      'Press a key or combination, such as "Return", "Tab", "Up", or "super+c". Use for shortcuts and navigation keys.',
    inputSchema: schema({ app, key: { type: "string" } }, ["app", "key"]),
  },
  {
    name: "computer_set_value",
    description: "Set the value of a settable element by element_index, such as a text field.",
    inputSchema: schema({ app, element_index: elementIndex, value: { type: "string" } }, [
      "app",
      "element_index",
      "value",
    ]),
  },
];

/** Whether a device's reported capabilities allow accessibility tools. */
export function deviceHasAccessibility(capabilities: unknown): boolean {
  if (!capabilities || typeof capabilities !== "object") return false;
  const caps = capabilities as {
    accessibility?: unknown;
    permissions?: { accessibility?: unknown };
  };
  return caps.accessibility === true && caps.permissions?.accessibility !== false;
}

/** Validate model arguments and translate them to the device's `ax` request. */
export function accessibilityRequest(
  toolName: string,
  args: Record<string, unknown>,
): { tool: string; args: Record<string, unknown> } {
  const tool = AX_TOOL_FOR[toolName];
  if (!tool) throw new Error(`unknown accessibility tool ${toolName}`);
  if (tool === "list_apps") return { tool, args: {} };
  const tools = accessibilityAgentTools.find((entry) => entry.name === toolName);
  const properties = (tools?.inputSchema.properties ?? {}) as Record<string, unknown>;
  const required = (tools?.inputSchema.required ?? []) as string[];
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(properties)) {
    const value = args[key];
    if (value === undefined || value === null || value === "") continue;
    out[key] = key === "element_index" ? String(value) : value;
  }
  for (const key of required) {
    if (out[key] === undefined) throw new Error(`${toolName} requires ${key}`);
  }
  if (tool === "click" && out.element_index === undefined) {
    if (!Number.isFinite(Number(out.x)) || !Number.isFinite(Number(out.y)))
      throw new Error("computer_click_element needs element_index, or both x and y");
  }
  return { tool, args: out };
}

/** Convert a device result to a provider-neutral tool result that keeps screenshots as images. */
export function accessibilityToolResult(
  toolName: string,
  result: AccessibilityToolResult,
): AgentToolExecutionResult | { error: string } {
  const text = result.content
    .filter((item): item is { type: "text"; text: string } => item.type === "text")
    .map((item) => item.text)
    .join("\n")
    .trim();
  if (result.isError) return { error: text || `${toolName} failed` };
  const content: AgentToolExecutionResult["content"] = [];
  if (text) content.push({ type: "text", text });
  for (const item of result.content) {
    if (item.type !== "image") continue;
    if (item.mimeType === "image/png" || item.mimeType === "image/jpeg")
      content.push({ type: "image", data: item.data, mimeType: item.mimeType });
  }
  if (content.length === 0) content.push({ type: "text", text: "done" });
  return { kind: "agent_tool_result", content, details: { tool: toolName } };
}
