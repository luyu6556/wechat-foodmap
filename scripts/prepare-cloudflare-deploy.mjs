import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const [databaseId, databaseName, bucketName, workerName = "group-food-map"] = process.argv.slice(2);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const cloudflareName = /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$/;

if (!uuid.test(databaseId || "") || ![databaseName, bucketName, workerName].every((name) => cloudflareName.test(name || ""))) {
  throw new Error("用法：node scripts/prepare-cloudflare-deploy.mjs <D1 UUID> <D1 名称> <R2 Bucket 名称> [Worker 名称]");
}

const generated = JSON.parse(readFileSync(`${root}/dist/server/wrangler.json`, "utf8"));
const config = {
  name: workerName,
  main: "dist/server/index.js",
  compatibility_date: generated.compatibility_date,
  compatibility_flags: generated.compatibility_flags,
  no_bundle: true,
  workers_dev: true,
  assets: { directory: "dist/client" },
  rules: generated.rules,
  observability: { enabled: true },
  d1_databases: [{ binding: "DB", database_name: databaseName, database_id: databaseId, migrations_dir: "drizzle" }],
  r2_buckets: [{ binding: "BUCKET", bucket_name: bucketName }],
};
writeFileSync(`${root}/wrangler.personal.json`, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
process.stdout.write("已生成 wrangler.personal.json（已被 Git 忽略）。\n");
