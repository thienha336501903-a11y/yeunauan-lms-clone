import { cloneConfig } from "../utils/clone-config.js";

export default function handler(req, res) {
  const id = String(req.query?.id || "").trim();
  if (!id || !/^[A-Za-z0-9_-]{1,160}$/.test(id)) return res.status(400).send("Invalid post id");
  return res.redirect(307, `${cloneConfig().legacyPostPublicUrl}/post/${encodeURIComponent(id)}`);
}
