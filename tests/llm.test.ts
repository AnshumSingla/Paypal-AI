// The model client: provider fallback and the tool loop's input checks, with fetch mocked.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { llmJSON, llmToolLoop, tool } from "../lib/ai/llm";

type Sent = { url: string; auth: string; body: { model: string; messages: { role: string; content: unknown; tool_call_id?: string }[] } };
let sent: Sent[];

/** Queue fetch responses in order; each one is [status, body]. */
function mockFetch(...replies: [number, unknown][]) {
  const fetch = vi.fn(async (url: string, init: RequestInit) => {
    sent.push({ url, auth: (init.headers as Record<string, string>).Authorization, body: JSON.parse(init.body as string) });
    const [status, body] = replies.shift() ?? [500, { error: "no more replies" }];
    return new Response(JSON.stringify(body), { status });
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}
const reply = (message: object) => [200, { id: "r1", choices: [{ finish_reason: "stop", message }], usage: { prompt_tokens: 1, completion_tokens: 1 } }] as [number, unknown];
const call = (name: string, args: object) => ({ id: `c_${name}`, type: "function", function: { name, arguments: JSON.stringify(args) } });

beforeEach(() => {
  sent = [];
  process.env.GEMINI_API_KEY = "g-key";
  process.env.GROQ_API_KEY = "q-key";
});
afterEach(() => vi.unstubAllGlobals());

describe("llmJSON", () => {
  it("falls back from Gemini to Groq on a 429", async () => {
    mockFetch([429, { error: "quota" }], reply({ content: '{"answer": 42}' }));
    const r = await llmJSON({ system: "s", prompt: "p", schema: z.object({ answer: z.number() }) });
    expect(r).toEqual({ data: { answer: 42 }, model: "groq:llama-3.3-70b-versatile" });
    expect(sent.map((s) => [s.url, s.auth])).toEqual([
      ["https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", "Bearer g-key"],
      ["https://api.groq.com/openai/v1/chat/completions", "Bearer q-key"],
    ]);
  });

  it("throws a clean error when every provider fails", async () => {
    mockFetch([401, { error: "bad key" }], [401, { error: "bad key" }]);
    await expect(llmJSON({ system: "s", prompt: "p", schema: z.object({}) })).rejects.toThrow(/All AI providers failed \(gemini: HTTP 401.*; groq: HTTP 401/);
  });

  it("sends images to Groq's vision model", async () => {
    mockFetch([503, {}], reply({ content: "{}" }));
    await llmJSON({ system: "s", prompt: "p", images: ["data:image/png;base64,AAAA"], schema: z.object({}) });
    expect(sent[1].body.model).toBe("meta-llama/llama-4-scout-17b-16e-instruct");
  });
});

describe("llmToolLoop", () => {
  const refund = vi.fn(async ({ amountCents }: { amountCents: number }) => `refunded ${amountCents}`);
  const tools = [tool({ name: "issue_refund", description: "refund", schema: z.object({ amountCents: z.number().int() }), run: refund })];
  beforeEach(() => {
    refund.mockClear();
  });

  it("runs a tool with validated input and returns the final text", async () => {
    mockFetch(reply({ content: null, tool_calls: [call("issue_refund", { amountCents: 500 })] }), reply({ content: "Done." }));
    const r = await llmToolLoop({ system: "s", messages: [{ role: "user", content: "go" }], tools, maxIterations: 4 });
    expect(refund).toHaveBeenCalledWith({ amountCents: 500 });
    expect(r.text).toBe("Done.");
    expect(r.toolCalls).toEqual([{ name: "issue_refund", input: { amountCents: 500 }, ran: true, result: "refunded 500" }]);
    expect(sent[1].body.messages.at(-1)).toEqual({ role: "tool", tool_call_id: "c_issue_refund", content: "refunded 500" });
  });

  it("reports invalid tool input back to the model instead of running the tool", async () => {
    mockFetch(reply({ content: null, tool_calls: [call("issue_refund", { amountCents: "lots" })] }), reply({ content: "Sorry." }));
    const r = await llmToolLoop({ system: "s", messages: [{ role: "user", content: "go" }], tools, maxIterations: 4 });
    expect(refund).not.toHaveBeenCalled();
    expect(r.toolCalls[0].ran).toBe(false);
    const back = sent[1].body.messages.at(-1)!;
    expect(back.role).toBe("tool");
    expect(String(back.content)).toMatch(/invalid input for issue_refund, not run/);
  });

  it("stops after maxIterations", async () => {
    const loop = reply({ content: null, tool_calls: [call("issue_refund", { amountCents: 1 })] });
    const f = mockFetch(loop, loop, loop, loop);
    await llmToolLoop({ system: "s", messages: [{ role: "user", content: "go" }], tools, maxIterations: 2 });
    expect(f).toHaveBeenCalledTimes(2);
  });
});
