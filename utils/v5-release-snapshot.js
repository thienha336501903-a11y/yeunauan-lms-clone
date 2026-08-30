export function isV5ReleaseSnapshot(snapshot) {
  return Boolean(snapshot && typeof snapshot === 'object' && snapshot.schema === 'v5-release-v1');
}

function byPosition(left, right) {
  return Number(left?.position || 0) - Number(right?.position || 0);
}

export function v5ReleaseContent(snapshot) {
  if (!isV5ReleaseSnapshot(snapshot)) return null;
  const lessons = Array.isArray(snapshot.lessons) ? snapshot.lessons.map(item => ({ ...item, metadata: item?.metadata || {} })).sort(byPosition) : [];
  const posts = Array.isArray(snapshot.posts) ? snapshot.posts.map(item => ({ ...item, metadata: item?.metadata || {} })).sort(byPosition) : [];
  const links = Array.isArray(snapshot.links) ? snapshot.links.map(item => ({ ...item, metadata: item?.metadata || {} })).sort(byPosition) : [];
  const assetIds = [...new Set([
    ...(Array.isArray(snapshot.asset_ids) ? snapshot.asset_ids : []),
    ...links.map(item => item?.asset_id)
  ].filter(Boolean).map(String))];
  return {
    config: snapshot.config && typeof snapshot.config === 'object' ? snapshot.config : {},
    lessons,
    posts,
    links,
    assetIds
  };
}

export function v5ReleaseHasAsset(snapshot, assetId) {
  const target = String(assetId || '').trim();
  if (!target) return false;
  const content = v5ReleaseContent(snapshot);
  if (!content) return false;
  return content.links.some(link => String(link.asset_id || '') === target);
}
