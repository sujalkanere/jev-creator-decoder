// Password auth for the dashboard.
// The password is never stored: only a salted PBKDF2 hash lives in D1.
// Sign-in creates a random session token. The browser keeps it in an HttpOnly cookie,
// and D1 keeps only a SHA-256 hash of it.

const ITER = 100_000;           // PBKDF2 iterations (the Workers maximum)
const MAX_FAILS = 10;           // wrong attempts before a lockout
const LOCK_MS = 15 * 60_000;    // 15 minute lockout
const LONG = 30 * 86_400_000;   // "Keep me signed in": 30 days
const SHORT = 12 * 3_600_000;   // otherwise: 12 hours
const COOKIE = "cd_session";

const enc = new TextEncoder();
const hex = (b: ArrayBuffer | Uint8Array) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
const randHex = (n: number) => hex(crypto.getRandomValues(new Uint8Array(n)));
const sha256 = async (s: string) => hex(await crypto.subtle.digest("SHA-256", enc.encode(s)));

async function pbkdf2(password: string, saltHex: string) {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const salt = new Uint8Array(saltHex.match(/../g)!.map((h) => parseInt(h, 16)));
  return hex(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: ITER }, key, 256));
}

function sameHex(a: string, b: string) { // constant-time compare
  if (a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

async function getSetting(env: any, key: string) {
  const r = await env.DB.prepare("SELECT value FROM settings WHERE key = ?").bind(key).first();
  return r ? String(r.value) : null;
}
async function setSetting(env: any, key: string, value: string) {
  await env.DB.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(key, value).run();
}

export function isLocal(req: Request) {
  const h = new URL(req.url).hostname;
  return h === "localhost" || h === "127.0.0.1" || h === "[::1]";
}

function cookieFor(req: Request, token: string, maxAgeMs: number | null) {
  const secure = new URL(req.url).protocol === "https:" ? "; Secure" : "";
  const age = maxAgeMs === null ? "" : `; Max-Age=${Math.floor(maxAgeMs / 1000)}`;
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict${secure}${age}`;
}
function readCookie(req: Request) {
  const m = (req.headers.get("cookie") || "").match(new RegExp(`(?:^|;\\s*)${COOKIE}=([a-f0-9]{64})`));
  return m ? m[1] : null;
}

export async function isSignedIn(env: any, req: Request) {
  const t = readCookie(req);
  if (!t) return false;
  const row = await env.DB.prepare("SELECT expires_at FROM sessions WHERE token_hash = ?").bind(await sha256(t)).first();
  return !!row && Number(row.expires_at) > Date.now();
}

async function newSession(env: any, req: Request, remember: boolean) {
  const token = randHex(32), ttl = remember ? LONG : SHORT;
  await env.DB.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(Date.now()).run();
  await env.DB.prepare("INSERT INTO sessions (token_hash, expires_at) VALUES (?, ?)").bind(await sha256(token), Date.now() + ttl).run();
  return cookieFor(req, token, remember ? ttl : null);
}

function setupOk(env: any, req: Request, setup?: string) {
  if (isLocal(req)) return true; // nobody else can reach your own machine
  return !!env.SETUP_TOKEN && !!setup && sameHex(String(setup), String(env.SETUP_TOKEN));
}

const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", ...headers } });

export async function handleAuth(env: any, req: Request, path: string, body: any) {
  const configured = !!(await getSetting(env, "pw_hash"));

  if (path === "/api/auth/status") {
    const setup = new URL(req.url).searchParams.get("setup") || "";
    return json({ configured, signedIn: configured && (await isSignedIn(env, req)), canCreate: !configured && setupOk(env, req, setup) });
  }

  if (path === "/api/auth/create") {
    if (configured) return json({ error: "A password is already set. Sign in instead." }, 409);
    if (!setupOk(env, req, body.setup)) return json({ error: "Open the setup link from npm run ship to create your password." }, 403);
    const pw = String(body.password || "");
    if (pw.length < 8) return json({ error: "Use at least 8 characters." }, 400);
    const salt = randHex(16);
    await setSetting(env, "pw_salt", salt);
    await setSetting(env, "pw_hash", await pbkdf2(pw, salt));
    return json({ ok: true }, 200, { "set-cookie": await newSession(env, req, true) });
  }

  if (path === "/api/auth/login") {
    if (!configured) return json({ error: "No password yet. Create one first." }, 409);
    const lockUntil = Number((await getSetting(env, "lock_until")) || 0);
    if (lockUntil > Date.now()) return json({ error: `Too many attempts. Try again in ${Math.ceil((lockUntil - Date.now()) / 60000)} minutes.` }, 429);
    const salt = (await getSetting(env, "pw_salt"))!, want = (await getSetting(env, "pw_hash"))!;
    if (!sameHex(await pbkdf2(String(body.password || ""), salt), want)) {
      const fails = Number((await getSetting(env, "fail_count")) || 0) + 1;
      if (fails >= MAX_FAILS) { await setSetting(env, "lock_until", String(Date.now() + LOCK_MS)); await setSetting(env, "fail_count", "0"); return json({ error: "Too many attempts. Try again in 15 minutes." }, 429); }
      await setSetting(env, "fail_count", String(fails));
      return json({ error: "That password isn't right." }, 401);
    }
    await setSetting(env, "fail_count", "0");
    return json({ ok: true }, 200, { "set-cookie": await newSession(env, req, !!body.remember) });
  }

  // From Settings: needs a signed-in session and the current password. Signs out every other
  // device by dropping all sessions, then starts a fresh one here.
  if (path === "/api/auth/change") {
    if (!configured || !(await isSignedIn(env, req))) return json({ error: "Please sign in." }, 401);
    const lockUntil = Number((await getSetting(env, "lock_until")) || 0);
    if (lockUntil > Date.now()) return json({ error: `Too many attempts. Try again in ${Math.ceil((lockUntil - Date.now()) / 60000)} minutes.` }, 429);
    const salt = (await getSetting(env, "pw_salt"))!, want = (await getSetting(env, "pw_hash"))!;
    if (!sameHex(await pbkdf2(String(body.current || ""), salt), want)) {
      const fails = Number((await getSetting(env, "fail_count")) || 0) + 1;
      if (fails >= MAX_FAILS) { await setSetting(env, "lock_until", String(Date.now() + LOCK_MS)); await setSetting(env, "fail_count", "0"); return json({ error: "Too many attempts. Try again in 15 minutes." }, 429); }
      await setSetting(env, "fail_count", String(fails));
      return json({ error: "Your current password isn't right." }, 401);
    }
    const pw = String(body.password || "");
    if (pw.length < 8) return json({ error: "Use at least 8 characters." }, 400);
    const fresh = randHex(16);
    await setSetting(env, "pw_salt", fresh);
    await setSetting(env, "pw_hash", await pbkdf2(pw, fresh));
    await setSetting(env, "fail_count", "0");
    await env.DB.prepare("DELETE FROM sessions").run();
    return json({ ok: true }, 200, { "set-cookie": await newSession(env, req, true) });
  }

  if (path === "/api/auth/logout") {
    const t = readCookie(req);
    if (t) await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256(t)).run();
    return json({ ok: true }, 200, { "set-cookie": cookieFor(req, "", 0) });
  }

  return json({ error: "Not found" }, 404);
}
