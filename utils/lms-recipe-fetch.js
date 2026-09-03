const MAX_RECIPE_BYTES = 2 * 1024 * 1024;
const RECIPE_FETCH_TIMEOUT_MS = 10 * 1000;
const MAX_REDIRECTS = 4;

const ALLOWED_RECIPE_HOSTS = new Set([
  "docs.google.com",
  "drive.google.com",
  "drive.usercontent.google.com"
]);

export function isAllowedRecipeFetchUrl(input) {
  try {
    const url = new URL(String(input || ""));
    const hostname = url.hostname.toLowerCase();
    if (url.protocol !== "https:" || url.username || url.password) return false;
    if (url.port && url.port !== "443") return false;
    return ALLOWED_RECIPE_HOSTS.has(hostname) || hostname.endsWith(".googleusercontent.com");
  } catch {
    return false;
  }
}

async function readTextBounded(response, maxBytes) {
  const contentLength = Number(response.headers.get("content-length") || 0);
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new Error("Recipe response is too large");
  }

  if (!response.body?.getReader) {
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > maxBytes) throw new Error("Recipe response is too large");
    return bytes.toString("utf8");
  }

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      total += chunk.length;
      if (total > maxBytes) throw new Error("Recipe response is too large");
      chunks.push(chunk);
    }
  } finally {
    if (total > maxBytes) await reader.cancel().catch(() => {});
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function fetchAllowedRecipeUrl(input, options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const maxBytes = Number(options.maxBytes || MAX_RECIPE_BYTES);
  const timeoutMs = Number(options.timeoutMs || RECIPE_FETCH_TIMEOUT_MS);
  let current = String(input || "").trim();
  if (!isAllowedRecipeFetchUrl(current)) throw new Error("Recipe URL host is not allowed");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
      const response = await fetchImpl(current, {
        redirect: "manual",
        signal: controller.signal,
        headers: { "User-Agent": "Mozilla/5.0" }
      });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("location");
        if (!location || redirects === MAX_REDIRECTS) throw new Error("Recipe redirect is invalid");
        const next = new URL(location, current).toString();
        if (!isAllowedRecipeFetchUrl(next)) throw new Error("Recipe redirect host is not allowed");
        try { await response.body?.cancel(); } catch {}
        current = next;
        continue;
      }
      if (!response.ok) throw new Error(`Status ${response.status}`);
      return {
        contentType: response.headers.get("content-type") || "",
        text: await readTextBounded(response, maxBytes),
        finalUrl: current
      };
    }
    throw new Error("Recipe redirect limit exceeded");
  } finally {
    clearTimeout(timer);
  }
}
