import { describe, expect, it, vi } from "vitest";
import { OpenAIRealtimeCall } from "./openai-realtime";

function fixture() {
  const events = {
    phase: vi.fn(),
    heard: vi.fn(),
    caption: vi.fn(),
    error: vi.fn(),
    tool: vi.fn().mockResolvedValue({ accepted: true }),
  };
  const call = new OpenAIRealtimeCall(events);
  return { call, events };
}
const task = {
  type: "response.done",
  response: {
    output: [
      {
        type: "function_call",
        call_id: "call-1",
        name: "start_task",
        arguments: '{"request":"Create proof.txt"}',
      },
    ],
  },
};
describe("Realtime task bridge", () => {
  it("dispatches one task even when the completed function event is repeated", async () => {
    const { call, events } = fixture();
    await call.receive(task);
    await call.receive(task);
    expect(events.tool).toHaveBeenCalledExactlyOnceWith(
      "start_task",
      {
        request: "Create proof.txt",
      },
      "call-1",
    );
  });
  it("does not dispatch malformed or unknown tool calls", async () => {
    const { call, events } = fixture();
    await call.receive({
      type: "response.done",
      response: { output: [{ ...task.response.output[0], name: "arbitrary" }] },
    });
    expect(events.tool).not.toHaveBeenCalled();
  });
  it("does not dispatch tool calls after hanging up", async () => {
    const { call, events } = fixture();
    call.close();
    await call.receive(task);
    expect(events.tool).not.toHaveBeenCalled();
  });
  it("does not display transcripts while protected input mutes the microphone", async () => {
    const { call, events } = fixture();
    call.setInputEnabled(false);
    await call.receive({
      type: "conversation.item.input_audio_transcription.completed",
      transcript: "secret",
    });
    expect(events.heard).not.toHaveBeenCalled();
  });
});

it("handles early function completion and the response summary only once", async () => {
  const { call, events } = fixture();
  await call.receive({ type: "response.created" });
  await call.receive({ ...task.response.output[0], type: "response.function_call_arguments.done" });
  await call.receive({ type: "response.output_item.done", item: task.response.output[0] });
  await call.receive(task);
  expect(events.tool).toHaveBeenCalledOnce();
});
it("executes parallel tool calls without serializing one behind another", async () => {
  const { call, events } = fixture();
  let resolve!: (value: unknown) => void;
  events.tool.mockReturnValueOnce(
    new Promise((r) => {
      resolve = r;
    }),
  );
  const received = call.receive({
    type: "response.done",
    response: {
      output: [
        task.response.output[0],
        { ...task.response.output[0], call_id: "call-2", name: "list_agents", arguments: "{}" },
      ],
    },
  });
  expect(events.tool).toHaveBeenCalledTimes(2);
  resolve({ accepted: true });
  await received;
});
it("does not launch unfinished actions from a canceled response", async () => {
  const { call, events } = fixture();
  await call.receive({ ...task, response: { ...task.response, status: "cancelled" } });
  expect(events.tool).not.toHaveBeenCalled();
});
