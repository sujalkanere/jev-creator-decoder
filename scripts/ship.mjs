// npm run ship: creates the tables in the cloud database, deploys the app,
// uploads your YouTube key, and prints a one-time link to create your password.
import { execSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";

const DB = "content-decoder";
if (!fs.existsSync(".dev.vars")) { console.error("Missing .dev.vars. Run npm run setup first."); process.exit(1); }
const vars = fs.readFileSync(".dev.vars", "utf8");
const key = (vars.match(/^YOUTUBE_API_KEY=(.+)$/m) || [])[1]?.trim();
if (!key || /paste-your/i.test(key)) { console.error("Add your YouTube API key with npm run setup first."); process.exit(1); }
// Optional: each is uploaded only if you've set it in .dev.vars. TYPESAFE_API_KEY makes TypeSafe's API
// the primary Jev backend; the rest add Model Race challengers.
const OPTIONAL = ["TYPESAFE_API_KEY", "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "OPENROUTER_API_KEY", "ANTHROPIC_MODEL", "OPENAI_MODEL", "OPENROUTER_MODEL"];
const optional = OPTIONAL.map((k) => [k, (vars.match(new RegExp(`^${k}=(.+)$`, "m")) || [])[1]?.trim()]).filter(([, v]) => v && !/paste-your/i.test(v));

console.log("\n1/3  Creating the tables in the cloud database (answer Y if asked)...");
execSync(`npx wrangler d1 migrations apply ${DB} --remote`, { stdio: "inherit" });

console.log("\n2/3  Deploying...");
const out = execSync("npx wrangler deploy", { encoding: "utf8", stdio: ["inherit", "pipe", "inherit"] });
process.stdout.write(out);
const url = (out.match(/https:\/\/[^\s]+\.workers\.dev/) || [])[0];

console.log("\n3/3  Uploading secrets...");
const token = crypto.randomBytes(16).toString("hex");
for (const [k, v] of [["YOUTUBE_API_KEY", key], ["SETUP_TOKEN", token], ...optional]) {
  execSync(`npx wrangler secret put ${k}`, { input: v + "\n", stdio: ["pipe", "inherit", "inherit"] });
}

console.log("\nDone.");
if (url) {
  console.log(`\nYour app:  ${url}`);
  console.log(`\nFirst time? Create your password with this one-time link (keep it private):\n${url}/?setup=${token}\n`);
} else {
  console.log(`\nOpen your workers.dev URL above. First time? Add ?setup=${token} to it to create your password.\n`);
}
