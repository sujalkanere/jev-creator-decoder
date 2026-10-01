import chat from "../chat.json";
import { JEV_PRICE_PER_M_INPUT, runJev } from "./jev";
import { CHALLENGERS, modelFor } from "./race";
import { setting } from "./settings";

export const ANSWER_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const A_IN = 0.293, A_OUT = 2.253; // USD per 1M tokens, Workers AI list price

const AVAILABLE_DATA = [
  "hook type, structure, views and post date for each decoded Short",
  "lift per hook type (median views vs channel median)",
  "how often each hook type is used",
  "hook mix per month for the last 6 months",
  "top videos by views",
  "number of videos Jev flagged for review",
];

function median(a: number[]) { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; }

// Build a compact, factual summary from the saved decode. This is the only data the chat model sees.
export function summarize(payload: any) {
  const recs: any[] = payload.records || [];
  const byId: Record<string, any> = {};
  for (const r of payload.results || []) byId[r.id] = r;
  const rows = recs.map((r) => {
    const a = byId[r.id]?.answers || {};
    return { title: r.title, views: r.views, posted_at: r.posted_at, hook: a.hook?.choice, structure: a.structure?.choice, review: !!byId[r.id]?.needs_review };
  }).filter((r) => r.hook);
  const all = median(rows.map((r) => r.views));
  const hooks: Record<string, any> = {};
  for (const r of rows) (hooks[r.hook] ||= []).push(r.views);
  const by_hook = Object.entries(hooks).map(([k, v]: any) => ({
    hook: k, videos: v.length, share_pct: Math.round((v.length / rows.length) * 100), lift: Math.round((median(v) / all) * 10) / 10,
  })).sort((a, b) => b.lift - a.lift);
  const months: Record<string, Record<string, number>> = {};
  for (const r of rows) { const m = String(r.posted_at).slice(0, 7); (months[m] ||= {})[r.hook] = (months[m][r.hook] || 0) + 1; }
  const recent = Object.keys(months).sort().slice(-6).map((m) => ({ month: m, ...months[m] }));
  const top = [...rows].sort((a, b) => b.views - a.views).slice(0, 5).map((r) => ({ title: r.title, views: r.views, hook: r.hook }));
  return {
    channel: payload.channel?.title || "",
    videos_decoded: rows.length,
    channel_median_views: all,
    by_hook,
    recent_months: recent,
    top_videos: top,
    flagged_for_review: rows.filter((r) => r.review).length,
  };
}

function expand(set: Record<string, any>) { return JSON.parse(JSON.stringify(set)); }

const CHART: Record<string, string> = { hook_strategy: "outperforms", comparison: "outperforms", timing: "mix", audience: "formula" };

export async function askDecoder(env: any, question: string, payload: any) {
  const q = String(question || "").slice(0, 400);
  const data = summarize(payload);
  let jevTokens = 0;
  const steps: any = {};

  // 1. Jev routes the question before any chat model runs.
  let t0 = Date.now();
  const route: any = await runJev(env, { state: { question: q, available_data: AVAILABLE_DATA }, questions: expand((chat as any).router) });
  steps.route_ms = Date.now() - t0;
  jevTokens += Number(route?.usage?.input_tokens || 0);
  const topic = route?.answers?.topic?.choice || "off_topic";
  const answerable = Number(route?.answers?.answerable?.noul ?? 0);

  if (topic === "off_topic" || answerable < 0.5) {
    return {
      blocked: true, topic, answerable, steps,
      answer: topic === "off_topic"
        ? "That question isn't about this creator's videos, so I skipped the chat model."
        : "The decoded data can't answer that. I only know titles, hooks, structures, views, and dates.",
      cost_usd: (jevTokens * JEV_PRICE_PER_M_INPUT) / 1e6,
    };
  }

  // 2. The chat model writes, using only the summary. Llama 3.3 70B by default; Settings can pick
  // Claude, OpenAI, or OpenRouter instead once that key is set.
  const SYSTEM = "You are a content strategist. Answer in under 110 words, then give one recommendation starting with 'Next:'. Use only numbers that appear in the DATA. If the DATA can't support a claim, say so.";
  const USER = `DATA: ${JSON.stringify(data)}\n\nQUESTION: ${q}`;
  // If the picked model's key was removed, fall back to the default rather than failing the chat.
  const pick = setting(env, "CHAT_MODEL"), picked = pick !== "default" ? CHALLENGERS[pick] : undefined;
  const c = picked && (!picked.keyVar || env[picked.keyVar]) ? picked : undefined;
  t0 = Date.now();
  let answer: string, answerCost: number | null, answer_model: string;
  if (c) {
    const model = modelFor(env, c);
    const r = await c.call(env, model, `${SYSTEM}\n\n${USER}`);
    const p = c.prices?.[model];
    answer = r.text.trim();
    answerCost = r.cost ?? (p ? (r.inTok * p[0] + r.outTok * p[1]) / 1e6 : null);
    answer_model = model;
  } else {
    const res: any = await env.AI.run(ANSWER_MODEL, { messages: [{ role: "system", content: SYSTEM }, { role: "user", content: USER }], max_tokens: 300 });
    answer = String(res?.response || "").trim();
    answerCost = (Number(res?.usage?.prompt_tokens ?? 0) * A_IN + Number(res?.usage?.completion_tokens ?? 0) * A_OUT) / 1e6;
    answer_model = "Llama 3.3 70B";
  }
  steps.answer_ms = Date.now() - t0;

  // 3. Jev fact-checks the answer before it is shown.
  t0 = Date.now();
  const check: any = await runJev(env, { state: { data, answer }, questions: expand((chat as any).check) });
  steps.check_ms = Date.now() - t0;
  jevTokens += Number(check?.usage?.input_tokens || 0);
  const grounded = Number(check?.answers?.grounded?.noul ?? 0);
  const act = check?.answers?.actionable || {};
  const levels = Object.keys(act.legend || { 0: 0, 1: 1, 2: 2 }).length - 1 || 2;

  // A small chart built from real decoded numbers, never from the chat model.
  const viz = topic === "timing"
    ? { kind: "months", rows: data.recent_months }
    : topic === "audience"
      ? { kind: "top", rows: data.top_videos.map((v: any) => ({ label: v.title, value: v.views, hook: v.hook })) }
      : { kind: "lift", rows: data.by_hook.map((h: any) => ({ label: h.hook, value: h.lift, share: h.share_pct })) };
  return {
    blocked: false, topic, answerable, answer, answer_model, steps, viz,
    grounded, grounded_ok: grounded >= 0.6,
    actionable: Math.max(0, Math.min(1, Number(act.score ?? 0) / levels)),
    chart: CHART[topic] || "formula",
    cost_usd: (jevTokens * JEV_PRICE_PER_M_INPUT) / 1e6 + (answerCost ?? 0),
  };
}
