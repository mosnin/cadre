# Realtime 2 capabilities and Cadre integration

Verified against OpenAI's primary documentation on 2026-09-07. Model-specific facts below refer to `gpt-realtime-2`; some current platform examples use the newer 2.1 model.

| Capability | What it means for Cadre |
| --- | --- |
| Native speech-to-speech and configurable reasoning | Use Realtime 2 with low reasoning effort for conversational latency. Higher effort trades latency and output tokens for deeper reasoning. |
| Text, audio and image input; text and audio output | Voice conversation and transcripts are wired. Screen/image input to the voice model is a separate feature; the task agent already observes its computer. |
| Function calling and prompt caching | Voice calls authenticated application tools; task execution persists independently. |
| 128k context, up to 32k output | These are model limits, not a reason to send complete task histories into every spoken turn. |

Source: [Realtime 2 model](https://developers.openai.com/api/docs/models/gpt-realtime-2).

The platform offers WebRTC for browser/mobile audio, WebSockets for server audio pipelines and SIP for telephony. Cadre uses WebRTC. Dedicated realtime translation and transcription sessions have distinct models and event lifecycles; they are not extra modes automatically enabled by selecting Realtime 2. [Realtime guide](https://developers.openai.com/api/docs/guides/realtime)

Voice sessions support server/semantic voice activity detection, manual turn control, interruption, transcripts, conversation items and streamed responses. WebRTC manages interruption and truncation of unheard output. Function calls can finish before their surrounding response: dispatch complete calls promptly, deduplicate by call ID, return their outputs and request a follow-up response after outstanding tools complete. [Conversation lifecycle](https://developers.openai.com/api/docs/guides/realtime-conversations)

Cadre exposes `list_agents`, `spawn_agent`, `delegate_task`, `start_task`, `task_status`, `stop_task`, `resume_agent` and `list_connections`. Creating a lasting agent requires an explicit user request; ordinary delegated work can use an existing agent. Status is read from the backend, rather than a stale screen snapshot. Work uses existing chat authorization and approval handling. Secrets remain in protected on-screen input. These are application capabilities implemented using function calling; the voice model does not create durable workers itself.

Realtime also supports remote MCP servers, connector tools, narrowed tool lists and approval events. Application function tools are appropriate when the app owns business logic and approval checks. Cadre routes connector work through its task API, preserving Composio authorization and existing approvals. It does not expose connector credentials in the browser or independently enable direct Realtime MCP access. [Realtime tools](https://developers.openai.com/api/docs/guides/realtime-mcp)

A server-side WebSocket can attach to the same WebRTC call through its call ID to handle tools and session controls. Cadre currently uses an authenticated HTTP tool bridge with the browser relaying events. Existing tasks survive call closure; new voice commands require the call to remain connected. A sideband worker would further decouple the event relay from browser lifecycle. [Server controls](https://developers.openai.com/api/docs/guides/realtime-server-controls)

Costs grow as prior turns become input to later responses. Cache reuse, bounded tool outputs, compact status updates and avoiding redundant turns matter more than merely choosing a large context window. Realtime exposes per-response usage and truncation controls. Cadre sends bounded task summaries and change-triggered updates; full task histories remain in durable task storage. Realtime truncation is not a replacement for task checkpoints or long-term memory. [Cost management](https://developers.openai.com/api/docs/guides/realtime-costs)
