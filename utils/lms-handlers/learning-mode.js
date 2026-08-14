import { getRuntimeSnapshot } from "../v3-runtime-controller.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ success: false, error: "method_not_allowed", activeMode: "v2", effectiveMode: "v2", killSwitch: false });
  const state = await getRuntimeSnapshot();
  return res.status(200).json({ success: true, ...state });
}
