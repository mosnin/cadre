# Realtime 2 capabilities and future Cadre voice design

Voice call mode is removed from Cadre's interface while reliability and task context are unresolved. This is research for a future implementation, not a claim that these voice capabilities are available in Cadre.

Verified against primary documentation on 2026-09-07. Model facts refer to `gpt-realtime-2`; some current platform examples use 2.1.

| Capability | Implication for a future integration |
| --- | --- |
| Native speech-to-speech with configurable reasoning | Start with low effort for responsive conversation; higher effort increases latency and output-token usage. |
| Text, audio and image input; text and audio output | Screen context must be supplied deliberately; a voice model does not automatically see the app or its computers. |
| Function calling, parallel calls and prompt caching | Define authenticated application tools and return actual results. |
| 128k context and up to 32k output | Keep task summaries bounded instead of filling the voice context with full histories. |

Sources: [Realtime 2 model](https://developers.openai.com/api/docs/models/gpt-realtime-2), [session configuration](https://developers.openai.com/api/reference/python/resources/realtime/subresources/calls/methods/accept).

The platform provides WebRTC for browser/mobile audio, WebSockets for server pipelines and SIP for telephony. Dedicated streaming translation and transcription sessions use distinct models and event lifecycles. They are not automatically enabled by selecting Realtime 2. [Realtime guide](https://developers.openai.com/api/docs/guides/realtime)

Session controls include server/semantic voice activity detection, manual turns, interruption, transcripts, conversation items and streamed responses. WebRTC manages interruption and truncation of unheard output. Complete function calls need prompt dispatch, call-ID deduplication, returned outputs and a follow-up response after outstanding tools finish. [Conversation lifecycle](https://developers.openai.com/api/docs/guides/realtime-conversations)

A context-aware voice interface needs the selected space and agent, recent relevant conversation, current runs, fresh status tools, pending approvals and the connected tool inventory. Creating agents, delegating work, stopping tasks and handing a computer back must use the same authenticated backend as chat. Durable workers remain an application responsibility. A voice session must not treat task acceptance as completion or ask for secrets aloud.

Realtime supports remote MCP servers, connector tools, narrowed tool lists and approval events. Cadre's connector work should retain its existing authorization and approval boundaries. [Realtime tools](https://developers.openai.com/api/docs/guides/realtime-mcp)

A server-side WebSocket can attach to a WebRTC call using its call ID. This supports server-owned session context and tool execution instead of depending solely on browser event relaying. Persisting an agent task separately allows it to survive a disconnected call. [Server controls](https://developers.openai.com/api/docs/guides/realtime-server-controls)

Prompting controls cover intermediate spoken updates, final answers, unclear speech and background noise. Test real microphones, interruptions, reconnects and concurrent work before reintroducing call mode. [Realtime 2 prompting](https://developers.openai.com/api/docs/guides/realtime-models-prompting)

Conversation cost grows as earlier turns become later input. Cache reuse, bounded tool results, compact task updates, per-response usage and truncation settings can limit this growth. Truncation does not replace durable task checkpoints or long-term memory. [Cost management](https://developers.openai.com/api/docs/guides/realtime-costs)
