// Hook strategy check: is the creator still opening their latest Shorts the way their top Shorts open?
// One Jev call over both groups' spoken openings, with the questions in compare.json.
// Hook-type counts per group come from Jev's per-video answers; this call adds Jev's judgment of
// whether each latest opening follows the winning pattern.
import compare from "../compare.json";
import { JEV_PRICE_PER_M_INPUT, runJev } from "./jev";

type Item = { title: string; opening: string };

export async function compareGroups(env: any, top: Item[], latest: Item[]) {
  const c: any = compare;
  const questions: Record<string, any> = {};
  latest.forEach((_, i) => {
    for (const [k, q] of Object.entries(c.per_latest || {})) {
      const copy = JSON.parse(JSON.stringify(q));
      copy.instructions = String(copy.instructions).split("{i}").join(String(i));
      questions[`l${i}_${k}`] = copy;
    }
  });
  for (const [k, q] of Object.entries(c.overall || {})) questions[k] = JSON.parse(JSON.stringify(q));

  const state = { top: top.map((t) => ({ title: t.title, opening: t.opening })), latest: latest.map((t) => ({ title: t.title, opening: t.opening })) };
  const t0 = Date.now();
  const res: any = await runJev(env, { state, questions });
  const latency_ms = Date.now() - t0;
  const a = res?.answers || {};
  const follows = latest.map((_, i) => Number(a[`l${i}_follows`]?.noul ?? 0));
  const cl = a.closeness || {};
  const levels = Object.keys(cl.legend || { 0: 0, 1: 1, 2: 2 }).length - 1 || 2;
  const tokens = Number(res?.usage?.input_tokens || 0);
  return {
    follows,
    closeness: { score: Math.max(0, Math.min(1, Number(cl.score ?? 0) / levels)), label: (cl.legend || {})[Math.round(Number(cl.score ?? 0))] || "" },
    latency_ms,
    cost_usd: (tokens * JEV_PRICE_PER_M_INPUT) / 1e6,
  };
}
