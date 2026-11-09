// AG Studio LLM adapter backed by Gemini or Groq (via this app's /api/ai/studio route, which holds the keys).
// Each turn is one non-streaming call; the reply is replayed to Studio as AG-UI style events.
import type { AgAiEvent, AgAiOutputItem, AgLlmAdapter, AgLlmResponse } from "ag-studio";

type Reply = {
  id: string;
  model: string;
  stopReason: string;
  refusal: string | null;
  text: string;
  toolCalls: { callId: string; name: string; arguments: string }[];
  usage: { inputTokens: number; outputTokens: number };
  error?: { code: string; message: string };
};

export function aiAdapter({ endpoint }: { endpoint: string }): AgLlmAdapter {
  return {
    executeTurn(request, options) {
      const reply = fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request), signal: options?.signal }).then(async (r) => (await r.json()) as Reply);

      const complete: Promise<AgLlmResponse> = reply.then((r) => {
        const createdAt = Date.now();
        if (r.error) return { id: `err_${createdAt}`, createdAt, status: "failed", error: r.error, output: [] };
        const output: AgAiOutputItem[] = [];
        if (r.text || r.refusal) {
          output.push({ id: `${r.id}_msg`, kind: "output", type: "message", role: "assistant", status: "completed", content: r.refusal ? [{ type: "refusal", refusal: r.refusal }] : [{ type: "text", text: r.text, annotations: [] }] });
        }
        for (const t of r.toolCalls) output.push({ id: t.callId, kind: "output", type: "function_call", callId: t.callId, name: t.name, arguments: t.arguments, status: "completed" });
        return {
          id: r.id,
          createdAt,
          status: r.stopReason === "length" ? "incomplete" : "completed",
          ...(r.stopReason === "length" ? { incompleteDetails: { reason: "max_output_tokens" as const } } : {}),
          output,
          model: r.model,
          usage: { inputTokens: r.usage.inputTokens, outputTokens: r.usage.outputTokens, totalTokens: r.usage.inputTokens + r.usage.outputTokens },
        };
      });

      async function* events(): AsyncGenerator<AgAiEvent> {
        const r = await reply;
        if (r.error) return;
        const messageId = `${r.id}_msg`;
        const text = r.refusal ?? r.text;
        if (text) {
          yield { type: "TEXT_MESSAGE_START", messageId, role: "assistant" };
          for (let i = 0; i < text.length; i += 40) yield { type: "TEXT_MESSAGE_CONTENT", messageId, delta: text.slice(i, i + 40) };
          yield { type: "TEXT_MESSAGE_END", messageId };
        }
        for (const t of r.toolCalls) {
          yield { type: "TOOL_CALL_START", toolCallId: t.callId, toolCallName: t.name, parentMessageId: messageId };
          yield { type: "TOOL_CALL_ARGS", toolCallId: t.callId, delta: t.arguments };
          yield { type: "TOOL_CALL_END", toolCallId: t.callId };
        }
      }

      return { stream: { [Symbol.asyncIterator]: () => events() }, complete };
    },
  };
}
