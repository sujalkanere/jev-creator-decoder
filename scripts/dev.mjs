// npm run dev: one command for local work. Applies new database migrations, starts the transcript
// helper (scripts/helper.mjs), then runs wrangler dev. Ctrl+C stops both.
// Extra arguments go to wrangler, e.g. npm run dev -- --port 8788.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { startHelper, HELPER_PORT } from "./helper.mjs";

if (Number(process.versions.node.split(".")[0]) < 22) { console.error(`Node 22 or newer is required. You have ${process.versions.node}.`); process.exit(1); }

// Run wrangler through Node itself (no npx, no shell), so this works the same on macOS, Windows, and Linux.
// wrangler only exports its package.json, so find the CLI through its "bin" entry.
const pkg = createRequire(import.meta.url).resolve("wrangler/package.json");
const wrangler = path.join(path.dirname(pkg), JSON.parse(fs.readFileSync(pkg, "utf8")).bin.wrangler);
const args = process.argv.slice(2);
const pi = args.indexOf("--port"), port = pi >= 0 ? args[pi + 1] : "8787";

// New tables (like transcripts) reach your local database without re-running setup. CI=1 skips the Y/n prompt.
const di = args.indexOf("--persist-to"), persist = di >= 0 ? ["--persist-to", args[di + 1]] : [];
const mig = spawnSync(process.execPath, [wrangler, "d1", "migrations", "apply", "content-decoder", "--local", ...persist], { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, CI: "1" }, encoding: "utf8" });
if (mig.status !== 0) console.warn("Couldn't apply local database migrations:\n" + (mig.stderr || mig.stdout).trim().split("\n").slice(-3).join("\n"));

const helper = startHelper({ origins: [`http://localhost:${port}`, `http://127.0.0.1:${port}`] });
helper.on("listening", () => console.log(`Transcript helper on http://127.0.0.1:${HELPER_PORT} (downloads Shorts audio for the hook strategy check)`));
helper.on("error", (e) => console.warn(`Transcript helper didn't start (${e.code || e.message}). The dashboard still works; Shorts show "No transcript".`));

const child = spawn(process.execPath, [wrangler, "dev", ...args], { stdio: "inherit" });
child.on("exit", (code) => { helper.close(); process.exit(code ?? 0); });
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { child.kill(sig); });
