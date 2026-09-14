import { randomBytes } from "node:crypto";
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const envPath = resolve(root, ".env");
const examplePath = resolve(root, ".env.example");

function run(command, commandArgs, label) {
  console.log(`\n→ ${label}`);
  if (dryRun) return;
  const result = spawnSync(command, commandArgs, { cwd: root, stdio: "inherit", env: process.env });
  if (result.error?.code === "ENOENT") throw new Error(`${command} is not installed or not on PATH`);
  if (result.status !== 0) throw new Error(`${label} failed`);
}

function setBlankValue(content, key, value) {
  const expression = new RegExp(`^${key}=[ \\t]*$`, "m");
  if (expression.test(content)) return content.replace(expression, `${key}=${value}`);
  if (!new RegExp(`^${key}=`, "m").test(content)) return `${content.trimEnd()}\n${key}=${value}\n`;
  return content;
}

function envValues(content) {
  return Object.fromEntries(content.split(/\r?\n/).flatMap((line) => {
    const match = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
    if (!match) return [];
    return [[match[1], match[2].trim().replace(/^(['"])(.*)\1$/, "$2")]];
  }));
}

try {
  const createdEnv = !existsSync(envPath);
  if (createdEnv) {
    if (!existsSync(examplePath)) throw new Error(".env.example is missing");
    console.log("→ Create .env from .env.example");
    if (!dryRun) copyFileSync(examplePath, envPath);
  } else console.log("✓ Keep existing .env");

  let content = existsSync(envPath) ? readFileSync(envPath, "utf8") : readFileSync(examplePath, "utf8");
  for (const key of ["BETTER_AUTH_SECRET", "APP_SECRET", "CRON_SECRET", "HEALTHCHECK_SECRET"]) content = setBlankValue(content, key, randomBytes(32).toString("base64url"));
  if (!dryRun) {
    writeFileSync(envPath, content, { mode: 0o600 });
    chmodSync(envPath, 0o600);
  }
  console.log("✓ Generated missing local secrets (existing values preserved)");

  const values = envValues(content);
  const storagePath = resolve(root, values.FILE_STORAGE_PATH || ".data/files");
  console.log(`→ Prepare local file storage at ${values.FILE_STORAGE_PATH || ".data/files"}`);
  if (!dryRun) mkdirSync(storagePath, { recursive: true, mode: 0o700 });

  if (!existsSync(resolve(root, "node_modules")) && !args.has("--no-install")) run("pnpm", ["install", "--frozen-lockfile"], "Install dependencies");
  else console.log("✓ Dependencies already installed (or --no-install selected)");

  const localDatabase = /(?:localhost|127\.0\.0\.1):5432/.test(values.DATABASE_URL || "");
  if (localDatabase && !args.has("--no-docker")) run("docker", ["compose", "up", "-d", "postgres"], "Start PostgreSQL");
  else console.log(localDatabase ? "! PostgreSQL start skipped (--no-docker)" : "✓ External PostgreSQL configuration retained");

  if (!args.has("--no-migrate")) run("pnpm", ["db:migrate"], "Apply database migrations");
  else console.log("! Database migration skipped (--no-migrate)");

  console.log("\nSetup complete. Run `pnpm run doctor` for diagnostics, then `pnpm dev`.");
  if (!(values.OPENAI_API_KEY || values.OPENROUTER_API_KEY)) console.log("Next: add OPENAI_API_KEY or OPENROUTER_API_KEY to .env before using AI features.");
  if (createdEnv) console.log("Review AUTH_MODE in .env: use disabled only for a private local installation.");
} catch (error) {
  console.error(`\nSetup stopped: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
