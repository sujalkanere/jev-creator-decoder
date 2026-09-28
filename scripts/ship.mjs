// npm run ship: creates the table in the cloud database, uploads your two secrets
// from .dev.vars, and deploys the Worker.
import { execSync } from "node:child_process";
import fs from "node:fs";

const DB = "content-decoder";
if (!fs.existsSync(".dev.vars")) { console.error("Missing .dev.vars. Run npm run setup first."); process.exit(1); }
const vars = Object.fromEntries(
  fs.readFileSync(".dev.vars", "utf8").split("\n")
    .map((l) => l.trim()).filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()])
);
for (const k of ["YOUTUBE_API_KEY", "DASHBOARD_PASSCODE"]) {
  if (!vars[k] || /paste-your|choose-a/.test(vars[k])) { console.error(`Set ${k} in .dev.vars first.`); process.exit(1); }
}

console.log("\n1/3  Creating the table in the cloud database...");
execSync(`npx wrangler d1 migrations apply ${DB} --remote`, { stdio: "inherit" });

console.log("\n2/3  Deploying...");
execSync("npx wrangler deploy", { stdio: "inherit" });

// Secrets go on after the first deploy, so the Worker already exists.
console.log("\n3/3  Uploading secrets...");
for (const k of ["YOUTUBE_API_KEY", "DASHBOARD_PASSCODE"]) {
  execSync(`npx wrangler secret put ${k}`, { input: vars[k] + "\n", stdio: ["pipe", "inherit", "inherit"] });
}
console.log("\nDone. Open the workers.dev URL above and enter your passcode.\n");
