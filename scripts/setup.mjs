// npm run setup: logs you in, creates the D1 database and writes its id into wrangler.toml,
// makes sure your account has a workers.dev subdomain, creates the table locally,
// and asks for your YouTube and TypeSafe keys.
import { execSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import readline from "node:readline/promises";

const DB = "content-decoder";
const run = (cmd, capture = false) =>
  execSync(cmd, { stdio: capture ? ["inherit", "pipe", "pipe"] : "inherit", encoding: "utf8" });
const ask = async (q) => { const rl = readline.createInterface({ input: process.stdin, output: process.stdout }); try { return (await rl.question(q)).trim(); } finally { rl.close(); } };

// Wrangler needs Node 22 or newer.
if (Number(process.versions.node.split(".")[0]) < 22) { console.error(`Node 22 or newer is required. You have ${process.versions.node}.`); process.exit(1); }

// Your keys live in .env. Older copies of this project used .dev.vars, and wrangler ignores .env
// while a .dev.vars exists, so move any keys over and rename the old file out of the way.
if (fs.existsSync(".dev.vars")) {
  const env = fs.existsSync(".env") ? fs.readFileSync(".env", "utf8") : "";
  const has = (k) => new RegExp(`^${k}=`, "m").test(env);
  const moved = fs.readFileSync(".dev.vars", "utf8").split("\n").filter((l) => /^[A-Z0-9_]+=/.test(l) && !has(l.slice(0, l.indexOf("="))));
  fs.writeFileSync(".env", (env && !env.endsWith("\n") ? env + "\n" : env) + moved.map((l) => l + "\n").join(""));
  fs.renameSync(".dev.vars", ".dev.vars.bak");
  console.log("\nMoved your keys from .dev.vars to .env (the old file is now .dev.vars.bak).");
}

// Every later step talks to your Cloudflare account, so log in first.
const whoami = () => { try { return JSON.parse(run("npx wrangler whoami --json", true)); } catch { return null; } };
let me = whoami();
if (!me?.loggedIn) { console.log("\nLogging in to Cloudflare (a browser window opens)..."); run("npx wrangler login"); me = whoami(); }
if (!me?.loggedIn) { console.error("Not logged in. Run npx wrangler login, then npm run setup again."); process.exit(1); }

// Pick the account once and pass it to every wrangler command, so none of them stop to ask.
let account = me.accounts.find((a) => a.id === process.env.CLOUDFLARE_ACCOUNT_ID) || (me.accounts.length === 1 ? me.accounts[0] : null);
while (!account) {
  me.accounts.forEach((a, i) => console.log(`     ${i + 1}. ${a.name}`));
  account = me.accounts[Number(await ask("     Which Cloudflare account? Type its number: ")) - 1];
}
process.env.CLOUDFLARE_ACCOUNT_ID = account.id;

let toml = fs.readFileSync("wrangler.toml", "utf8");
const currentId = (toml.match(/^database_id\s*=\s*"([^"]+)"/m) || [])[1] || "";
// A database_id copied from someone else's project is not in your account, so treat it as unset.
const ownsDb = () => { try { return JSON.parse(run("npx wrangler d1 list --json", true)).some((d) => d.uuid === currentId); } catch { return false; } };
if (currentId === "REPLACE_WITH_YOUR_D1_DATABASE_ID" || !ownsDb()) {
  console.log(`\n1/5  Creating the D1 database "${DB}"...`);
  let id = "";
  try {
    const out = run(`npx wrangler d1 create ${DB}`, true);
    id = (out.match(/database_id\s*=\s*"([^"]+)"/) || out.match(/"database_id":\s*"([^"]+)"/) || [])[1] || "";
  } catch (e) {
    const msg = String(e.stdout || "") + String(e.stderr || "");
    if (!/already exists/i.test(msg)) { console.error(msg || e.message); process.exit(1); }
  }
  if (!id) { const list = JSON.parse(run("npx wrangler d1 list --json", true)); id = (list.find((d) => d.name === DB) || {}).uuid || ""; }
  if (!id) { console.error("Could not find the database id. Run: npx wrangler d1 list"); process.exit(1); }
  fs.writeFileSync("wrangler.toml", toml.replace(/^database_id\s*=\s*"[^"]*"/m, `database_id = "${id}"`));
  console.log(`     Saved database id ${id} to wrangler.toml`);
} else console.log("\n1/5  D1 database already set in wrangler.toml");

// Workers AI has no local version, so npm run dev reaches it through a temporary Worker that
// wrangler runs on your workers.dev subdomain. New accounts don't have one until it's registered,
// and npm run ship deploys to it too. Register it here so npm run dev never stops to ask.
console.log("\n2/5  Your workers.dev subdomain");
const cfApi = async (method, body) => {
  const { token } = JSON.parse(run("npx wrangler auth token --json", true));
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account.id}/workers/subdomain`, {
    method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: body && JSON.stringify(body),
  });
  return await res.json().catch(() => ({ success: false, errors: [{ message: `HTTP ${res.status}` }] }));
};
const existing = await cfApi("GET");
if (existing.success && existing.result?.subdomain) console.log(`     Already set: ${existing.result.subdomain}.workers.dev`);
else {
  const suggested = (me.email || account.name || "jev").split("@")[0].toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "jev";
  let done = false;
  for (let i = 0; i < 5 && !done; i++) {
    const name = (await ask(`     Pick a subdomain (press Enter for ${suggested}): `)).toLowerCase() || suggested;
    const res = await cfApi("PUT", { subdomain: name });
    if (res.success) { console.log(`     Registered ${name}.workers.dev`); done = true; }
    else console.log(`     Couldn't use "${name}": ${res.errors?.[0]?.message || "unknown error"}. Try another.`);
  }
  if (!done) { console.error("\nNo subdomain registered. Run npm run setup again."); process.exit(1); }
}

