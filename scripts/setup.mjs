// npm run setup: creates the D1 database, writes its id into wrangler.toml,
// creates the table locally, and asks for your YouTube key and passcode.
import { execSync } from "node:child_process";
import fs from "node:fs";
import readline from "node:readline/promises";

const DB = "content-decoder";
const run = (cmd, capture = false) =>
  execSync(cmd, { stdio: capture ? ["inherit", "pipe", "pipe"] : "inherit", encoding: "utf8" });

if (Number(process.versions.node.split(".")[0]) < 20) { console.error(`Node 20 or newer is required. You have ${process.versions.node}.`); process.exit(1); }

let toml = fs.readFileSync("wrangler.toml", "utf8");
if (toml.includes("REPLACE_WITH_YOUR_D1_DATABASE_ID")) {
  console.log(`\n1/3  Creating the D1 database "${DB}"...`);
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
  fs.writeFileSync("wrangler.toml", toml.replace("REPLACE_WITH_YOUR_D1_DATABASE_ID", id));
  console.log(`     Saved database id ${id} to wrangler.toml`);
} else console.log("\n1/3  D1 database already set in wrangler.toml");

console.log("\n2/3  Creating the table locally (answer Y if asked)...");
run(`npx wrangler d1 migrations apply ${DB} --local`);

console.log("\n3/3  Your secrets");
const read = () => fs.existsSync(".dev.vars") ? Object.fromEntries(fs.readFileSync(".dev.vars", "utf8").split("\n").filter((l) => l.includes("=") && !l.trim().startsWith("#")).map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()])) : {};
const vars = read();
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
if (!vars.YOUTUBE_API_KEY || /paste-your/i.test(vars.YOUTUBE_API_KEY)) vars.YOUTUBE_API_KEY = (await rl.question("     Paste your YouTube Data API key: ")).trim();
if (!vars.DASHBOARD_PASSCODE || /choose-a/i.test(vars.DASHBOARD_PASSCODE)) vars.DASHBOARD_PASSCODE = (await rl.question("     Choose a dashboard passcode: ")).trim();
rl.close();
fs.writeFileSync(".dev.vars", `YOUTUBE_API_KEY=${vars.YOUTUBE_API_KEY}\nDASHBOARD_PASSCODE=${vars.DASHBOARD_PASSCODE}\n`);
console.log("     Saved to .dev.vars (never commit this file).");
console.log("\nSetup done. Next: npm run dev\n");
