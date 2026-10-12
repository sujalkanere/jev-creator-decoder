import schema from "../schema.json";
import type { VideoRecord } from "./adapters/adapter";

export const JEV_MODEL = "typesafe/jev";
export const JEV_PRICE_PER_M_INPUT = 0.042; // USD per 1M input tokens. Output tokens are free.

// Drops lone UTF-16 surrogates (half an emoji), which TypeSafe rejects as invalid Unicode.
// Older saved decodes can still contain them from before descriptions were cut safely.
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
const wellFormed = (_k: string, v: unknown) => (typeof v === "string" ? v.replace(LONE_SURROGATE, "") : v);

// Calls local or hosted Laya System-1 HTTP API.
async function runLaya(env: any, input: { state: unknown; questions: Record<string, any> }) {
  const url = env.LAYA_URL || "http://127.0.0.1:8000/v1/systemone";
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (env.LAYA_API_KEY) headers.authorization = `Bearer ${env.LAYA_API_KEY}`;

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ state: input.state, model: env.LAYA_MODEL || "laya", questions: input.questions }, wellFormed),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Laya (${url}) returned HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
  return await res.json();
}

// Calls TypeSafe's own HTTP API. Throws on network errors and non-2xx responses.
async function runJevTypesafe(env: any, input: { state: unknown; questions: Record<string, any> }) {
  const res = await fetch("https://api.typesafe.ai/v1/systemone", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${env.TYPESAFE_API_KEY}` },
    body: JSON.stringify({ state: input.state, model: "jev-latest", questions: input.questions }, wellFormed),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${res.status} ${body.slice(0, 200)}`);
  }
  return await res.json();
}

// Runs the System 1 decision engine.
// Prioritizes Laya (open source, $0 cost) when LAYA_URL is set or when TYPESAFE_API_KEY is not provided.
// If TYPESAFE_API_KEY is provided, calls TypeSafe with fallback to Workers AI.
export async function runJev(env: any, input: { state: unknown; questions: Record<string, any> }) {
  const useLaya = Boolean(env.LAYA_URL || !env.TYPESAFE_API_KEY);
  if (useLaya) {
    try {
      return await runLaya(env, input);
    } catch (layaErr: any) {
      if (env.TYPESAFE_API_KEY) {
        try {
          return await runJevTypesafe(env, input);
        } catch (tsErr: any) {
          throw new Error(`Decision model unavailable: Laya (${layaErr?.message || layaErr}) and TypeSafe (${tsErr?.message || tsErr})`);
        }
      }
      const targetUrl = env.LAYA_URL || "http://127.0.0.1:8000/v1/systemone";
      throw new Error(`Laya unavailable at ${targetUrl}: ${layaErr?.message || layaErr}. Make sure your local server is running (e.g. run 'laya-serve' in a terminal).`);
    }
  }

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
// spoken: the batch has transcripts, so use per_video_spoken's instructions (same keys and criteria).
export function buildVideoQuestions(count: number, spoken = false) {
  const questions: Record<string, any> = {};
  const perVideo = (schema as any).per_video as Record<string, any>;
  const spokenText = ((schema as any).per_video_spoken || {}) as Record<string, string>;
  for (let i = 0; i < count; i++) {
    for (const [key, q] of Object.entries(perVideo)) {
      const copy = JSON.parse(JSON.stringify(q));
      if (spoken && spokenText[key]) copy.instructions = spokenText[key];
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
  // A batch is "spoken" when every Short in it has a transcript: Jev then reads what is said, not just the title.
  const spoken = batch.every((v) => v.transcript);
  const state = { videos: batch.map((v) => spoken
    ? { title: v.title, description: v.text, opening: v.opening || "", transcript: v.transcript }
    : { title: v.title, description: v.text }) };
  const questions = buildVideoQuestions(batch.length, spoken);

  const t0 = Date.now();
  const res: any = await runJev(env, { state, questions });
  const latency_ms = Date.now() - t0;

  const input_tokens = Number(res?.usage?.input_tokens || 0);
  const perVideo = splitAnswers(res?.answers, batch.length);

  const results = batch.map((v, i) => {
    const a = perVideo[i];
    const choices = Object.values(a).filter((x: any) => x?.type === "choice") as any[];
    const minConf = choices.length ? Math.min(...choices.map((c) => Number(c.confidence ?? 1))) : 1;
    return { id: v.id, answers: a, needs_review: minConf < threshold, ...(spoken ? { source: "transcript" } : {}) };
  });

  const modelName = res?.model || (env.LAYA_URL || !env.TYPESAFE_API_KEY ? "laya" : JEV_MODEL);
  const isLaya = /laya/i.test(modelName) || !env.TYPESAFE_API_KEY;
  const cost_usd = isLaya ? 0 : (input_tokens * JEV_PRICE_PER_M_INPUT) / 1_000_000;

  return {
    model: modelName,
    results,
    questions: Object.keys(questions).length,
    latency_ms,
    input_tokens,
    cost_usd,
  };
}
