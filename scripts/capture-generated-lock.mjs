import fs from "node:fs";
import zlib from "node:zlib";

const lock = fs.readFileSync("package-lock.json");
const encoded = zlib.gzipSync(lock).toString("base64");
const chunkSize = 16000;

const endpoint = `export default function handler(req, res) {\n  if (process.env.VERCEL_ENV !== \"preview\") {\n    return res.status(404).json({ ok: false, error: \"not_found\" });\n  }\n  const data = ${JSON.stringify(encoded)};\n  const chunkSize = ${chunkSize};\n  const chunks = Math.ceil(data.length / chunkSize);\n  const part = Math.max(0, Math.min(chunks - 1, Number(req.query?.part || 0)));\n  return res.status(200).json({ ok: true, encoding: \"gzip-base64\", part, chunks, data: data.slice(part * chunkSize, (part + 1) * chunkSize) });\n}\n`;

fs.writeFileSync("api/preview-generated-lock.js", endpoint);
console.log(`[capture-generated-lock] prepared ${Math.ceil(encoded.length / chunkSize)} chunk(s)`);
