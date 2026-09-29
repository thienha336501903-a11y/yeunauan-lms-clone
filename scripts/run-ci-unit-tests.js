#!/usr/bin/env node
import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const testDir = path.join(root, "test");

const EXCLUDED = new Set([
  "m0d-dependency-checker.test.js",
  "m0d-readiness.test.js",
  "m0e-inventory-consistency.test.js",
  "multi-agency-b5-real-db.test.js",
  "multi-agency-b7.test.js",
  "pre-m0c-test-target-security.test.js",
  "second-tenant-isolation.test.js",
  "synthetic-agency-provisioning.test.js",
  "verify-pre-m0c-acceptance.test.js"
]);

const all = readdirSync(testDir).filter(name => name.endsWith(".test.js")).sort();
const missing = [...EXCLUDED].filter(name => !all.includes(name));
if (missing.length) {
  console.error(`CI test manifest drift: expected isolated/deferred suites missing: ${missing.join(", ")}`);
  process.exit(1);
}
const selected = all.filter(name => !EXCLUDED.has(name));
if (!selected.length) {
  console.error("CI test manifest selected no tests.");
  process.exit(1);
}

console.log(`PR CI: running ${selected.length} hermetic test files.`);
console.log(`PR CI: ${EXCLUDED.size} isolated/deferred suites remain outside this runner.`);

const result = spawnSync(process.execPath, ["--test", ...selected.map(name => path.join("test", name))], {
  cwd: root,
  stdio: "inherit",
  env: { ...process.env, NODE_ENV: "test" }
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
