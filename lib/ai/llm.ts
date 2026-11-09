// Collective's model client: free-tier Gemini first, Groq second, over their OpenAI-compatible
// chat APIs (plain fetch, no SDK). Every agent returns schema-validated JSON and records an
// ai_decision row. With neither GEMINI_API_KEY nor GROQ_API_KEY the agents use their rule-based
// fallback (Policies §14.5) and say so; when every provider fails, callers fall back the same way.
import { z } from "zod";
import type { DB } from "../db";
import { aiDecision } from "../db/schema";
import { newId } from "../util/ids";

// A public demo must not burn through the free quota: after AI_CALLS_PER_HOUR calls in an hour
// (default 300), AI turns off and every agent uses its rule-based fallback until the hour rolls over.
const g = globalThis as unknown as { __poolcartAiBudget?: { start: number; used: number }; __llmLastModel?: string };
const budget = (g.__poolcartAiBudget ??= { start: Date.now(), used: 0 });
function budgetLeft() {
  if (Date.now() - budget.start > 3600_000) Object.assign(budget, { start: Date.now(), used: 0 });
  return budget.used < Number(process.env.AI_CALLS_PER_HOUR || 300);
}
/** Count one AI call against the hourly budget. */
export const spendAiCall = () => void budget.used++;

type Provider = { name: "gemini" | "groq"; base: string; key: string; model: string; visionModel: string };

/** Configured providers, in the order they are tried. */
function providers(): Provider[] {
  const list: Provider[] = [];
  const gemini = process.env.GEMINI_API_KEY;
  if (gemini) {
    const model = process.env.GEMINI_MODEL || "gemini-3.8-flash";
    list.push({ name: "gemini", base: "https://generativelanguage.googleapis.com/v1beta/openai", key: gemini, model, visionModel: model });
  }
  const groq = process.env.GROQ_API_KEY;
  if (groq) {
    list.push({ name: "groq", base: "https://api.groq.com/openai/v1", key: groq, model: process.env.GROQ_MODEL || "openai/gpt-oss-120b", visionModel: process.env.GROQ_VISION_MODEL || "" });
  }
  return list;
}

// AI_MODE=rules forces the rule-based fallbacks even when a key is set.
export const aiEnabled = () => process.env.AI_MODE !== "rules" && providers().length > 0 && budgetLeft();
/** provider:model of the last successful call, else of the first provider that will be tried. */
export const aiModel = () => {
  const first = providers()[0];
  return g.__llmLastModel ?? (first ? `${first.name}:${first.model}` : "rules");
};

// ------------------------------------------------------------------ OpenAI-compatible wire types
export type ChatPart = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };
// extra_content carries Gemini's thought signature; it must be sent back with the call in the next turn.
export type ToolCall = { id: string; type: "function"; function: { name: string; arguments: string }; extra_content?: unknown };
export type ChatMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string | ChatPart[] }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };
export type ChatTool = { type: "function"; function: { name: string; description?: string; parameters: unknown } };
export type ChatRequest = {
  messages: ChatMessage[];
  tools?: ChatTool[];
  tool_choice?: "auto" | "none" | "required" | { type: "function"; function: { name: string } };
  response_format?: { type: "json_object" };
};
export type ChatResult = {
  id: string;
  model: string; // provider:model
  finishReason: string;
  message: { content: string | null; tool_calls?: ToolCall[] };
  usage: { inputTokens: number; outputTokens: number };
};

const hasImages = (msgs: ChatMessage[]) => msgs.some((m) => m.role === "user" && Array.isArray(m.content) && m.content.some((p) => p.type === "image_url"));

/**
 * One chat completion. Tries each configured provider in order and moves to the next on any
 * failure (rate limit, server error, bad key, network, timeout). Throws when all of them fail.
 */
