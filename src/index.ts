import { fetchShorts, parseInput } from "./adapters/youtube";
import { classifyBatch } from "./jev";
import { draftHooks, judgeHooks } from "./hooks";
import { raceJev, raceLlmOne } from "./race";
import { askDecoder } from "./ask";
import { handleAuth, isSignedIn } from "./auth";

export interface Env {
  AI: any;
  DB: any;
  ASSETS: any;
  YOUTUBE_API_KEY: string;
  SETUP_TOKEN?: string;
  TYPESAFE_API_KEY?: string; // optional: when set, Jev runs on TypeSafe's API first, with Workers AI as fallback
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (!url.pathname.startsWith("/api/")) return json({ error: "Not found" }, 404);

    try {
      // Sign-in routes are open. Everything else needs a signed-in session.
      if (url.pathname.startsWith("/api/auth/")) {
        const b: any = req.method === "POST" ? await req.json().catch(() => ({})) : {};
        return await handleAuth(env, req, url.pathname, b);
      }
      if (!(await isSignedIn(env, req))) return json({ error: "Please sign in." }, 401);
    } catch (err: any) {
      return json({ error: err?.message || "Something went wrong" }, 500);
    }

    try {
      const body: any = req.method === "POST" ? await req.json() : {};

      switch (url.pathname) {
        case "/api/ingest": {
          const input = (url.searchParams.get("handle") || "").trim();
          if (!input) return json({ error: "Add a creator handle, channel link, or video link." }, 400);
          const parsed = parseInput(input);
          const key = (parsed.handle || input).toLowerCase();
          const saved = await env.DB.prepare("SELECT payload FROM decodes WHERE handle = ?").bind(key).first();
          if (saved) {
            const data = JSON.parse(saved.payload);
            // fresh=1 re-runs Jev on the saved videos (no extra YouTube quota), for example after you edit schema.json.
            if (url.searchParams.get("fresh") === "1") return json({ handle: key, cached: false, channel: data.channel, records: data.records, quota_units: 0 });
            return json({ handle: key, cached: true, ...data });
          }
          const data = await fetchShorts(input, env.YOUTUBE_API_KEY);
          const real = data.channel.handle;
          if (real !== key) {
            const again = await env.DB.prepare("SELECT payload FROM decodes WHERE handle = ?").bind(real).first();
            if (again && url.searchParams.get("fresh") !== "1") return json({ handle: real, cached: true, ...JSON.parse(again.payload) });
          }
          return json({ handle: real, cached: false, channel: data.channel, records: data.records, quota_units: data.quota_units });
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
          const { results } = await env.DB.prepare(
            "SELECT handle, title, count, saved_at, json_extract(payload, '$.channel.avatar') AS avatar FROM decodes ORDER BY saved_at DESC LIMIT 50"
          ).all();
          return json({ items: results || [] });
        }
        case "/api/shortlist": {
          const handle = String(body.handle || url.searchParams.get("handle") || "").toLowerCase();
          if (req.method === "POST" && body.action === "add") {
            const h = body.hook || {};
            await env.DB.prepare("INSERT INTO shortlist (handle, text, data, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(handle, text) DO NOTHING")
              .bind(handle, String(h.text || "").slice(0, 300), JSON.stringify(h), new Date().toISOString()).run();
          } else if (req.method === "POST" && body.action === "remove") {
            await env.DB.prepare("DELETE FROM shortlist WHERE handle = ? AND text = ?").bind(handle, String(body.text || "")).run();
          }
          const { results } = await env.DB.prepare("SELECT text, data FROM shortlist WHERE handle = ? ORDER BY created_at").bind(handle).all();
          return json({ items: (results || []).map((r: any) => JSON.parse(r.data)) });
        }
        case "/api/forget": {
          const h = String(body.handle || "").toLowerCase();
          await env.DB.prepare("DELETE FROM decodes WHERE handle = ?").bind(h).run();
          await env.DB.prepare("DELETE FROM shortlist WHERE handle = ?").bind(h).run();
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
