import { supabase } from "../supabase.js";

export default async function healthHandler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") {
    return res.status(405).json({ status: "error", app: "ok", database: "unknown" });
  }

  const startedAt = Date.now();
  try {
    const { error } = await supabase
      .from("courses")
      .select("id", { count: "exact", head: true });
    if (error) throw error;

    return res.status(200).json({
      status: "ok",
      app: "ok",
      database: "ok",
      service: "yeunauan-lms-clone",
      databaseLatencyMs: Date.now() - startedAt,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error("[health] database check failed", {
      name: String(error?.name || "Error")
    });
    return res.status(503).json({
      status: "degraded",
      app: "ok",
      database: "error",
      service: "yeunauan-lms-clone",
      timestamp: new Date().toISOString()
    });
  }
}
