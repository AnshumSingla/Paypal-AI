// AG Studio Insights agent (A7) backend: translates one AG Studio LLM turn (AgLlmRequest) into a
// Claude Messages call and back. The API key stays on the server. Studio's own agents and tools
// (build widgets, query data) run in the browser; this route only does the model call.
import Anthropic from "@anthropic-ai/sdk";
import type { AgLlmRequest } from "ag-studio";
import { aiEnabled, aiModel, spendAiCall } from "@/lib/ai/claude";

type Block = Anthropic.Beta.Messages.BetaContentBlockParam;
type Msg = { role: "user" | "assistant"; content: Block[] };

// Claude's thinking blocks must be sent back unchanged with the tool calls they preceded. Studio's
// history doesn't keep them, so we remember each assistant turn's exact content by tool-call id.
const g = globalThis as unknown as { __studioTurns?: Map<string, Block[]> };
const turns = (g.__studioTurns ??= new Map());

let client: Anthropic | null = null;

function toMessages(req: AgLlmRequest) {
  const system: string[] = [];
  if (req.instructions) system.push(req.instructions);
  const msgs: Msg[] = [];
  const push = (role: Msg["role"], block: Block) => {
    const last = msgs.at(-1);
    if (last && last.role === role) last.content.push(block);
    else msgs.push({ role, content: [block] });
  };
  for (const item of req.input) {
    if (item.type === "message" && item.kind === "input") {
      if (item.role === "system") {
        system.push(item.content.map((c) => (c.type === "text" ? c.text : "")).join("\n"));
        continue;
      }
      for (const c of item.content) {
        if (c.type === "text") push("user", { type: "text", text: c.text });
        else if (c.type === "image" && c.imageUrl?.startsWith("data:")) {
          const m = /^data:(image\/[a-z]+);base64,(.+)$/.exec(c.imageUrl);
          if (m) push("user", { type: "image", source: { type: "base64", media_type: m[1] as "image/png", data: m[2] } });
        }
      }
    } else if (item.type === "message") {
      const text = item.content.map((c) => (c.type === "text" ? c.text : c.refusal)).join("");
      if (text) push("assistant", { type: "text", text });
    } else if (item.type === "function_call") {
      const stash = turns.get(item.callId);
      const last = msgs.at(-1);
      if (stash && !(last?.role === "assistant" && last.content.some((b) => b.type === "tool_use" && b.id === item.callId))) {
        // Replace whatever we rebuilt for this assistant turn with the exact original content.
        if (last?.role === "assistant") msgs.pop();
        msgs.push({ role: "assistant", content: [...stash] });
      } else if (!stash) {
        let input: unknown = {};
        try {
          input = JSON.parse(item.arguments || "{}");
        } catch {}
        push("assistant", { type: "tool_use", id: item.callId, name: item.name, input });
      }
    } else if (item.type === "function_call_output") {
      push("user", { type: "tool_result", tool_use_id: item.callId, content: item.output });
    }
  }
  if (!msgs.length || msgs[0].role !== "user") msgs.unshift({ role: "user", content: [{ type: "text", text: "(continue)" }] });
  return { system: system.join("\n\n"), messages: msgs };
}

export async function POST(request: Request) {
  if (!aiEnabled()) return Response.json({ error: { code: "ai_disabled", message: "The AI analyst is off: no API key, or this hour's demo budget is used up." } }, { status: 503 });
  spendAiCall();
  const req = (await request.json()) as AgLlmRequest;
  const { system, messages } = toMessages(req);
  const tools = (req.tools ?? [])
    .filter((t) => !t.kind || t.kind === "client")
    .map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters as Anthropic.Beta.Messages.BetaTool.InputSchema }));
  // Claude Opus 5.5 does not accept forced tool choice: steer with an instruction instead.
  let steer = "";
  if (req.toolChoice === "required") steer = "\nYou must call one of the provided tools in this turn.";
  else if (typeof req.toolChoice === "object") steer = `\nYou must call the tool "${req.toolChoice.name}" in this turn.`;
  const json = req.responseFormat?.type === "json" ? req.responseFormat : null;

  client ??= new Anthropic();
  const params = {
    model: aiModel(),
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default" as const,
    system: `${system}${steer}\nYou are the analyst inside PoolCart's operations dashboard (AG Studio). Data is PoolCart sandbox data; amounts are USD.`,
    messages: messages as Anthropic.Beta.Messages.BetaMessageParam[],
    ...(tools.length ? { tools, tool_choice: req.toolChoice === "none" ? { type: "none" as const } : { type: "auto" as const } } : {}),
    output_config: { effort: "medium" as const, ...(json ? { format: { type: "json_schema" as const, schema: json.schema as Record<string, unknown> } } : {}) },
  };
  let res: Anthropic.Beta.Messages.BetaMessage;
  try {
    res = await client.beta.messages.create(params, { signal: request.signal });
  } catch (e) {
    if (json && e instanceof Anthropic.BadRequestError) {
      // Schema not supported by structured outputs: fall back to an instruction.
      const { format: _f, ...rest } = params.output_config;
      res = await client.beta.messages.create({ ...params, output_config: rest, system: `${params.system}\nReply with only JSON matching this schema:\n${JSON.stringify(json.schema)}` }, { signal: request.signal });
    } else {
      const message = e instanceof Error ? e.message : String(e);
      return Response.json({ error: { code: "anthropic_error", message } }, { status: 502 });
    }
  }

  const toolUses = res.content.filter((b) => b.type === "tool_use");
  if (toolUses.length) {
    const stash = res.content.filter((b) => b.type !== "fallback") as unknown as Block[];
    for (const t of toolUses) turns.set(t.id, stash);
    if (turns.size > 2000) turns.delete(turns.keys().next().value!);
  }
  const text = res.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  return Response.json({
    id: res.id,
    model: res.model,
    stopReason: res.stop_reason,
    refusal: res.stop_reason === "refusal" ? (res.stop_details?.explanation ?? "The model declined this request.") : null,
    text,
    toolCalls: toolUses.map((t) => ({ callId: t.id, name: t.name, arguments: JSON.stringify(t.input) })),
    usage: { inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens },
  });
}
