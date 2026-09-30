import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
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
const filesToServe = ["0000_robust_loners.sql", "0001_narrow_justin_hammer.sql"];

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

// Apply the versioned migrations exactly once per state directory. Both files are
// already-live migrations and must never be edited; new structure means a new file.
const marker = path.join(stateDir, ".migrations-applied");
if (!existsSync(marker)) {
  console.log("[food-map] fresh state directory, applying migrations");
  for (const file of filesToServe) {
    const sqlPath = path.join(projectRoot, "drizzle", file);
    if (!existsSync(sqlPath)) throw new Error(`missing migration file: ${sqlPath}`);
    const status = run([
      "d1", "execute", "DB",
      "--local",
      "--persist-to", stateDir,
      "--config", configPath,
      `--file=${sqlPath}`,
    ]);
    if (status !== 0) process.exit(status);
  }
  writeFileSync(marker, `${new Date().toISOString()}\n`);
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
