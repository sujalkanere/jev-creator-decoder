// Transcript helper for the hook strategy check. Runs on your machine next to npm run dev
// (npm run dev starts it for you). The Worker can't run programs, so this small local server
// runs yt-dlp (through uvx) to download a Short's audio and hands the bytes to the dashboard,
// which sends them to Workers AI Whisper. Jev makes every judgment; this only fetches audio.
//
// - Listens on 127.0.0.1 only, and only answers the dashboard's own origin. /audio also needs an
//   x-jev-helper header, which a page can only send after a CORS preflight this server refuses for
//   other sites, so a stray <img> or <audio> tag elsewhere can't start downloads.
// - One download at a time, 3 s apart, with one retry after 30 s on HTTP 403 or 429.
// - Success means the audio file arrived, not yt-dlp's exit code.
// - Each file is read into memory and deleted before the reply is sent, so no audio stays on disk.
import { execFile } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const HELPER_PORT = Number(process.env.HELPER_PORT || 8790);
const GAP_MS = 3000, RETRY_MS = 30000, TIMEOUT_MS = 120000;
const DIR = path.join(os.tmpdir(), "jev-decoder-audio");
const TYPES = { m4a: "audio/mp4", mp4: "audio/mp4", webm: "audio/webm", opus: "audio/ogg", mp3: "audio/mpeg" };

// yt-dlp solves YouTube's JavaScript challenges with Node (--js-runtimes node), so make sure the Node
// running this script is the one it finds, whatever the shell's PATH says.
const ENV = { ...process.env, PATH: path.dirname(process.execPath) + path.delimiter + (process.env.PATH || "") };
const run = (args, timeout = TIMEOUT_MS) => new Promise((resolve) => {
  const t0 = Date.now();
  execFile("uvx", args, { env: ENV, timeout, maxBuffer: 8 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) =>
    resolve({ ok: !err, code: err?.code, stdout: String(stdout || ""), stderr: String(stderr || ""), ms: Date.now() - t0 }));
});

function clearDir() {
  fs.mkdirSync(DIR, { recursive: true });
  for (const f of fs.readdirSync(DIR)) fs.rmSync(path.join(DIR, f), { force: true });
}
const filesFor = (id) => fs.readdirSync(DIR).filter((f) => f.startsWith(id + "."));
const removeFor = (id) => filesFor(id).forEach((f) => fs.rmSync(path.join(DIR, f), { force: true }));

let status = { uv: null, ytdlp: "", error: "" };
async function warmUp() {
  const uv = await run(["--version"], 20000);
  if (!uv.ok) { status = { uv: false, ytdlp: "", error: "uv isn't installed or isn't on your PATH." }; return; }
  // The first run downloads yt-dlp into uv's cache, so do it now instead of on the first Short.
  const y = await run(["yt-dlp", "--version"], 180000);
  status = y.ok ? { uv: true, ytdlp: y.stdout.trim(), error: "" } : { uv: true, ytdlp: "", error: "uvx couldn't start yt-dlp: " + (y.stderr.trim().split("\n").pop() || "unknown error") };
}

async function download(id) {
  const args = ["yt-dlp", "--js-runtimes", "node", "-f", "bestaudio[ext=m4a]/bestaudio", "--no-playlist", "--no-warnings", "--no-progress",
    "-o", path.join(DIR, "%(id)s.%(ext)s"), `https://www.youtube.com/shorts/${id}`];
  const found = () => filesFor(id).find((f) => !/\.(part|ytdl|temp)$/.test(f));
  let r = await run(args), attempts = 1, file = found();
  if (!file && /HTTP Error (403|429)/.test(r.stderr)) {
    removeFor(id);
    await new Promise((res) => setTimeout(res, RETRY_MS));
    r = await run(args); attempts = 2; file = found();
  }
  if (!file) {
    removeFor(id);
    const err = (r.stderr.match(/ERROR:[^\n]*/) || [r.stderr.trim().split("\n").pop() || "yt-dlp failed"])[0];
    return { ok: false, attempts, rateLimited: /HTTP Error (403|429)/.test(r.stderr), error: err.slice(0, 300) };
  }
  const bytes = fs.readFileSync(path.join(DIR, file));
  removeFor(id); // delete before replying: only the browser's copy in memory remains
  return { ok: true, attempts, bytes, ext: path.extname(file).slice(1), ms: r.ms };
}

// One download at a time, GAP_MS between them.
let chain = Promise.resolve(), waiting = 0;
function queued(id) {
  waiting++;
  const job = chain.then(() => download(id));
  chain = job.then(() => new Promise((res) => setTimeout(res, GAP_MS)), () => new Promise((res) => setTimeout(res, GAP_MS)));
  return job.finally(() => { waiting--; });
}

export function startHelper({ port = HELPER_PORT, origins = [] } = {}) {
  clearDir();
  warmUp();
  const allowed = new Set(origins.length ? origins : (process.env.HELPER_ORIGINS || "http://localhost:8787,http://127.0.0.1:8787").split(","));
  const server = http.createServer(async (req, res) => {
    const origin = req.headers.origin;
    // Browsers always send Origin on cross-origin requests: refuse every site except the dashboard.
    if (origin && !allowed.has(origin)) { res.writeHead(403).end(); return; }
    const cors = origin ? { "access-control-allow-origin": origin, "access-control-expose-headers": "x-attempts, x-download-ms", vary: "origin" } : {};
    const send = (code, body, headers = {}) => { res.writeHead(code, { ...cors, ...headers }); res.end(body); };
    const json = (code, data) => send(code, JSON.stringify(data), { "content-type": "application/json" });
    const url = new URL(req.url, "http://127.0.0.1");
    if (req.method === "OPTIONS") { send(204, "", { "access-control-allow-methods": "GET", "access-control-allow-headers": "x-jev-helper", "access-control-max-age": "600" }); return; }
    if (req.method !== "GET") { json(405, { error: "GET only" }); return; }
    if (url.pathname === "/health") { json(200, { ok: true, ...status, waiting }); return; }
    if (url.pathname === "/audio") {
      if (req.headers["x-jev-helper"] !== "1") { json(403, { error: "Missing x-jev-helper header" }); return; }
      const id = String(url.searchParams.get("id") || "");
      if (!/^[\w-]{11}$/.test(id)) { json(400, { error: "Not a YouTube video id" }); return; }
      if (status.uv === false || (status.uv && !status.ytdlp && status.error)) { json(503, { error: status.error }); return; }
      try {
        const r = await queued(id);
        if (!r.ok) { json(r.rateLimited ? 429 : 502, { error: r.error, rate_limited: r.rateLimited, attempts: r.attempts }); return; }
        send(200, r.bytes, { "content-type": TYPES[r.ext] || "application/octet-stream", "x-attempts": String(r.attempts), "x-download-ms": String(r.ms) });
      } catch (e) { removeFor(id); json(500, { error: String(e?.message || e) }); }
      return;
    }
    json(404, { error: "Not found" });
  });
  server.listen(port, "127.0.0.1");
  const bye = () => { try { clearDir(); } catch {} };
  process.on("exit", bye);
  return server;
}

// npm run helper starts it on its own (npm run dev already does).
if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  const s = startHelper();
  s.on("listening", () => console.log(`Transcript helper on http://127.0.0.1:${HELPER_PORT}`));
  s.on("error", (e) => { console.error(`Transcript helper couldn't start: ${e.message}`); process.exit(1); });
  for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => process.exit(0));
}
