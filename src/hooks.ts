import judge from "../judge.json";
import { JEV_PRICE_PER_M_INPUT, runJev } from "./jev";

export const LLM_MODEL = "@cf/meta/llama-3.1-8b-instruct-fp8-fast";

export interface WinningPattern {
  channel: string;
  top_hooks: string[];   // hook types with the highest lift
  examples: string[];    // top performing titles
}

// Chat model drafts. Jev judges.
export async function draftHooks(env: any, pattern: WinningPattern, topic?: string): Promise<string[]> {
  const prompt =
    `Write 5 hooks for short-form videos by ${pattern.channel || "this creator"}` +
    (topic ? ` about ${topic}` : "") +
    `. Their best hook types are: ${pattern.top_hooks.join(", ")}. ` +
    `Their top titles: ${pattern.examples.slice(0, 5).join(" | ")}. ` +
    `Each hook must be under 12 words. Return only a JSON array of 5 strings.`;
  const res: any = await env.AI.run(LLM_MODEL, { messages: [{ role: "user", content: prompt }], max_tokens: 300 });
  // Workers AI hands back already-parsed JSON when the model replies with pure JSON.
  if (Array.isArray(res?.response)) return res.response.map(String).filter(Boolean).slice(0, 5);
  const text = typeof res?.response === "string" ? res.response : JSON.stringify(res?.response ?? "");
  try {
    const m = text.match(/\[[\s\S]*\]/);
    const arr = JSON.parse(m ? m[0] : text);
    if (Array.isArray(arr)) return arr.map(String).filter(Boolean).slice(0, 5);
  } catch {}
  return text.split("\n").map((l) => l.replace(/^[\s\d.\-*"]+|"$/g, "").trim()).filter(Boolean).slice(0, 5);
}

export async function judgeHooks(env: any, hooks: string[], pattern: WinningPattern) {
  const list = hooks.slice(0, 10);
  const perHook = (judge as any).per_hook as Record<string, any>;
  const questions: Record<string, any> = {};
  list.forEach((_, i) => {
    for (const [key, q] of Object.entries(perHook)) {
      const copy = JSON.parse(JSON.stringify(q));
      copy.instructions = String(copy.instructions).split("{h}").join(`hooks[${i}]`);
      questions[`h${i}_${key}`] = copy;
    }
  });

  const t0 = Date.now();
  const res: any = await runJev(env, { state: { hooks: list, winning_pattern: pattern }, questions });
  const latency_ms = Date.now() - t0;
  const a = res?.answers || {};

  const results = list.map((text, i) => {
    const type = a[`h${i}_type`] || {};
    const strength = a[`h${i}_strength`] || {};
    const levels = Object.keys(strength.legend || { 0: 0, 1: 1, 2: 2 }).length - 1 || 2;
    const s = Math.max(0, Math.min(1, Number(strength.score ?? 0) / levels));
    const fit = Number(a[`h${i}_fit`]?.noul ?? 0);
    const lift = Number(a[`h${i}_lift_odds`]?.noul ?? 0);
    return {
      text,
      hook_type: type.choice || "unknown",
      score: Math.round(100 * (0.4 * s + 0.3 * fit + 0.3 * lift)),
      bars: { hook: s, fit, lift_odds: lift },
      answers: { type: a[`h${i}_type`], strength: a[`h${i}_strength`], fit: a[`h${i}_fit`], lift_odds: a[`h${i}_lift_odds`] },
    };
  });

  const input_tokens = Number(res?.usage?.input_tokens || 0);
  return { results, latency_ms, input_tokens, cost_usd: (input_tokens * JEV_PRICE_PER_M_INPUT) / 1_000_000 };
}
