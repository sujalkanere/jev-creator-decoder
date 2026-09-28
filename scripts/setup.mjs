// npm run setup: creates the D1 database, writes its id into wrangler.toml,
// applies the migration locally, and creates .dev.vars if it is missing.
import { execSync } from "node:child_process";
import fs from "node:fs";

const DB = "content-decoder";
const run = (cmd, capture = false) =>
  execSync(cmd, { stdio: capture ? ["inherit", "pipe", "pipe"] : "inherit", encoding: "utf8" });

const major = Number(process.versions.node.split(".")[0]);
if (major < 20) { console.error(`Node 20 or newer is required. You have ${process.versions.node}.`); process.exit(1); }

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
  if (!id) {
    const list = JSON.parse(run("npx wrangler d1 list --json", true));
    id = (list.find((d) => d.name === DB) || {}).uuid || "";
  }
  if (!id) { console.error("Could not find the database id. Run: npx wrangler d1 list"); process.exit(1); }
  toml = toml.replace("REPLACE_WITH_YOUR_D1_DATABASE_ID", id);
  fs.writeFileSync("wrangler.toml", toml);
  console.log(`     Saved database id ${id} to wrangler.toml`);
} else {
  console.log("\n1/3  D1 database already set in wrangler.toml");
}

console.log("\n2/3  Creating the table locally...");
run(`npx wrangler d1 migrations apply ${DB} --local`);

console.log("\n3/3  Checking your secrets file...");
if (!fs.existsSync(".dev.vars")) {
  fs.copyFileSync(".dev.vars.example", ".dev.vars");
  console.log("     Created .dev.vars. Open it and add your YouTube API key and a passcode.");
} else {
  console.log("     .dev.vars already exists.");
}
console.log("\nSetup done. Next: fill in .dev.vars, then run  npm run dev\n");