export async function llmChat(req: ChatRequest, opts: { signal?: AbortSignal } = {}): Promise<ChatResult> {
  const list = providers();
  if (!list.length) throw new Error("No AI provider key set (GEMINI_API_KEY or GROQ_API_KEY)");
  const errors: string[] = [];
  for (const p of list) {
    const images = hasImages(req.messages);
    const model = images ? p.visionModel : p.model;
    if (!model) {
      errors.push(`${p.name}: no vision model configured`);
      continue;
    }
    // Only Gemini understands its own thought signatures; other providers get plain tool calls.
    const messages = p.name === "gemini" ? req.messages : req.messages.map((m) => (m.role === "assistant" && m.tool_calls ? { ...m, tool_calls: m.tool_calls.map(({ extra_content: _x, ...c }) => c) } : m)); // eslint-disable-line @typescript-eslint/no-unused-vars
    try {
      const signal = opts.signal ? AbortSignal.any([opts.signal, AbortSignal.timeout(60_000)]) : AbortSignal.timeout(60_000);
      const res = await fetch(`${p.base}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${p.key}` },
        body: JSON.stringify({ model, ...req, messages }),
        signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).replace(/\s+/g, " ").slice(0, 300)}`);
      const body = (await res.json()) as { id?: string; choices?: { finish_reason?: string; message?: { content?: string | null; tool_calls?: ToolCall[] } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } };
      const choice = body.choices?.[0];
      if (!choice?.message) throw new Error("response had no message");
      // Some providers leave tool-call ids empty; give every call an id so tool results can match it.
      const tool_calls = choice.message.tool_calls?.map((t, i) => ({ id: t.id || `call_${Date.now()}_${i}`, type: "function" as const, function: { name: t.function.name, arguments: t.function.arguments || "{}" }, ...(t.extra_content ? { extra_content: t.extra_content } : {}) }));
      const used = `${p.name}:${model}`;
      g.__llmLastModel = used;
      return {
        id: body.id || `llm_${Date.now()}`,
        model: used,
        finishReason: choice.finish_reason ?? "stop",
        message: { content: choice.message.content ?? null, ...(tool_calls?.length ? { tool_calls } : {}) },
        usage: { inputTokens: body.usage?.prompt_tokens ?? 0, outputTokens: body.usage?.completion_tokens ?? 0 },
      };
    } catch (e) {
      if (opts.signal?.aborted) throw e; // the caller cancelled: don't try the next provider
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`${p.name}: ${msg}`);
      console.error(`[llm] ${p.name} failed${list.at(-1) === p ? "" : ", trying the next provider"}: ${msg}`);
    }
  }
  throw new Error(`All AI providers failed (${errors.join("; ")})`);
}

/** zod → JSON Schema, without the keys Gemini's function declarations reject. */
export function jsonSchema(schema: z.ZodType): unknown {
  return clean(z.toJSONSchema(schema));
}
export function clean(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(clean);
  if (!v || typeof v !== "object") return v;
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(v)) {
    if (k === "$schema" || k === "additionalProperties") continue;
    if ((k === "minimum" || k === "maximum") && Math.abs(val as number) === Number.MAX_SAFE_INTEGER) continue; // zod's .int() bounds
    out[k] = clean(val);
  }
  return out;
}

// ------------------------------------------------------------------ structured JSON
/**
 * One structured call: the JSON schema goes in the system prompt, the reply is parsed and checked
 * with zod, and a failed check is sent back once for a correction. Throws when no valid output
 * comes back; callers fall back to rules.
 */
export async function llmJSON<S extends z.ZodType>(opts: { system: string; prompt: string; images?: string[]; schema: S }): Promise<{ data: z.infer<S>; model: string }> {
  const system = `${opts.system}\n\nReply with only a JSON object matching this JSON Schema:\n${JSON.stringify(jsonSchema(opts.schema))}`;
  const user: ChatMessage = opts.images?.length
    ? { role: "user", content: [...opts.images.map((url): ChatPart => ({ type: "image_url", image_url: { url: imageUrl(url) } })), { type: "text", text: opts.prompt }] }
    : { role: "user", content: opts.prompt };
  const messages: ChatMessage[] = [{ role: "system", content: system }, user];
  let problem = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await llmChat({ messages, response_format: { type: "json_object" } });
    const text = r.message.content ?? "";
    let parsed: unknown;
    try {
      parsed = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, ""));
    } catch {
      problem = "The reply was not valid JSON.";
    }
    if (parsed !== undefined) {
      const v = opts.schema.safeParse(parsed);
      if (v.success) return { data: v.data, model: r.model };
      problem = `The JSON did not match the schema: ${z.prettifyError(v.error)}`;
    }
    messages.push({ role: "assistant", content: text }, { role: "user", content: `${problem} Reply again with only the corrected JSON object.` });
  }
  throw new Error(`AI returned no valid output: ${problem}`);
}

// ------------------------------------------------------------------ tool loop
export type LlmTool = { name: string; description: string; schema: z.ZodType; run: (input: never) => Promise<string> | string };
/** Typed tool definition: `run` receives input already validated against `schema`. */
export const tool = <S extends z.ZodType>(t: { name: string; description: string; schema: S; run: (input: z.infer<S>) => Promise<string> | string }): LlmTool => t as LlmTool;

/**
 * OpenAI-style tool-calling loop. Each tool input is validated with zod before the tool runs;
 * invalid input, unknown tools and tool errors are reported back to the model, not executed.
 * Stops at the first reply without tool calls, or after maxIterations model turns.
 */
export async function llmToolLoop(opts: { system: string; messages: ChatMessage[]; tools: LlmTool[]; maxIterations: number }) {
  const messages: ChatMessage[] = [{ role: "system", content: opts.system }, ...opts.messages];
  const defs: ChatTool[] = opts.tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: jsonSchema(t.schema) } }));
  const toolCalls: { name: string; input: unknown; ran: boolean; result: string }[] = [];
  let text = "";
  let model = aiModel();
  for (let i = 0; i < opts.maxIterations; i++) {
    const r = await llmChat({ messages, tools: defs, tool_choice: "auto" });
    model = r.model;
    text = r.message.content ?? "";
    const calls = r.message.tool_calls ?? [];
    if (!calls.length) break;
    messages.push({ role: "assistant", content: r.message.content, tool_calls: calls });
    for (const c of calls) {
      const t = opts.tools.find((x) => x.name === c.function.name);
      let input: unknown;
      let result: string;
      let ran = false;
      try {
        input = JSON.parse(c.function.arguments || "{}");
      } catch {
        input = c.function.arguments;
      }
      const v = t?.schema.safeParse(input);
      if (!t) result = `Error: there is no tool named "${c.function.name}".`;
      else if (!v?.success) result = `Error: invalid input for ${t.name}, not run. ${v ? z.prettifyError(v.error) : ""}`;
      else {
        ran = true;
        try {
          result = await t.run(v.data as never);
        } catch (e) {
          result = `Error: ${e instanceof Error ? e.message : String(e)}`;
        }
      }
      toolCalls.push({ name: c.function.name, input, ran, result });
      messages.push({ role: "tool", tool_call_id: c.id, content: result });
    }
    text = "";
  }
  return { text: text.trim(), toolCalls, model };
}

// ------------------------------------------------------------------ agents
export type AgentResult<T> = { data: T; source: "ai" | "rules"; model: string; decisionId: string; error?: string };

/** Run an agent with AI when available, rules otherwise (or on AI failure). Logs the decision. */
export async function runAgent<T>(
  db: DB,
  agent: string,
  inputRef: string,
  ai: (() => Promise<{ data: T; model: string }>) | null,
  rules: () => T | Promise<T>,
): Promise<AgentResult<T>> {
  let result: { data: T; model: string; source: "ai" | "rules"; error?: string };
  if (ai && aiEnabled()) {
    try {
      spendAiCall();
      const r = await ai();
      result = { ...r, source: "ai" };
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      console.error(`[ai:${agent}] falling back to rules:`, error);
      result = { data: await rules(), model: "rules", source: "rules", error };
    }
  } else {
    result = { data: await rules(), model: "rules", source: "rules" };
  }
  const decisionId = newId("aid");
  await db.insert(aiDecision).values({ id: decisionId, agent, inputRef, output: result.data as object, model: result.model });
  return { ...result, decisionId };
}

/** Wrap untrusted user text so prompts treat it as data, not instructions (Policies §14.4). */
export const asData = (label: string, text: string) => `<${label}>\n${text.replaceAll(`</${label}>`, "")}\n</${label}>`;

/** Accept only base64 image data URLs (PNG, JPEG, GIF, WebP). */
function imageUrl(dataUrl: string) {
  if (!/^data:image\/(?:png|jpeg|gif|webp);base64,./.test(dataUrl)) throw new Error("Unsupported image; use PNG, JPEG, GIF or WebP");
  return dataUrl;
}
