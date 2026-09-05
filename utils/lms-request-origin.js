function firstHeaderValue(value) {
  return String(value || '').split(',')[0].trim();
}

function appendVary(res, value) {
  const current = String(res.getHeader?.('Vary') || '').trim();
  const parts = current ? current.split(',').map(item => item.trim()).filter(Boolean) : [];
  if (!parts.some(item => item.toLowerCase() === value.toLowerCase())) parts.push(value);
  if (parts.length) res.setHeader('Vary', parts.join(', '));
}

export function getRequestOrigin(req) {
  const headers = req?.headers || {};
  const host = firstHeaderValue(headers['x-forwarded-host'] || headers.host).toLowerCase();
  const proto = firstHeaderValue(headers['x-forwarded-proto'] || 'https').toLowerCase();
  if (!host || !['https', 'http'].includes(proto)) return '';
  try {
    return new URL(`${proto}://${host}`).origin;
  } catch {
    return '';
  }
}

export function applySameOriginCors(req, res, {
  methods = 'POST, OPTIONS',
  headers = 'Content-Type'
} = {}) {
  res.setHeader('Access-Control-Allow-Methods', methods);
  res.setHeader('Access-Control-Allow-Headers', headers);

  const browserOrigin = firstHeaderValue(req?.headers?.origin);
  if (!browserOrigin) return true;

  let normalizedOrigin = '';
  try {
    normalizedOrigin = new URL(browserOrigin).origin;
  } catch {
    return false;
  }

  const requestOrigin = getRequestOrigin(req);
  if (!requestOrigin || normalizedOrigin !== requestOrigin) return false;

  res.setHeader('Access-Control-Allow-Origin', normalizedOrigin);
  appendVary(res, 'Origin');
  return true;
}
