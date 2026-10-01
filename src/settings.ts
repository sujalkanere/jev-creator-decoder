// Settings saved from the dashboard. They live in D1's settings table under "cfg:" keys and
// win over .env, so learners can add or rotate a key without re-running setup or ship.
// API keys are encrypted with AES-GCM using SETTINGS_SECRET, and are never sent back to the
// browser: the Settings page only sees whether a key is set, where it came from, and its last 4 characters.
import { CHALLENGERS, listChallengers } from "./race";

export const SECRET_KEYS = ["YOUTUBE_API_KEY", "TYPESAFE_API_KEY", "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "OPENROUTER_API_KEY"];
const MODEL_KEYS = ["ANTHROPIC_MODEL", "OPENAI_MODEL", "OPENROUTER_MODEL"];
export const DEFAULTS = { CHAT_MODEL: "default", REVIEW_THRESHOLD: "0.6", DRAFT_COUNT: "5" };
const PLAIN_KEYS = [...MODEL_KEYS, ...Object.keys(DEFAULTS)];
const PREFIX = "cfg:";

const enc = new TextEncoder(), dec = new TextDecoder();
const hex = (b: ArrayBuffer | Uint8Array) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
const unhex = (s: string) => new Uint8Array(s.match(/../g)!.map((h) => parseInt(h, 16)));

async function aesKey(env: any) {
  if (!env.SETTINGS_SECRET) throw new Error("Saving keys here needs SETTINGS_SECRET. Run npm run setup (local) or npm run ship (deployed) once to create it.");
  const raw = await crypto.subtle.digest("SHA-256", enc.encode("cd-settings-v1:" + env.SETTINGS_SECRET));
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}
async function seal(env: any, value: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aesKey(env), enc.encode(value));
  return `enc:v1:${hex(iv)}:${hex(ct)}`;
}
async function open(env: any, stored: string) {
  const [, , iv, ct] = stored.split(":");
  return dec.decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: unhex(iv) }, await aesKey(env), unhex(ct)));
}

async function readAll(env: any) {
  const { results } = await env.DB.prepare("SELECT key, value FROM settings WHERE key LIKE 'cfg:%'").all();
  const out: Record<string, string> = {};
  for (const r of results || []) out[String(r.key).slice(PREFIX.length)] = String(r.value);
  return out;
}

// The env every request handler sees: .env values, overridden by anything saved in Settings.
// A key that can't be decrypted (SETTINGS_SECRET changed) is skipped, so .env still applies.
export async function withSettings(env: any) {
  const saved = await readAll(env), merged: any = { ...env };
  for (const [k, v] of Object.entries(saved)) {
    if (SECRET_KEYS.includes(k)) { try { merged[k] = await open(env, v); } catch {} }
    else if (PLAIN_KEYS.includes(k)) merged[k] = v;
  }
  return merged;
}

export const setting = (env: any, k: keyof typeof DEFAULTS) => String(env[k] ?? DEFAULTS[k]);

// What the Settings page shows. env here is the merged env from withSettings.
export async function getSettings(env: any, rawEnv: any) {
  const saved = await readAll(env);
  const keys: Record<string, any> = {};
  for (const k of SECRET_KEYS) {
    let app = "", unreadable = false;
    if (k in saved) { try { app = await open(env, saved[k]); } catch { unreadable = true; } } // SETTINGS_SECRET changed since it was saved
    const value = app || String(rawEnv[k] || "");
    keys[k] = { set: !!value, source: app ? "app" : value ? "env" : null, hint: value.slice(-4), unreadable };
  }
  const models = listChallengers(env);
  // A chat model whose key was removed falls back to the free default (ask.ts does the same).
  const pick = setting(env, "CHAT_MODEL"), pickOk = pick === "default" || models.some((m) => m.id === pick && m.ready);
  return {
    can_save_keys: !!env.SETTINGS_SECRET,
    keys,
    models: Object.fromEntries(MODEL_KEYS.map((k) => [k, { value: saved[k] || "", env: rawEnv[k] || "" }])),
    model_defaults: { ANTHROPIC_MODEL: CHALLENGERS.claude.model, OPENAI_MODEL: CHALLENGERS.openai.model, OPENROUTER_MODEL: CHALLENGERS.openrouter.model },
    chat_models: [{ id: "default", label: "Llama 3.3 70B", provider: "Cloudflare Workers AI (free)", ready: true }]
      .concat(models.filter((m) => m.id !== "llama").map((m) => ({ id: m.id, label: m.label, provider: m.provider, ready: m.ready }))),
    CHAT_MODEL: pickOk ? pick : "default",
    chat_fallback: pickOk ? null : CHALLENGERS[pick]?.provider || pick,
    REVIEW_THRESHOLD: Number(setting(env, "REVIEW_THRESHOLD")),
    DRAFT_COUNT: Number(setting(env, "DRAFT_COUNT")),
  };
}

function check(k: string, v: string) {
  if (SECRET_KEYS.includes(k)) { if (!v || v.length > 400 || /\s/.test(v)) throw new Error("That key doesn't look right. Paste it without spaces."); return; }
  if (MODEL_KEYS.includes(k)) { if (v.length > 120 || !/^[\w.\-/:@]+$/.test(v)) throw new Error("Model ids use letters, numbers, and . - / : @ only."); return; }
  if (k === "CHAT_MODEL") { if (v !== "default" && !CHALLENGERS[v]) throw new Error("Unknown chat model."); return; }
  if (k === "REVIEW_THRESHOLD") { const n = Number(v); if (!(n >= 0.3 && n <= 0.95)) throw new Error("Threshold must be between 0.30 and 0.95."); return; }
  if (k === "DRAFT_COUNT") { const n = Number(v); if (!Number.isInteger(n) || n < 3 || n > 10) throw new Error("Draft count must be 3 to 10."); return; }
  throw new Error(`Unknown setting ${k}.`);
}

// body: { set: { NAME: value }, clear: [NAME] }. Clearing falls back to .env or the default.
export async function updateSettings(env: any, body: any) {
  const set = body?.set || {}, clear: string[] = Array.isArray(body?.clear) ? body.clear : [];
  for (const k of clear) if (![...SECRET_KEYS, ...PLAIN_KEYS].includes(k)) throw new Error(`Unknown setting ${k}.`);
  const rows: [string, string][] = [];
  for (const [k, raw] of Object.entries(set)) {
    const v = String(raw ?? "").trim();
    check(k, v);
    rows.push([k, SECRET_KEYS.includes(k) ? await seal(env, v) : v]);
  }
  for (const [k, v] of rows)
    await env.DB.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(PREFIX + k, v).run();
  for (const k of clear) await env.DB.prepare("DELETE FROM settings WHERE key = ?").bind(PREFIX + k).run();
}
