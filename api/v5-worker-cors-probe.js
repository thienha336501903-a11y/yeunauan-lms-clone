const PREVIEW_ORIGIN = "https://yeunauan-lms-git-d4dd8d-thienha100022653824678-stacks-projects.vercel.app";

export default async function handler(req, res) {
  if (process.env.VERCEL_ENV !== "preview" || process.env.VERCEL_GIT_COMMIT_REF !== "perf/v5-300-student-readiness-20260908") {
    return res.status(404).json({ ok: false, error: "not_found" });
  }

  const base = String(process.env.V5_MEDIA_PUBLIC_URL || "").trim().replace(/\/+$/, "");
  if (!base) return res.status(503).json({ ok: false, error: "v5_media_public_url_missing" });

  try {
    const upstream = await fetch(`${base}/health`, {
      method: "GET",
      headers: { Origin: PREVIEW_ORIGIN, Accept: "application/json" },
      cache: "no-store"
    });
    return res.status(200).json({
      ok: true,
      probeOrigin: PREVIEW_ORIGIN,
      upstreamStatus: upstream.status,
      accessControlAllowOrigin: upstream.headers.get("access-control-allow-origin") || null,
      vary: upstream.headers.get("vary") || null
    });
  } catch {
    return res.status(502).json({ ok: false, error: "worker_probe_failed" });
  }
}
