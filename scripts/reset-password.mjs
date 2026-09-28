// npm run reset-password: removes the dashboard password so you can create a new one.
import { execSync } from "node:child_process";
import readline from "node:readline/promises";

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const where = (await rl.question("Reset the password for your local app or your deployed app? (local/deployed): ")).trim().toLowerCase();
rl.close();
const flag = where.startsWith("d") ? "--remote" : "--local";
execSync(`npx wrangler d1 execute content-decoder ${flag} --command "DELETE FROM settings; DELETE FROM sessions;"`, { stdio: "inherit" });
console.log(flag === "--local"
  ? "\nDone. Open http://localhost:8787 and create a new password."
  : "\nDone. Run npm run ship to get a new one-time setup link, then create a new password.");
