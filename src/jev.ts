import schema from "../schema.json";
import type { VideoRecord } from "./adapters/adapter";

export const JEV_MODEL = "typesafe/jev";
export const JEV_PRICE_PER_M_INPUT = 0.042; // USD per 1M input tokens. Output tokens are free.

// Calls TypeSafe's own HTTP API. Throws on network errors and non-2xx responses.
async function runJevTypesafe(env: any, input: { state: unknown; questions: Record<string, any> }) {
  const res = await fetch("https://api.typesafe.ai/v1/systemone", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${env.TYPESAFE_API_KEY}` },
    body: JSON.stringify({ state: input.state, model: "jev-latest", questions: input.questions }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${res.status} ${body.slice(0, 200)}`);
  }
  return await res.json();
}

// Runs Jev on TypeSafe's own HTTP API when TYPESAFE_API_KEY is set, falling back to
// Cloudflare Workers AI if that call fails. Without the key, Cloudflare is used alone.
// Both speak the same state/questions/answers contract, so callers read the result the same way.
export async function runJev(env: any, input: { state: unknown; questions: Record<string, any> }) {
  if (!env.TYPESAFE_API_KEY) return await env.AI.run(JEV_MODEL, input);
  try {
    return await runJevTypesafe(env, input);
  } catch (tsErr: any) {
    try {
      return await env.AI.run(JEV_MODEL, input);
    } catch (cfErr: any) {
      throw new Error(`Jev unavailable: TypeSafe API (${tsErr?.message || tsErr}) and Cloudflare (${cfErr?.message || cfErr})`);
    }
  }
}

// Build one questions object for a batch: every schema question repeated per video.
// Keys look like v3_hook. {v} in instructions becomes videos[3].
export function buildVideoQuestions(count: number) {
  const questions: Record<string, any> = {};
  const perVideo = (schema as any).per_video as Record<string, any>;
  for (let i = 0; i < count; i++) {
    for (const [key, q] of Object.entries(perVideo)) {
      const copy = JSON.parse(JSON.stringify(q));
      copy.instructions = String(copy.instructions).split("{v}").join(`videos[${i}]`);
      questions[`v${i}_${key}`] = copy;
    }
  }
  return questions;
}

// Split Jev's flat answers back into one object per video.
function splitAnswers(answers: Record<string, any>, count: number) {
  const out: Record<string, any>[] = Array.from({ length: count }, () => ({}));
  for (const [k, v] of Object.entries(answers || {})) {
    const m = /^v(\d+)_(.+)$/.exec(k);
    if (m && out[Number(m[1])]) out[Number(m[1])][m[2]] = v;
  }
  return out;
}

export async function classifyBatch(env: any, videos: VideoRecord[], threshold = 0.6) {
  const batch = videos.slice(0, 10);
  const state = { videos: batch.map((v) => ({ title: v.title, description: v.text })) };
  const questions = buildVideoQuestions(batch.length);

  const t0 = Date.now();
  const res: any = await runJev(env, { state, questions });
  const latency_ms = Date.now() - t0;

  const input_tokens = Number(res?.usage?.input_tokens || 0);
  const perVideo = splitAnswers(res?.answers, batch.length);

  const results = batch.map((v, i) => {
    const a = perVideo[i];
    const choices = Object.values(a).filter((x: any) => x?.type === "choice") as any[];
    const minConf = choices.length ? Math.min(...choices.map((c) => Number(c.confidence ?? 1))) : 1;
    return { id: v.id, answers: a, needs_review: minConf < threshold };
  });

  return {
    model: res?.model || JEV_MODEL,
    results,
    questions: Object.keys(questions).length,
    latency_ms,
    input_tokens,
    cost_usd: (input_tokens * JEV_PRICE_PER_M_INPUT) / 1_000_000,
  };
}
