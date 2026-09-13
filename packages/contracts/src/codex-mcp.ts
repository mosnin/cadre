export const codexMcpTools = [
  {
    name: "cadre_me",
    description: "Read the authenticated Cadre identity and current space.",
    route: "me",
    method: "POST",
    inputSchema: {
      type: "object",
      properties: {
        spaceId: {
          type: "string",
          minLength: 1,
          maxLength: 200,
          description: "Select a space from cadre_list_spaces; membership is checked by Cadre",
        },
      },
      required: [],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: "cadre_list_spaces",
    description: "List every space accessible to the signed-in user.",
    route: "spaces/list",
    method: "POST",
    inputSchema: {
      type: "object",
      properties: {
        spaceId: {
          type: "string",
          minLength: 1,
          maxLength: 200,
          description: "Select a space from cadre_list_spaces; membership is checked by Cadre",
        },
      },
      required: [],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: "cadre_list_agents",
    description: "List agents in the selected space.",
    route: "bots/list",
    method: "POST",
    inputSchema: {
      type: "object",
      properties: {
        spaceId: {
          type: "string",
          minLength: 1,
          maxLength: 200,
          description: "Select a space from cadre_list_spaces; membership is checked by Cadre",
        },
      },
      required: [],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: "cadre_get_agent",
    description: "Read one agent configuration and status.",
    route: "bots/get",
    method: "POST",
    inputSchema: {
      type: "object",
      properties: {
        botId: {
          type: "string",
          minLength: 1,
          maxLength: 200,
          description: "Agent ID returned by cadre_list_agents",
        },
        spaceId: {
          type: "string",
          minLength: 1,
          maxLength: 200,
          description: "Select a space from cadre_list_spaces; membership is checked by Cadre",
        },
      },
      required: ["botId"],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: "cadre_list_groups",
    description: "List agent groups in the selected space.",
    route: "groups/list",
    method: "POST",
    inputSchema: {
      type: "object",
      properties: {
        spaceId: {
          type: "string",
          minLength: 1,
          maxLength: 200,
          description: "Select a space from cadre_list_spaces; membership is checked by Cadre",
        },
      },
      required: [],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: "cadre_get_thread",
    description: "Read one agent or group thread snapshot.",
    route: "threads/get",
    method: "POST",
    inputSchema: {
      type: "object",
      properties: {
        botId: {
          type: "string",
          minLength: 1,
          maxLength: 200,
          description: "Agent ID returned by cadre_list_agents",
        },
        groupId: {
          type: "string",
          minLength: 1,
          maxLength: 200,
          description: "Group ID; use this or botId, never both",
        },
        spaceId: {
          type: "string",
          minLength: 1,
          maxLength: 200,
          description: "Select a space from cadre_list_spaces; membership is checked by Cadre",
        },
      },
      required: [],
      additionalProperties: false,
      oneOf: [
        {
          required: ["botId"],
          not: {
            required: ["groupId"],
          },
        },
        {
          required: ["groupId"],
          not: {
            required: ["botId"],
          },
        },
      ],
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: "cadre_read_messages",
    description: "Read a bounded page of agent or group messages.",
    route: "threads/messages",
    method: "POST",
    inputSchema: {
      type: "object",
      properties: {
        botId: {
          type: "string",
          minLength: 1,
          maxLength: 200,
          description: "Agent ID returned by cadre_list_agents",
        },
        groupId: {
          type: "string",
          minLength: 1,
          maxLength: 200,
          description: "Group ID; use this or botId, never both",
        },
        before: {
          type: "integer",
          minimum: 0,
        },
        spaceId: {
          type: "string",
          minLength: 1,
          maxLength: 200,
          description: "Select a space from cadre_list_spaces; membership is checked by Cadre",
        },
      },
      required: [],
      additionalProperties: false,
      oneOf: [
        {
          required: ["botId"],
          not: {
            required: ["groupId"],
          },
        },
        {
          required: ["groupId"],
          not: {
            required: ["botId"],
          },
        },
      ],
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: "cadre_computer_status",
    description: "Read computer lifecycle status; this does not prove viewer or input readiness.",
    route: "computer/status",
    method: "POST",
    inputSchema: {
      type: "object",
      properties: {
        botId: {
          type: "string",
          minLength: 1,
          maxLength: 200,
          description: "Agent ID returned by cadre_list_agents",
        },
        spaceId: {
          type: "string",
          minLength: 1,
          maxLength: 200,
          description: "Select a space from cadre_list_spaces; membership is checked by Cadre",
        },
      },
      required: ["botId"],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: "cadre_list_runs",
    description: "List active or recent runs in the selected space.",
    route: "runs/list",
    method: "POST",
    inputSchema: {
      type: "object",
      properties: {
        filter: {
          type: "string",
          enum: ["active", "recent"],
        },
        spaceId: {
          type: "string",
          minLength: 1,
          maxLength: 200,
          description: "Select a space from cadre_list_spaces; membership is checked by Cadre",
        },
      },
      required: ["filter"],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: "cadre_search",
    description: "Search the selected space for relevant work.",
    route: "search/query",
    method: "POST",
    inputSchema: {
      type: "object",
      properties: {
        q: {
          type: "string",
          minLength: 1,
          maxLength: 200,
          description: "Search text",
        },
        spaceId: {
          type: "string",
          minLength: 1,
          maxLength: 200,
          description: "Select a space from cadre_list_spaces; membership is checked by Cadre",
        },
      },
      required: ["q"],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: "cadre_list_models",
    description: "Read the product-backed model catalog.",
    route: "models/list",
    method: "POST",
    inputSchema: {
      type: "object",
      properties: {
        spaceId: {
          type: "string",
          minLength: 1,
          maxLength: 200,
          description: "Select a space from cadre_list_spaces; membership is checked by Cadre",
        },
      },
      required: [],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: "cadre_send_task",
    description:
      "Send instructions to a Cadre agent or group. Starts agent execution and may consume provider credits or cause authorized external effects.",
    route: "threads/send",
    method: "POST",
    inputSchema: {
      type: "object",
      properties: {
        botId: {
          type: "string",
          minLength: 1,
          maxLength: 200,
          description: "Agent ID returned by cadre_list_agents",
        },
        groupId: {
          type: "string",
          minLength: 1,
          maxLength: 200,
          description: "Group ID; use this or botId, never both",
        },
        text: {
          type: "string",
          minLength: 1,
          maxLength: 16000,
          description: "Bounded task with desired outcome and constraints",
        },
        clientNonce: {
          type: "string",
          minLength: 1,
          maxLength: 200,
          description: "Stable nonce for this exact task",
        },
        spaceId: {
          type: "string",
          minLength: 1,
          maxLength: 200,
          description: "Select a space from cadre_list_spaces; membership is checked by Cadre",
        },
      },
      required: ["text", "clientNonce"],
      additionalProperties: false,
      oneOf: [
        {
          required: ["botId"],
          not: {
            required: ["groupId"],
          },
        },
        {
          required: ["groupId"],
          not: {
            required: ["botId"],
          },
        },
      ],
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  {
    name: "cadre_stop_task",
    description: "Request cancellation of an agent or group task; verify its later run state.",
    route: "threads/stop",
    method: "POST",
    inputSchema: {
      type: "object",
      properties: {
        botId: {
          type: "string",
          minLength: 1,
          maxLength: 200,
          description: "Agent ID returned by cadre_list_agents",
        },
        groupId: {
          type: "string",
          minLength: 1,
          maxLength: 200,
          description: "Group ID; use this or botId, never both",
        },
        spaceId: {
          type: "string",
          minLength: 1,
          maxLength: 200,
          description: "Select a space from cadre_list_spaces; membership is checked by Cadre",
        },
      },
      required: [],
      additionalProperties: false,
      oneOf: [
        {
          required: ["botId"],
          not: {
            required: ["groupId"],
          },
        },
        {
          required: ["groupId"],
          not: {
            required: ["botId"],
          },
        },
      ],
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  {
    name: "cadre_boot_computer",
    description:
      "Start the agent\u2019s persistent computer; may allocate paid provider resources.",
    route: "computer/boot",
    method: "POST",
    inputSchema: {
      type: "object",
      properties: {
        botId: {
          type: "string",
          minLength: 1,
          maxLength: 200,
          description: "Agent ID returned by cadre_list_agents",
        },
        spaceId: {
          type: "string",
          minLength: 1,
          maxLength: 200,
          description: "Select a space from cadre_list_spaces; membership is checked by Cadre",
        },
      },
      required: ["botId"],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  {
    name: "cadre_stop_computer",
    description:
      "Stop the agent\u2019s computer through Cadre\u2019s checkpoint and cancellation workflow.",
    route: "computer/stop",
    method: "POST",
    inputSchema: {
      type: "object",
      properties: {
        botId: {
          type: "string",
          minLength: 1,
          maxLength: 200,
          description: "Agent ID returned by cadre_list_agents",
        },
        spaceId: {
          type: "string",
          minLength: 1,
          maxLength: 200,
          description: "Select a space from cadre_list_spaces; membership is checked by Cadre",
        },
      },
      required: ["botId"],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
] as const;
