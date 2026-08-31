import { createRequire } from "node:module";
import fs from "node:fs";
import zlib from "node:zlib";

function packageVersion(require, name) {
  try {
    return require(`${name}/package.json`).version || null;
  } catch {
    return null;
  }
}

function classifyStack(stack) {
  const lines = String(stack || "").split("\n").slice(1);
  for (const line of lines) {
    const normalized = line.replace(/\\/g, "/");
    const match = normalized.match(/node_modules\/((?:@[^/]+\/)?[^/]+)\/(.*?)(?::\d+:\d+)?\)?$/);
    if (match) {
      return { package: match[1], file: match[2].replace(/:\d+:\d+$/, "") };
    }
  }
  return { package: "app-or-runtime", file: "unknown" };
}

export default async function handler(req, res) {
  if (process.env.VERCEL_ENV !== "preview") {
    return res.status(404).json({ ok: false, error: "not_found" });
  }

  if (String(req.query?.lock || "") === "1") {
    try {
      const lock = fs.readFileSync(new URL("../package-lock.json", import.meta.url));
      const data = zlib.gzipSync(lock).toString("base64");
      return res.status(200).json({ ok: true, encoding: "gzip-base64", data });
    } catch (error) {
      return res.status(500).json({ ok: false, error: String(error?.code || error?.name || "lock_read_failed") });
    }
  }

  const require = createRequire(import.meta.url);
  const versions = {
    googleapis: packageVersion(require, "googleapis"),
    googleAuthLibrary: packageVersion(require, "google-auth-library"),
    gaxios: packageVersion(require, "gaxios"),
    nodeFetch: packageVersion(require, "node-fetch")
  };

  const legacyUrl = require("node:url");
  const originalParse = legacyUrl.parse;
  const calls = [];

  legacyUrl.parse = function tracedUrlParse(...args) {
    calls.push(classifyStack(new Error().stack));
    return originalParse.apply(this, args);
  };

  let drive = "unknown";
  try {
    const { supabase } = await import("../utils/supabase.js");
    const { getGoogleDriveClient } = await import("../utils/lms.js");
    const client = await getGoogleDriveClient(supabase);
    if (!client?.drive) throw new Error("drive_client_unavailable");
    await client.drive.about.get({ fields: "storageQuota(limit,usage)" });
    drive = client.isServiceAccount ? "service_account" : "oauth";
  } catch (error) {
    drive = `failed:${String(error?.response?.data?.error || error?.code || error?.name || "error").slice(0, 60)}`;
  } finally {
    legacyUrl.parse = originalParse;
  }

  const unique = [];
  const seen = new Set();
  for (const call of calls) {
    const key = `${call.package}|${call.file}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(call);
    }
  }

  return res.status(200).json({ ok: true, versions, drive, urlParseCallers: unique });
}
