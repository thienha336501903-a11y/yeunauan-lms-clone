const VIDEO_TYPES = new Set(['video']);
const IMAGE_TYPES = new Set(['image', 'photo']);

function byPosition(left, right) {
  return Number(left?.position || 0) - Number(right?.position || 0);
}

export function normalizeSearch(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd');
}

export function mosaicClass(count) {
  if (count <= 1) return 'n1';
  if (count === 2) return 'n2';
  if (count === 3) return 'n3';
  if (count === 4) return 'n4';
  if (count === 5) return 'n5';
  return 'n6p';
}

function categoryFor(assets, text) {
  if (assets.some(asset => VIDEO_TYPES.has(asset.type))) return 'video';
  if (assets.some(asset => !IMAGE_TYPES.has(asset.type))) return 'file';
  const folded = normalizeSearch(text);
  if (!assets.length && /(?:nguyen lieu|cong thuc|\bgr\b|\bml\b|\bkg\b)/.test(folded)) return 'recipe';
  return assets.length ? 'photo' : 'all';
}

function uniqueText(...values) {
  return [...new Set(values.map(value => String(value || '').trim()).filter(Boolean))].join('\n');
}

export function buildV5ViewModel(payload) {
  const lessons = [...(Array.isArray(payload?.lessons) ? payload.lessons : [])].sort(byPosition);
  const posts = [...(Array.isArray(payload?.posts) ? payload.posts : [])].sort(byPosition);
  const links = [...(Array.isArray(payload?.links) ? payload.links : [])].sort(byPosition);
  const assets = new Map((Array.isArray(payload?.assets) ? payload.assets : []).map(asset => [String(asset.id), asset]));
  const linksByPost = new Map();
  for (const link of links) {
    const key = String(link.post_id || '');
    if (!linksByPost.has(key)) linksByPost.set(key, []);
    linksByPost.get(key).push(link);
  }
  const postsByLesson = new Map();
  for (const post of posts) {
    const key = String(post.lesson_id || '');
    const postAssets = (linksByPost.get(String(post.id)) || [])
      .map(link => assets.get(String(link.asset_id)))
      .filter(Boolean);
    const visualAssets = postAssets.filter(asset => IMAGE_TYPES.has(asset.type) || VIDEO_TYPES.has(asset.type));
    const fileAssets = postAssets.filter(asset => !visualAssets.includes(asset));
    const display = post.display && typeof post.display === 'object' ? post.display : {};
    const body = uniqueText(post.text_content, post.caption);
    const item = {
      ...post,
      body,
      textOnly: postAssets.length ? '' : body,
      caption: postAssets.length ? body : '',
      visualAssets,
      fileAssets,
      mosaic: mosaicClass(visualAssets.length),
      sourceTitle: String(display.sender_label || display.source_title || '').trim(),
      sourceDate: String(display.source_date || '').trim(),
      isPinned: display.is_pinned === true,
      category: categoryFor(postAssets, body),
      search: normalizeSearch(body)
    };
    if (!postsByLesson.has(key)) postsByLesson.set(key, []);
    postsByLesson.get(key).push(item);
  }
  const lessonViews = lessons.map(lesson => {
    const lessonPosts = postsByLesson.get(String(lesson.id)) || [];
    const fallbackThumbnail = lessonPosts
      .flatMap(post => post.visualAssets)
      .find(asset => IMAGE_TYPES.has(asset.type)) || null;
    const displayPosts = lessonPosts.map(post => ({
      ...post,
      visualAssets: post.visualAssets.map(asset => VIDEO_TYPES.has(asset.type) && !asset.thumbnail_asset_id && fallbackThumbnail
        ? { ...asset, thumbnail_asset_id: fallbackThumbnail.id, thumbnail_fallback: true }
        : asset)
    }));
    const first = lessonPosts[0] || null;
    return {
      ...lesson,
      posts: displayPosts,
      date: first?.sourceDate || '',
      category: lessonPosts.some(post => post.category === 'video') ? 'video'
        : lessonPosts.some(post => post.category === 'file') ? 'file'
          : lessonPosts.some(post => post.category === 'recipe') ? 'recipe' : 'all',
      search: normalizeSearch([lesson.title, ...lessonPosts.map(post => post.body)].join(' '))
    };
  });
  const loosePosts = postsByLesson.get('') || [];
  if (loosePosts.length) {
    lessonViews.push({ id: 'v5-loose-posts', title: 'Nội dung bổ sung', position: Number.MAX_SAFE_INTEGER, posts: loosePosts, date: loosePosts[0]?.sourceDate || '', category: 'all', search: normalizeSearch(loosePosts.map(post => post.body).join(' ')) });
  }
  return lessonViews;
}
