import schema from "../schema.json";
import type { VideoRecord } from "./adapters/adapter";
import { classifyBatch } from "./jev";
import { LLM_MODEL } from "./hooks";

// Workers AI list price for @cf/meta/llama-3.1-8b-instruct-fp8-fast (USD per 1M tokens).
const LLM_IN = 0.045, LLM_OUT = 0.384;

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

// Chat model side: one video per call, the way most people use a chat model to classify.
export async function raceLlmOne(env: any, v: VideoRecord) {
  const hookOptions = Object.keys((schema as any).per_video.hook.criteria);
  const prompt =
    `Classify this short-form video title: "${v.title}". Description: "${(v.text || "").slice(0, 200)}". ` +
    `Respond with only JSON like {"hook":"..."} where hook is one of ${JSON.stringify(hookOptions)}.`;
  const t0 = Date.now();
  const res: any = await env.AI.run(LLM_MODEL, { messages: [{ role: "user", content: prompt }], max_tokens: 60 });
  const ms = Date.now() - t0;
  const text: string = res?.response ?? "";
  const inTok = Number(res?.usage?.prompt_tokens ?? Math.ceil(prompt.length / 4));
  const outTok = Number(res?.usage?.completion_tokens ?? Math.ceil(text.length / 4));
  const cost_usd = (inTok * LLM_IN + outTok * LLM_OUT) / 1_000_000;
  try {
    const m = text.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(m ? m[0] : text);
    if (!hookOptions.includes(parsed.hook)) throw new Error("bad label");
    return { id: v.id, hook: parsed.hook, ok: true, ms, cost_usd };
  } catch {
    return { id: v.id, hook: null, ok: false, raw: text.slice(0, 120), ms, cost_usd };
  }
}
