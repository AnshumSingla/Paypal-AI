// AG Studio Insights agent (A7) backend: translates one AG Studio LLM turn (AgLlmRequest) into an
// OpenAI-style chat call (Gemini, then Groq) and back. The API keys stay on the server. Studio's own
// agents and tools (build widgets, query data) run in the browser; this route only does the model call.
import type { AgLlmRequest } from "ag-studio";
import { aiEnabled, clean, llmChat, spendAiCall, type ChatMessage, type ChatPart, type ChatRequest } from "@/lib/ai/llm";
import { getSession } from "@/lib/session";

function toMessages(req: AgLlmRequest) {
  const system: string[] = [];
  if (req.instructions) system.push(req.instructions);
  const msgs: ChatMessage[] = [];
  const user = (part: ChatPart) => {
    const last = msgs.at(-1);
    if (last?.role === "user" && Array.isArray(last.content)) last.content.push(part);
    else msgs.push({ role: "user", content: [part] });
  };
  // Text and tool calls from one assistant turn go in one assistant message.
  const assistant = () => {
    const last = msgs.at(-1);
    if (last?.role === "assistant") return last;
    const m: Extract<ChatMessage, { role: "assistant" }> = { role: "assistant", content: null };
    msgs.push(m);
    return m;
  };
  for (const item of req.input) {
    if (item.type === "message" && item.kind === "input") {
      if (item.role === "system") {
        system.push(item.content.map((c) => (c.type === "text" ? c.text : "")).join("\n"));
        continue;
      }
      for (const c of item.content) {
        if (c.type === "text") user({ type: "text", text: c.text });
        else if (c.type === "image" && c.imageUrl?.startsWith("data:image/")) user({ type: "image_url", image_url: { url: c.imageUrl } });
      }
    } else if (item.type === "message") {
      const text = item.content.map((c) => (c.type === "text" ? c.text : c.refusal)).join("");
      if (text) {
        const m = assistant();
        m.content = (m.content ?? "") + text;
      }
    } else if (item.type === "function_call") {
      const m = assistant();
      (m.tool_calls ??= []).push({ id: item.callId, type: "function", function: { name: item.name, arguments: item.arguments || "{}" } });
    } else if (item.type === "function_call_output") {
      msgs.push({ role: "tool", tool_call_id: item.callId, content: item.output });
    }
  }
  if (!msgs.length || msgs[0].role !== "user") msgs.unshift({ role: "user", content: "(continue)" });
  return { system: system.join("\n\n"), messages: msgs };
}

export async function POST(request: Request) {
  const { user } = await getSession();
  if (user?.role !== "operator") return Response.json({ error: { code: "forbidden", message: "Open the operator view to use the AI analyst." } }, { status: 403 });
  if (!aiEnabled()) return Response.json({ error: { code: "ai_disabled", message: "The AI analyst is off: no API key, or this hour's demo budget is used up." } }, { status: 503 });
  spendAiCall();
  const req = (await request.json()) as AgLlmRequest;
  const { system, messages } = toMessages(req);
  const tools = (req.tools ?? []).filter((t) => !t.kind || t.kind === "client").map((t) => ({ type: "function" as const, function: { name: t.name, description: t.description, parameters: clean(t.parameters) } }));
  const json = req.responseFormat?.type === "json" ? req.responseFormat : null;
  const toolChoice: ChatRequest["tool_choice"] = typeof req.toolChoice === "object" ? { type: "function", function: { name: req.toolChoice.name } } : (req.toolChoice ?? "auto");

  const body: ChatRequest = {
    messages: [
      { role: "system", content: `${system}\nYou are the analyst inside Collective's operations dashboard (AG Studio). Collective runs bulk grocery buying for an Indian housing society; data is PayPal sandbox data; amounts are USD.${json ? `\nReply with only a JSON object matching this schema:\n${JSON.stringify(json.schema)}` : ""}` },
      ...messages,
    ],
    ...(tools.length ? { tools, tool_choice: toolChoice } : {}),
    // JSON mode can't be combined with tools on Gemini or Groq; with tools the instruction above steers.
    ...(json && !tools.length ? { response_format: { type: "json_object" as const } } : {}),
  };
  try {
    const res = await llmChat(body, { signal: request.signal });
    const toolCalls = res.message.tool_calls ?? [];
    return Response.json({
      id: res.id,
      model: res.model,
      stopReason: res.finishReason,
      refusal: null,
      text: res.message.content ?? "",
      toolCalls: toolCalls.map((t) => ({ callId: t.id, name: t.function.name, arguments: t.function.arguments })),
      usage: res.usage,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return Response.json({ error: { code: "ai_error", message } }, { status: 502 });
  }
}