console.log("\n3/5  Creating the table locally (answer Y if asked)...");
run(`npx wrangler d1 migrations apply ${DB} --local`);

// Asks for a key unless .env already has a real one. Only that key's line changes,
// so other keys and comments in .env survive a re-run.
async function saveKey(name, prompt) {
  const old = fs.existsSync(".env") ? fs.readFileSync(".env", "utf8") : "";
  const current = (old.match(new RegExp(`^${name}=(.*)$`, "m")) || [])[1]?.trim();
  if (current && !/paste-your/i.test(current)) { console.log("     Already saved in .env."); return; }
  let v = "";
  for (let i = 0; i < 5 && !v; i++) {
    v = await ask(`     ${prompt}: `);
    if (!v || /paste-your/i.test(v)) { v = ""; console.log("     That can't be empty. Try again."); }
  }
  if (!v) { console.error("\nNo key entered. Run npm run setup again."); process.exit(1); }
  const line = `${name}=${v}`;
  const re = new RegExp(`^${name}=.*$`, "m");
  fs.writeFileSync(".env", re.test(old) ? old.replace(re, () => line) : line + "\n" + old);
}

console.log("\n4/5  Your YouTube API key");
await saveKey("YOUTUBE_API_KEY", "Paste your YouTube Data API key");

// Jev on Workers AI is paid from AI Gateway credits, which a new Cloudflare account doesn't have,
// so the app calls Jev on TypeSafe's own API with this key. Workers AI is only the fallback.
console.log("\n5/5  Your TypeSafe API key (from your TypeSafe dashboard, after adding credit)");
await saveKey("TYPESAFE_API_KEY", "Paste your TypeSafe API key");

// Encrypts API keys saved from the dashboard's Settings page. Made once and kept: changing it
// makes keys already saved in Settings unreadable (the app then falls back to .env).
const cur = fs.readFileSync(".env", "utf8");
if (!/^SETTINGS_SECRET=\S+/m.test(cur)) {
  fs.writeFileSync(".env", (cur && !cur.endsWith("\n") ? cur + "\n" : cur) + `SETTINGS_SECRET=${crypto.randomBytes(32).toString("hex")}\n`);
  console.log("\nCreated SETTINGS_SECRET in .env (encrypts keys you save in Settings).");
}

console.log("\nSetup done. Next: npm run dev, then create your dashboard password in the browser.\n");
