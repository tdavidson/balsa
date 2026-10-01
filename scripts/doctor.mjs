import { accessSync, constants, existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const results = [];
const pass = (name, detail) => results.push({ level: "pass", name, detail });
const warn = (name, detail) => results.push({ level: "warn", name, detail });
const fail = (name, detail) => results.push({ level: "fail", name, detail });

function parseEnv(path) {
  if (!existsSync(path)) return {};
  return Object.fromEntries(readFileSync(path, "utf8").split(/\r?\n/).flatMap((line) => {
    const match = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
    if (!match) return [];
    return [[match[1], match[2].trim().replace(/^(['"])(.*)\1$/, "$2")]];
  }));
}

function writableTarget(path) {
  let candidate = path;
  while (!existsSync(candidate) && dirname(candidate) !== candidate) candidate = dirname(candidate);
  accessSync(candidate, constants.W_OK);
}

const fileEnv = { ...parseEnv(resolve(root, ".env")), ...parseEnv(resolve(root, ".env.local")) };
const env = { ...fileEnv, ...process.env };
const nodeMajor = Number(process.versions.node.split(".")[0]);
nodeMajor >= 22 ? pass("Node.js", process.versions.node) : fail("Node.js", `22+ required; found ${process.versions.node}`);

const pnpm = spawnSync("pnpm", ["--version"], { encoding: "utf8" });
const pnpmVersion = pnpm.stdout?.trim() || "";
pnpm.status === 0 && Number(pnpmVersion.split(".")[0]) >= 10
  ? pass("pnpm", pnpmVersion)
  : fail("pnpm", `pnpm 10+ is required${pnpmVersion ? `; found ${pnpmVersion}` : ""}`);
existsSync(resolve(root, "node_modules")) ? pass("Dependencies", "installed") : fail("Dependencies", "run pnpm install --frozen-lockfile");
existsSync(resolve(root, ".env")) || existsSync(resolve(root, ".env.local")) ? pass("Configuration", "local environment file found") : fail("Configuration", "run pnpm run setup or copy .env.example to .env");

env.DATABASE_URL ? pass("Database URL", "configured") : fail("Database URL", "set DATABASE_URL");
const provider = (env.MODEL_PROVIDER || "openai").toLowerCase();
if (provider === "openai") env.OPENAI_API_KEY ? pass("Model provider", "OpenAI configured") : fail("Model provider", "set OPENAI_API_KEY");
else if (provider === "openrouter") env.OPENROUTER_API_KEY ? pass("Model provider", "OpenRouter configured") : fail("Model provider", "set OPENROUTER_API_KEY");
else fail("Model provider", `unsupported MODEL_PROVIDER=${provider}`);
env.MODEL_NAME ? pass("Model", env.MODEL_NAME) : fail("Model", "set MODEL_NAME");

const authMode = (env.AUTH_MODE || "better-auth").toLowerCase();
if (authMode === "better-auth") {
  (env.BETTER_AUTH_SECRET || "").length >= 32 ? pass("Authentication", "Better Auth configured") : fail("Authentication", "BETTER_AUTH_SECRET must be at least 32 characters");
  env.BETTER_AUTH_URL ? pass("Auth URL", env.BETTER_AUTH_URL) : fail("Auth URL", "set BETTER_AUTH_URL");
  if (env.AUTH_ALLOW_SIGN_UP === "true" && !env.AUTH_SIGN_UP_CODE) warn("Sign-up gate", "AUTH_ALLOW_SIGN_UP is enabled without AUTH_SIGN_UP_CODE");
} else if (authMode === "disabled") {
  pass("Authentication", "disabled for private local use");
  warn("Network boundary", "disabled auth provides no network protection");
} else fail("Authentication", "AUTH_MODE must be better-auth or disabled");

if ((env.FILE_STORAGE || "local") === "local") {
  try { writableTarget(resolve(root, env.FILE_STORAGE_PATH || ".data/files")); pass("File storage", `${env.FILE_STORAGE_PATH || ".data/files"} is writable`); }
  catch { fail("File storage", `${env.FILE_STORAGE_PATH || ".data/files"} is not writable`); }
} else fail("File storage", `FILE_STORAGE=${env.FILE_STORAGE} is not implemented`);

for (const key of ["APP_SECRET", "CRON_SECRET", "HEALTHCHECK_SECRET"]) env[key] ? pass(key, "configured") : warn(key, "not configured");

if (env.TELLER_APPLICATION_ID) {
  const environment = env.TELLER_ENVIRONMENT || "sandbox";
  if (!["sandbox", "development", "production"].includes(environment)) fail("Teller environment", "use sandbox, development, or production");
  const required = ["TELLER_TOKEN_SIGNING_PUBLIC_KEY", "TELLER_TOKEN_ENCRYPTION_KEY", ...(environment === "sandbox" ? [] : ["TELLER_CERTIFICATE", "TELLER_PRIVATE_KEY"])];
  const missing = required.filter((key) => !env[key]);
  if (missing.length) fail("Teller", `set ${missing.join(", ")}; see .env.example and docs/teller.md`);
  else if (Buffer.from(env.TELLER_TOKEN_ENCRYPTION_KEY, "base64").length !== 32) fail("Teller encryption", "TELLER_TOKEN_ENCRYPTION_KEY must encode 32 random bytes");
  else pass("Teller", `${environment} configuration present; provider connectivity is not checked`);
  if (!env.CRON_SECRET) warn("Teller automatic sync", "set CRON_SECRET and configure the scheduled job in docs/teller.md");
} else pass("Teller", "optional bank sync is disabled");

if (env.DATABASE_URL && existsSync(resolve(root, "node_modules"))) {
  const database = spawnSync("pnpm", ["--filter", "@finance/database", "db:doctor"], { cwd: root, encoding: "utf8", env });
  if (database.status === 0) pass("Database", database.stdout.trim().split("\n").at(-1) || "connected and current");
  else fail("Database", (database.stderr || database.stdout || "connection or migration check failed").trim().split("\n").at(-1));
}

const json = process.argv.includes("--json");
if (json) console.log(JSON.stringify({ ok: !results.some((result) => result.level === "fail"), results }, null, 2));
else {
  console.log("Balsa doctor\n");
  for (const result of results) console.log(`${result.level === "pass" ? "✓" : result.level === "warn" ? "!" : "✗"} ${result.name}: ${result.detail}`);
  const failures = results.filter((result) => result.level === "fail").length;
  const warnings = results.filter((result) => result.level === "warn").length;
  console.log(`\n${failures ? `${failures} problem${failures === 1 ? "" : "s"} found` : "Ready"}${warnings ? ` · ${warnings} warning${warnings === 1 ? "" : "s"}` : ""}`);
}
if (results.some((result) => result.level === "fail")) process.exitCode = 1;
