import { createRequire } from "node:module";

function classifyStack(stack) {
  const lines = String(stack || "").split("\n").slice(1);
  for (const line of lines) {
    const normalized = line.replace(/\\/g, "/");
    const match = normalized.match(/node_modules\/((?:@[^/]+\/)?[^/]+)\/(.*?)(?::\d+:\d+)?\)?$/);
    if (match) {
      return {
        package: match[1],
        file: match[2].replace(/:\d+:\d+$/, "")
      };
    }
  }
  return { package: "app-or-runtime", file: "unknown" };
}

export default async function handler(req, res) {
  if (process.env.VERCEL_ENV !== "preview") {
    return res.status(404).json({ ok: false, error: "not_found" });
  }

  const require = createRequire(import.meta.url);
  const legacyUrl = require("node:url");
  const originalParse = legacyUrl.parse;
  const calls = [];
  const probes = [];
  let currentProbe = "bootstrap";

  legacyUrl.parse = function tracedUrlParse(...args) {
    calls.push({ probe: currentProbe, ...classifyStack(new Error().stack) });
    return originalParse.apply(this, args);
  };

  async function runProbe(name, fn) {
    currentProbe = name;
    try {
      await fn();
      probes.push({ name, status: "ok" });
    } catch (error) {
      probes.push({
        name,
        status: "failed",
        error: String(error?.response?.data?.error || error?.code || error?.name || "error").slice(0, 80)
      });
    }
  }

  try {
    let supabase;
    await runProbe("supabase-read", async () => {
      ({ supabase } = await import("../utils/supabase.js"));
      const { error } = await supabase.from("site_config").select("key").limit(1);
      if (error) throw error;
    });

    await runProbe("google-drive", async () => {
      if (!supabase) throw new Error("supabase_unavailable");
      const { getGoogleDriveClient } = await import("../utils/lms.js");
      const client = await getGoogleDriveClient(supabase);
      if (!client?.drive) throw new Error("drive_client_unavailable");
      await client.drive.about.get({ fields: "storageQuota(limit,usage)" });
    });

    await runProbe("cloudinary-import", async () => {
      await import("cloudinary");
    });
  } finally {
    legacyUrl.parse = originalParse;
  }

  const unique = [];
  const seen = new Set();
  for (const call of calls) {
    const key = `${call.probe}|${call.package}|${call.file}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(call);
    }
  }

  return res.status(200).json({ ok: true, probes, urlParseCallers: unique });
}
