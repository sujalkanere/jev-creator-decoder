import { fetchShorts } from "./adapters/youtube";
import { classifyBatch } from "./jev";
import { draftHooks, judgeHooks } from "./hooks";
import { raceJev, raceLlmOne } from "./race";
import { askDecoder } from "./ask";

export interface Env {
  AI: any;
  DB: any;
  ASSETS: any;
  YOUTUBE_API_KEY: string;
  DASHBOARD_PASSCODE: string;
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (!url.pathname.startsWith("/api/")) return json({ error: "Not found" }, 404);

    // Every API route is gated behind the dashboard passcode.
    if (!env.DASHBOARD_PASSCODE || req.headers.get("x-passcode") !== env.DASHBOARD_PASSCODE) {
      return json({ error: "Wrong or missing passcode" }, 401);
    }

    try {
      const body: any = req.method === "POST" ? await req.json() : {};

      switch (url.pathname) {
        case "/api/ingest": {
          const handle = (url.searchParams.get("handle") || "").trim();
          if (!handle) return json({ error: "Add a creator handle, like @creator" }, 400);
          const key = (handle.startsWith("@") ? handle : "@" + handle).toLowerCase();
          const saved = await env.DB.prepare("SELECT payload FROM decodes WHERE handle = ?").bind(key).first();
          if (saved) {
            const data = JSON.parse(saved.payload);
            // fresh=1 re-runs Jev on the saved videos (no extra YouTube quota), for example after you edit schema.json.
            if (url.searchParams.get("fresh") === "1") return json({ handle: key, cached: false, channel: data.channel, records: data.records, quota_units: 0 });
            return json({ handle: key, cached: true, ...data });
          }
          const data = await fetchShorts(key, env.YOUTUBE_API_KEY);
          return json({ handle: key, cached: false, channel: data.channel, records: data.records, quota_units: data.quota_units });
        }
        case "/api/classify": {
          if (!Array.isArray(body.videos) || !body.videos.length) return json({ error: "Send up to 10 videos" }, 400);
          return json(await classifyBatch(env, body.videos, Number(body.threshold ?? 0.6)));
        }
        case "/api/save": {
          const key = String(body.handle || "").toLowerCase();
          if (!key) return json({ error: "Missing handle" }, 400);
          const payload = JSON.stringify({ channel: body.channel, records: body.records, results: body.results, stats: body.stats });
          await env.DB.prepare(
            "INSERT INTO decodes (handle, title, count, payload, saved_at) VALUES (?, ?, ?, ?, ?) " +
            "ON CONFLICT(handle) DO UPDATE SET title = excluded.title, count = excluded.count, payload = excluded.payload, saved_at = excluded.saved_at"
          ).bind(key, body.channel?.title || key, (body.records || []).length, payload, new Date().toISOString()).run();
          return json({ ok: true });
        }
        case "/api/library": {
          const { results } = await env.DB.prepare("SELECT handle, title, count, saved_at FROM decodes ORDER BY saved_at DESC LIMIT 50").all();
          return json({ items: results || [] });
        }
        case "/api/forget": {
          await env.DB.prepare("DELETE FROM decodes WHERE handle = ?").bind(String(body.handle || "").toLowerCase()).run();
          return json({ ok: true });
        }
        case "/api/race/jev":
          return json(await raceJev(env, body.videos || []));
        case "/api/race/llm":
          return json(await raceLlmOne(env, body.video || {}));
        case "/api/ask": {
          const key = String(body.handle || "").toLowerCase();
          const saved = await env.DB.prepare("SELECT payload FROM decodes WHERE handle = ?").bind(key).first();
          if (!saved) return json({ error: "Decode this creator first, then ask." }, 400);
          return json(await askDecoder(env, body.question, JSON.parse(saved.payload)));
        }
        case "/api/draft":
          return json({ hooks: await draftHooks(env, body.pattern, body.topic) });
        case "/api/judge":
          return json(await judgeHooks(env, body.hooks || [], body.pattern));
        default:
          return json({ error: "Not found" }, 404);
      }
    } catch (err: any) {
      return json({ error: err?.message || "Something went wrong" }, 500);
    }
  },
};
