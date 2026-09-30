import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const wranglerCli = path.join(projectRoot, "node_modules/wrangler/bin/wrangler.js");
const configPath = path.join(projectRoot, "dist/server/wrangler.json");

// The runtime state (D1 SQLite database and R2 objects) lives OUTSIDE the project
// directory on purpose: the deploy uploads this directory as-is, so a state
// directory inside it would be overwritten on every re-deploy and wipe group data.
// Verified 2026-09-30: rows survive both across requests and across re-deploys.
const stateDir = process.env.FOOD_MAP_STATE_DIR || path.join(os.homedir(), ".qunliao-food-map", "state");
const port = process.env.PORT || "3000";

function run(args) {
  const result = spawnSync(process.execPath, [wranglerCli, ...args], {
    cwd: projectRoot,
    stdio: "inherit",
    env: process.env,
  });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

mkdirSync(stateDir, { recursive: true });
console.log(`[food-map] state directory: ${stateDir}`);

if (!existsSync(configPath)) {
  console.log("[food-map] no build found, running build first");
  const build = spawnSync("npm", ["run", "build"], {
    cwd: projectRoot,
    stdio: "inherit",
    env: process.env,
  });
  if (build.error) throw build.error;
  if (build.status !== 0) process.exit(build.status ?? 1);
}

// Apply versioned migrations incrementally, exactly once per state directory.
// Migration files are append-only history: never edit an existing file, add a new one.
// The marker records WHICH files were applied, one per line — not merely that the step
// ran once — because a state directory that already exists must still receive migrations
// added later. A timestamp-only marker would silently skip every future migration, which
// would leave the live database missing columns and break queries.
const drizzleDir = path.join(projectRoot, "drizzle");
const allMigrations = readdirSync(drizzleDir).filter((name) => name.endsWith(".sql")).sort();
// Markers written before 2026-09-30 contained only an ISO timestamp. Everything that
// existed back then had already been applied, so seed the list rather than re-running it
// (re-running `ALTER TABLE ... ADD COLUMN` or `CREATE TABLE` would fail).
const LEGACY_APPLIED = ["0000_robust_loners.sql", "0001_narrow_justin_hammer.sql"];
const marker = path.join(stateDir, ".migrations-applied");
const applied = new Set();
if (existsSync(marker)) {
  const lines = readFileSync(marker, "utf8").split("\n").map((line) => line.trim()).filter(Boolean);
  const isFileList = lines.length > 0 && lines.every((line) => line.endsWith(".sql"));
  for (const name of isFileList ? lines : LEGACY_APPLIED) applied.add(name);
}
const pending = allMigrations.filter((name) => !applied.has(name));
if (pending.length) {
  console.log(`[food-map] applying migrations: ${pending.join(", ")}`);
  for (const file of pending) {
    const sqlPath = path.join(drizzleDir, file);
    if (!existsSync(sqlPath)) throw new Error(`missing migration file: ${sqlPath}`);
    const status = run([
      "d1", "execute", "DB",
      "--local",
      "--persist-to", stateDir,
      "--config", configPath,
      `--file=${sqlPath}`,
    ]);
    if (status !== 0) process.exit(status);
    applied.add(file);
  }
  writeFileSync(marker, `${[...applied].sort().join("\n")}\n`);
  console.log("[food-map] migrations applied");
} else {
  console.log("[food-map] migrations already applied, reusing existing data");
}

const d1Objects = path.join(stateDir, "v3/d1/miniflare-D1DatabaseObject");
const dbFiles = existsSync(d1Objects)
  ? readdirSync(d1Objects).filter((name) => name.endsWith(".sqlite"))
  : [];
console.log(`[food-map] D1 files in state: ${dbFiles.length}`);

// Bind 0.0.0.0 and honor the injected PORT: the platform reaches the app through a
// reverse proxy and will not connect to a loopback-only listener.
// `.dev.vars` (gitignored, never committed) holds local secrets such as the owner
// claim code hash. Wrangler resolves it relative to the config file, which lives in
// dist/server, so pass it explicitly instead of relying on discovery.
const devVarsPath = path.join(projectRoot, ".dev.vars");
const secretArgs = existsSync(devVarsPath) ? [`--env-file=${devVarsPath}`] : [];
console.log(`[food-map] secrets file: ${secretArgs.length ? devVarsPath : "none"}`);
console.log(`[food-map] starting server on 0.0.0.0:${port}`);
const child = spawn(process.execPath, [
  wranglerCli,
  "dev",
  "--config", configPath,
  "--local",
  "--persist-to", stateDir,
  "--ip", "0.0.0.0",
  "--port", String(port),
  "--inspector-port", "0",
  ...secretArgs,
], { cwd: projectRoot, stdio: "inherit", env: process.env });

child.on("exit", (code) => process.exit(code ?? 0));
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}
