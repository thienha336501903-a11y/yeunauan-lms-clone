export function cleanV5IntroText(value) {
  return String(value || "")
    .replace(/\u0000/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function uniqueText(...values) {
  return [...new Set(values.map(value => String(value || "").trim()).filter(Boolean))].join("\n");
}

export function buildV5IntroItems(releaseContent = {}) {
  const isTimeline = releaseContent?.config?.settings?.authoring_mode === "timeline";
  const rawLessons = Array.isArray(releaseContent?.lessons) ? releaseContent.lessons : [];
  const systemLessonIds = new Set(
    rawLessons.filter(l => l?.metadata?.system_lesson === true).map(l => String(l.id))
  );
  const lessons = rawLessons
    .filter(lesson => lesson?.metadata?.system_lesson !== true)
    .sort((a, b) => Number(a?.position || 0) - Number(b?.position || 0));
  const knownLessonIds = new Set(lessons.map(lesson => String(lesson.id)));
  const posts = [...(Array.isArray(releaseContent?.posts) ? releaseContent.posts : [])]
    .sort((a, b) => Number(a?.position || 0) - Number(b?.position || 0));

  let orderedPosts = [];
  if (isTimeline) {
    orderedPosts = posts;
  } else {
    const postsByLesson = new Map();
    const unassignedPosts = [];
    for (const post of posts) {
      const key = String(post.lesson_id || "");
      if (knownLessonIds.has(key)) {
        if (!postsByLesson.has(key)) postsByLesson.set(key, []);
        postsByLesson.get(key).push(post);
      } else if (!systemLessonIds.has(key)) {
        unassignedPosts.push(post);
      }
    }
    for (const lesson of lessons) {
      const lessonPosts = postsByLesson.get(String(lesson.id)) || [];
      orderedPosts.push(...lessonPosts);
    }
    orderedPosts.push(...unassignedPosts);
  }

  const items = [];
  for (const post of orderedPosts) {
    const combined = uniqueText(post.text_content, post.caption);
    const text = cleanV5IntroText(combined);
    if (!text) continue;
    items.push({
      text
    });
  }

  return {
    items,
    count: items.length,
    complete: true
  };
}

export function v5CourseIntroFallback(course = {}) {
  const raw = course?.raw_data && typeof course.raw_data === "object" ? course.raw_data : {};
  return cleanV5IntroText(raw.studentDisplayDescription || course?.description || "");
}
