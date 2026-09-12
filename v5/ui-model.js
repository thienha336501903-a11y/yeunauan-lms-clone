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
    const first = lessonPosts[0] || null;
    return {
      ...lesson,
      posts: lessonPosts,
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

export function buildTimelineOutline(payload) {
  const posts = [...(Array.isArray(payload?.posts) ? payload.posts : [])].sort(byPosition);
  const rawLinks = Array.isArray(payload?.links) ? payload.links : (Array.isArray(payload?.post_assets) ? payload.post_assets : []);
  const links = [...rawLinks].sort(byPosition);
  const assets = new Map((Array.isArray(payload?.assets) ? payload.assets : []).map(asset => [String(asset.id), asset]));
  const linksByPost = new Map();
  for (const link of links) {
    const key = String(link.post_id || '');
    if (!linksByPost.has(key)) linksByPost.set(key, []);
    linksByPost.get(key).push(link);
  }

  return posts.map((post, index) => {
    const postAssets = (Array.isArray(post.visualAssets) || Array.isArray(post.fileAssets))
      ? [...(post.visualAssets || []), ...(post.fileAssets || [])]
      : (linksByPost.get(String(post.id)) || [])
          .map(link => assets.get(String(link.asset_id)))
          .filter(Boolean);

    const hasVideo = postAssets.some(asset => VIDEO_TYPES.has(asset.type));
    const hasImage = postAssets.some(asset => IMAGE_TYPES.has(asset.type));
    const hasDoc = postAssets.some(asset => !VIDEO_TYPES.has(asset.type) && !IMAGE_TYPES.has(asset.type));

    let mediaIcon = '•';
    let category = 'text';
    if (hasVideo) {
      mediaIcon = '▶';
      category = 'video';
    } else if (hasDoc) {
      mediaIcon = '📄';
      category = 'file';
    } else if (hasImage) {
      mediaIcon = '📷';
      category = 'photo';
    }

    const primaryAsset = postAssets[0] || null;
    const assetFilename = String(primaryAsset?.original_filename || '').trim();

    const body = uniqueText(post.body || post.text_content, post.caption).trim();
    const lines = body ? body.split(/\r?\n/).map(line => line.trim()).filter(Boolean) : [];

    let title = '';
    let subtitle = '';

    if (lines.length > 0) {
      title = lines[0];
      if (title.length > 65) {
        title = title.slice(0, 60).trim() + '…';
      }

      if (assetFilename) {
        subtitle = assetFilename;
      } else if (lines.length > 1) {
        let secondLine = lines[1];
        if (secondLine.length > 70) {
          secondLine = secondLine.slice(0, 65).trim() + '…';
        }
        subtitle = secondLine;
      }
    } else {
      if (hasVideo) {
        title = 'Video';
      } else if (hasDoc) {
        title = 'Tài liệu';
      } else if (hasImage) {
        title = 'Hình ảnh';
      } else {
        title = 'Bài đăng';
      }

      if (assetFilename) {
        subtitle = assetFilename;
      }
    }

    const display = post.display && typeof post.display === 'object' ? post.display : {};
    const sourceDate = String(display.source_date || post.created_at || '').trim();

    return {
      postId: String(post.id),
      ordinal: index + 1,
      title,
      subtitle,
      mediaIcon,
      category,
      position: Number(post.position || 0),
      sourceDate
    };
  });
}

