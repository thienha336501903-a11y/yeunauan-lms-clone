export function isV5ReleaseSnapshot(snapshot) {
  return Boolean(snapshot && typeof snapshot === 'object' && snapshot.schema === 'v5-release-v1');
}

function byPosition(left, right) {
  return Number(left?.position || 0) - Number(right?.position || 0);
}

function safeText(value, maxLength = 240) {
  return String(value || '').trim().slice(0, maxLength);
}

function safeIsoDate(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : '';
}

function learnerPostDisplay(metadata) {
  const source = metadata && typeof metadata === 'object' ? metadata : {};
  const display = {
    source_title: safeText(source.source_title),
    sender_label: safeText(source.sender_label),
    source_date: safeIsoDate(source.source_date)
  };
  if (source.is_pinned === true) display.is_pinned = true;
  return display;
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

export function v5LearnerReleaseContent(snapshot) {
  const content = v5ReleaseContent(snapshot);
  if (!content) return null;
  const config = { source_mode: content.config?.source_mode || "" };
  if (content.config?.settings?.authoring_mode) {
    config.settings = { authoring_mode: content.config.settings.authoring_mode };
  }
  return {
    config,
    lessons: content.lessons.map(({ id, title, position }) => ({ id, title, position })),
    posts: content.posts.map(({ id, lesson_id, position, text_content, caption, metadata }) => ({
      id,
      lesson_id: lesson_id || null,
      position,
      text_content: text_content || null,
      caption: caption || null,
      display: learnerPostDisplay(metadata)
    })),
    links: content.links.map(({ post_id, asset_id, position }) => ({ post_id, asset_id, position })),
    assetIds: content.assetIds
  };
}

export function v5ReleaseHasAsset(snapshot, assetId) {
  const target = String(assetId || '').trim();
  if (!target) return false;
  const content = v5ReleaseContent(snapshot);
  if (!content) return false;
  return content.links.some(link => String(link.asset_id || '') === target);
}
