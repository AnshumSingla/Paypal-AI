// Thin wrapper over the Anthropic SDK for PoolCart's agents.
// Every agent returns schema-validated JSON (structured outputs) and records an ai_decision row.
// With no ANTHROPIC_API_KEY the agents use their rule-based fallback (Policies §14.5) and say so.
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";
import type { DB } from "../db";
import { aiDecision } from "../db/schema";
import { newId } from "../util/ids";

export const aiEnabled = () => Boolean(process.env.ANTHROPIC_API_KEY);
export const aiModel = () => process.env.CLAUDE_MODEL || "claude-opus-5-5";

let client: Anthropic | null = null;
const anthropic = () => (client ??= new Anthropic());

export type Effort = "low" | "medium" | "high";
type Content = Anthropic.Beta.Messages.BetaContentBlockParam[] | string;

/** One structured call. Throws on refusal, invalid output or API errors; callers fall back to rules. */
export async function structured<S extends z.ZodType>(opts: { system: string; content: Content; schema: S; effort?: Effort; maxTokens?: number }): Promise<{ data: z.infer<S>; model: string }> {
  const response = await anthropic().beta.messages.parse({
    model: aiModel(),
    max_tokens: opts.maxTokens ?? 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: opts.system,
    messages: [{ role: "user", content: opts.content }],
    output_config: { format: betaZodOutputFormat(opts.schema), effort: opts.effort ?? "low" },
  });
  if (response.stop_reason === "refusal") throw new Error(`Claude declined: ${response.stop_details?.explanation ?? "refusal"}`);
  if (!response.parsed_output) throw new Error(`Claude returned no parseable output (stop_reason=${response.stop_reason})`);
  return { data: response.parsed_output as z.infer<S>, model: response.model };
}

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

/** data:image/png;base64,... → image content block. */
export function imageBlock(dataUrl: string): Anthropic.Beta.Messages.BetaImageBlockParam {
  const m = /^data:(image\/(?:png|jpeg|gif|webp));base64,(.+)$/.exec(dataUrl);
  if (!m) throw new Error("Unsupported image; use PNG, JPEG, GIF or WebP");
  return { type: "image", source: { type: "base64", media_type: m[1] as "image/png", data: m[2] } };
}
