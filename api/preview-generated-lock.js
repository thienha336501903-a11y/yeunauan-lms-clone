export default function handler(req, res) {
  if (process.env.VERCEL_ENV !== "preview") {
    return res.status(404).json({ ok: false, error: "not_found" });
  }
  return res.status(503).json({ ok: false, error: "lock_capture_not_generated" });
}
