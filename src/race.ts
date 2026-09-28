import Anthropic from "@anthropic-ai/sdk";
import schema from "../schema.json";
import type { VideoRecord } from "./adapters/adapter";
import { classifyBatch } from "./jev";
import { LLM_MODEL } from "./hooks";

// Jev side: all 10 videos in one batched call.
export async function raceJev(env: any, videos: VideoRecord[]) {
  const t0 = Date.now();
  const r = await classifyBatch(env, videos.slice(0, 10));
  return {
    ms: Date.now() - t0,
    cost_usd: r.cost_usd,
    results: r.results.map((x: any) => ({ id: x.id, hook: x.answers.hook?.choice ?? null, ok: !!x.answers.hook?.choice })),
  };
}

// Challenger side. Every provider gets the same prompt, one video per call, the way most people
// use a chat model to classify. A provider appears in the race once its API key is set.
// Model ids can be overridden per provider in .dev.vars. Prices are list prices in USD per 1M
// tokens [input, output], keyed by model id; a model missing from its table shows cost as unknown.
type Reply = { text: string; inTok: number; outTok: number; cost?: number };
interface Challenger {
  label: string;
  provider: string;
  keyVar?: string;
  modelVar?: string;
  model: string;
  prices?: Record<string, [number, number]>;
  call: (env: any, model: string, prompt: string) => Promise<Reply>;
}

export const CHALLENGERS: Record<string, Challenger> = {
  llama: {
    label: "Llama 3.1 8B", provider: "Cloudflare Workers AI", model: LLM_MODEL, prices: { [LLM_MODEL]: [0.045, 0.384] },
    call: async (env, model, prompt) => {
      const res: any = await env.AI.run(model, { messages: [{ role: "user", content: prompt }], max_tokens: 60 });
      // Workers AI hands back already-parsed JSON when the model replies with pure JSON.
      const text = typeof res?.response === "string" ? res.response : JSON.stringify(res?.response ?? "");
      return { text, inTok: Number(res?.usage?.prompt_tokens ?? Math.ceil(prompt.length / 4)), outTok: Number(res?.usage?.completion_tokens ?? Math.ceil(text.length / 4)) };
    },
  },
  claude: {
    label: "Claude Opus 5", provider: "Anthropic", keyVar: "ANTHROPIC_API_KEY", modelVar: "ANTHROPIC_MODEL", model: "claude-opus-5",
    prices: { "claude-opus-5": [5, 25], "claude-opus-5-5": [4, 20], "claude-sonnet-5": [2, 10], "claude-haiku-4-5": [1, 5] },
    call: async (env, model, prompt) => {
      const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
      // Low effort suits a one-label classification. Server-side fallbacks retry on another
      // model if this one declines, so a refusal doesn't count against the model unfairly.
      const res = await client.beta.messages.create({
        model,
        max_tokens: 1024,
        output_config: { effort: "low" },
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        messages: [{ role: "user", content: prompt }],
      });
      const text = res.stop_reason === "refusal" ? "" : res.content.map((b) => (b.type === "text" ? b.text : "")).join("");
      return { text, inTok: res.usage.input_tokens, outTok: res.usage.output_tokens };
    },
  },
  openai: {
    label: "GPT-5 mini", provider: "OpenAI", keyVar: "OPENAI_API_KEY", modelVar: "OPENAI_MODEL", model: "gpt-5-mini", prices: { "gpt-5-mini": [0.25, 2] },
    call: async (env, model, prompt) => {
      const body: any = { model, messages: [{ role: "user", content: prompt }], max_completion_tokens: 2000 };
      // The original GPT-5 family accepts "minimal" reasoning, which keeps a one-label answer fast.
      if (/^gpt-5(-mini|-nano)?$/.test(model)) body.reasoning_effort = "minimal";
      const j = await postJSON("https://api.openai.com/v1/chat/completions", env.OPENAI_API_KEY, body, "OpenAI");
      return { text: String(j?.choices?.[0]?.message?.content ?? ""), inTok: Number(j?.usage?.prompt_tokens ?? 0), outTok: Number(j?.usage?.completion_tokens ?? 0) };
    },
  },
  openrouter: {
    label: "Gemini 2.5 Flash Lite", provider: "OpenRouter", keyVar: "OPENROUTER_API_KEY", modelVar: "OPENROUTER_MODEL", model: "google/gemini-2.5-flash-lite",
    call: async (env, model, prompt) => {
      // OpenRouter reports the real cost of each call, so any model id works without a price table.
      const j = await postJSON("https://openrouter.ai/api/v1/chat/completions", env.OPENROUTER_API_KEY,
        { model, messages: [{ role: "user", content: prompt }], max_tokens: 1000, usage: { include: true } }, "OpenRouter");
      const cost = Number(j?.usage?.cost);
      return { text: String(j?.choices?.[0]?.message?.content ?? ""), inTok: Number(j?.usage?.prompt_tokens ?? 0), outTok: Number(j?.usage?.completion_tokens ?? 0), cost: Number.isFinite(cost) ? cost : undefined };
    },
  },
};

async function postJSON(url: string, key: string, body: unknown, who: string) {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${key}` }, body: JSON.stringify(body) });
  const j: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${who} ${res.status}: ${j?.error?.message || res.statusText}`);
  return j;
}

function modelFor(env: any, c: Challenger) {
  return (c.modelVar && env[c.modelVar]) || c.model;
}

// What the race page shows in its picker: every challenger, and whether its key is set.
export function listChallengers(env: any) {
  return Object.entries(CHALLENGERS).map(([id, c]) => {
    const model = modelFor(env, c);
    return { id, provider: c.provider, model, label: model === c.model ? c.label : model, ready: !c.keyVar || !!env[c.keyVar], needs: c.keyVar || null };
  });
}

export async function raceLlmOne(env: any, v: VideoRecord, id = "llama") {
  const c = CHALLENGERS[id];
  if (!c) throw new Error(`Unknown model "${id}".`);
  if (c.keyVar && !env[c.keyVar]) throw new Error(`Add ${c.keyVar} to .dev.vars to race ${c.label}.`);
  const model = modelFor(env, c);
  const hookOptions = Object.keys((schema as any).per_video.hook.criteria);
  const prompt =
    `Classify this short-form video title: "${v.title}". Description: "${Array.from(v.text || "").slice(0, 200).join("")}". ` +
    `Respond with only JSON like {"hook":"..."} where hook is one of ${JSON.stringify(hookOptions)}.`;
  const t0 = Date.now();
  const r = await c.call(env, model, prompt);
  const ms = Date.now() - t0;
  const p = c.prices?.[model];
  const cost_usd = r.cost ?? (p ? (r.inTok * p[0] + r.outTok * p[1]) / 1_000_000 : null);
  try {
    const m = r.text.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(m ? m[0] : r.text);
    if (!hookOptions.includes(parsed.hook)) throw new Error("bad label");
    return { id: v.id, hook: parsed.hook, ok: true, ms, cost_usd };
  } catch {
    return { id: v.id, hook: null, ok: false, raw: r.text.slice(0, 120), ms, cost_usd };
  }
}
