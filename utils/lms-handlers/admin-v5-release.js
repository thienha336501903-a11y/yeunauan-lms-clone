import { supabase } from "../supabase.js";
import { getAdminFromRequest } from "../lms.js";

function clean(value) { return String(value || "").trim(); }

async function requireAdmin(req, res) {
  const admin = getAdminFromRequest(req);
  if (!admin?.email) {
    res.status(401).json({ success: false, error: "Bạn chưa đăng nhập Admin." });
    return null;
  }
  return admin;
}

async function loadCourse(slugInput) {
  const slug = clean(slugInput);
  const { data, error } = await supabase.from("courses").select("id,slug,title,is_published,active,delivery_mode").eq("slug", slug).maybeSingle();
  if (error) throw error;
  return data || null;
}

async function canonicalState(courseId) {
  const [{ data: config, error: configError }, { data: lessons, error: lessonError }, { data: posts, error: postError }] = await Promise.all([
    supabase.from("v5_course_configs").select("*").eq("course_id", courseId).maybeSingle(),
    supabase.from("v5_lessons").select("*").eq("course_id", courseId).order("position", { ascending: true }),
    supabase.from("v5_posts").select("*").eq("course_id", courseId).order("position", { ascending: true })
  ]);
  if (configError) throw configError;
  if (lessonError) throw lessonError;
  if (postError) throw postError;
  const postIds = (posts || []).map(x => x.id);
  let links = [];
  let assets = [];
  if (postIds.length) {
    const { data: linkRows, error } = await supabase.from("v5_post_assets").select("*").in("post_id", postIds).order("position", { ascending: true });
    if (error) throw error;
    links = linkRows || [];
    const assetIds = [...new Set(links.map(x => x.asset_id).filter(Boolean))];
    if (assetIds.length) {
      const { data: assetRows, error: assetError } = await supabase.from("v5_media_assets").select("id,type,provider,origin,status,r2_object_key,telegram_source_id,telegram_message_row_id,mime_type,original_filename,bytes,checksum_sha256,metadata").in("id", assetIds);
      if (assetError) throw assetError;
      assets = assetRows || [];
    }
  }
  return { config, lessons: lessons || [], posts: posts || [], links, assets };
}

function preflightFromState(course, state) {
  const errors = [];
  const warnings = [];
  const lessons = state.lessons || [];
  const posts = state.posts || [];
  const assets = state.assets || [];
  if (!state.config) errors.push("Khóa chưa được khởi tạo V5.");
  if (!lessons.length) errors.push("Khóa chưa có bài học.");
  if (!posts.length) errors.push("Khóa chưa có nội dung.");
  const orphanPosts = posts.filter(p => !p.lesson_id && p.status !== "archived");
  if (orphanPosts.length) errors.push(`Có ${orphanPosts.length} Post chưa thuộc Bài học.`);
  const activeLessons = lessons.filter(l => l.status !== "archived");
  const activePosts = posts.filter(p => p.status !== "archived");
  const emptyLessons = activeLessons.filter(l => !activePosts.some(p => p.lesson_id === l.id));
  if (emptyLessons.length) warnings.push(`Có ${emptyLessons.length} Bài học đang trống.`);
  const processingPosts = activePosts.filter(p => p.status === "processing");
  if (processingPosts.length) errors.push(`Có ${processingPosts.length} Post đang xử lý media.`);
  const failedAssets = assets.filter(a => a.status === "failed");
  const pendingAssets = assets.filter(a => !["ready", "archived"].includes(a.status));
  if (failedAssets.length) errors.push(`Có ${failedAssets.length} media bị lỗi.`);
  if (pendingAssets.length) errors.push(`Có ${pendingAssets.length} media chưa READY.`);
  const directWithoutR2 = assets.filter(a => a.origin === "direct" && a.status !== "archived" && (a.provider !== "r2" || !a.r2_object_key));
  if (directWithoutR2.length) errors.push(`Có ${directWithoutR2.length} media upload trực tiếp chưa có object R2.`);
  if (!course.active) warnings.push("Khóa đang active=false trong bảng courses.");
  if (!course.is_published) warnings.push("Khóa chưa bật is_published ở cổng LMS; học viên sẽ chưa vào được dù V5 đã Publish.");
  return {
    ok: errors.length === 0,
    errors,
    warnings,
    counts: {
      lessons: activeLessons.length,
      posts: activePosts.length,
      assets: assets.filter(a => a.status !== "archived").length,
      videos: assets.filter(a => a.type === "video" && a.status !== "archived").length,
      images: assets.filter(a => a.type === "image" && a.status !== "archived").length,
      documents: assets.filter(a => a.type === "document" && a.status !== "archived").length,
      readyAssets: assets.filter(a => a.status === "ready").length
    }
  };
}

async function preflight(course) {
  const state = await canonicalState(course.id);
  return { report: preflightFromState(course, state), state };
}

function releaseSnapshot(state) {
  const lessons = state.lessons.filter(x => x.status !== "archived");
  const posts = state.posts.filter(x => x.status !== "archived");
  const postIds = new Set(posts.map(x => x.id));
  return {
    schema: "v5-release-v1",
    created_at: new Date().toISOString(),
    config: state.config ? { source_mode: state.config.source_mode, settings: state.config.settings || {} } : null,
    lessons: lessons.map(({ id, title, position, metadata }) => ({ id, title, position, metadata: metadata || {} })),
    posts: posts.map(({ id, lesson_id, position, text_content, caption, origin, origin_ref, metadata }) => ({ id, lesson_id, position, text_content, caption, origin, origin_ref: origin_ref || {}, metadata: metadata || {} })),
    links: state.links.filter(x => postIds.has(x.post_id)).map(({ post_id, asset_id, position, role, metadata }) => ({ post_id, asset_id, position, role, metadata: metadata || {} })),
    asset_ids: [...new Set(state.links.filter(x => postIds.has(x.post_id)).map(x => x.asset_id).filter(Boolean))]
  };
}

async function nextReleaseVersion(courseId) {
  const { data, error } = await supabase.from("v5_releases").select("version").eq("course_id", courseId).order("version", { ascending: false }).limit(1);
  if (error) throw error;
  return Number(data?.[0]?.version || 0) + 1;
}

async function publish(course, admin) {
  const { report, state } = await preflight(course);
  if (!report.ok) {
    const error = new Error("Preflight V5 chưa đạt.");
    error.code = "v5_preflight_failed";
    error.report = report;
    throw error;
  }
  const version = await nextReleaseVersion(course.id);
  const snapshot = releaseSnapshot(state);
  const { data: release, error: releaseError } = await supabase.from("v5_releases").insert({ course_id: course.id, version, status: "published", snapshot, created_by: admin.email }).select("*").single();
  if (releaseError) throw releaseError;
  const now = new Date().toISOString();
  try {
    const previousId = state.config?.published_release_id;
    if (previousId) {
      const { error } = await supabase.from("v5_releases").update({ status: "superseded" }).eq("id", previousId).eq("course_id", course.id);
      if (error) throw error;
    }
    const lessonIds = snapshot.lessons.map(x => x.id);
    const postIds = snapshot.posts.map(x => x.id);
    if (lessonIds.length) {
      const { error } = await supabase.from("v5_lessons").update({ status: "published", updated_at: now }).in("id", lessonIds).eq("course_id", course.id);
      if (error) throw error;
    }
    if (postIds.length) {
      const { error } = await supabase.from("v5_posts").update({ status: "published", updated_at: now }).in("id", postIds).eq("course_id", course.id);
      if (error) throw error;
    }
    const { error: configError } = await supabase.from("v5_course_configs").update({ status: "published", published_release_id: release.id, updated_at: now }).eq("course_id", course.id);
    if (configError) throw configError;
  } catch (error) {
    await supabase.from("v5_releases").update({ status: "rolled_back" }).eq("id", release.id);
    throw error;
  }
  return { release: { id: release.id, version: release.version, created_at: release.created_at }, report };
}

async function movePositionsToTemporarySpace(courseId, rows, table, base) {
  for (let index = 0; index < rows.length; index += 1) {
    const { error } = await supabase.from(table).update({ position: base + index, updated_at: new Date().toISOString() }).eq("id", rows[index].id).eq("course_id", courseId);
    if (error) throw error;
  }
}

async function rollback(course, admin, releaseIdInput) {
  const releaseId = clean(releaseIdInput);
  if (!releaseId) throw new Error("Thiếu releaseId để rollback.");
  const { data: release, error } = await supabase.from("v5_releases").select("*").eq("id", releaseId).eq("course_id", course.id).maybeSingle();
  if (error) throw error;
  if (!release?.snapshot || release.snapshot.schema !== "v5-release-v1") throw new Error("Release snapshot không hợp lệ.");
  const snapshot = release.snapshot;
  const current = await canonicalState(course.id);
  const snapshotLessonIds = new Set((snapshot.lessons || []).map(x => x.id));
  const snapshotPostIds = new Set((snapshot.posts || []).map(x => x.id));
  const now = new Date().toISOString();

  // Avoid unique(course_id, position) collisions while restoring historical order.
  await movePositionsToTemporarySpace(course.id, current.lessons, "v5_lessons", 200000000);
  await movePositionsToTemporarySpace(course.id, current.posts, "v5_posts", 300000000);

  const extraPosts = current.posts.filter(x => !snapshotPostIds.has(x.id)).map(x => x.id);
  if (extraPosts.length) {
    const { error: archiveError } = await supabase.from("v5_posts").update({ status: "archived", updated_at: now }).in("id", extraPosts).eq("course_id", course.id);
    if (archiveError) throw archiveError;
  }
  const extraLessons = current.lessons.filter(x => !snapshotLessonIds.has(x.id)).map(x => x.id);
  if (extraLessons.length) {
    const { error: archiveError } = await supabase.from("v5_lessons").update({ status: "archived", updated_at: now }).in("id", extraLessons).eq("course_id", course.id);
    if (archiveError) throw archiveError;
  }

  for (const lesson of snapshot.lessons || []) {
    const { error: upsertError } = await supabase.from("v5_lessons").upsert({ id: lesson.id, course_id: course.id, title: lesson.title, position: lesson.position, status: "published", metadata: lesson.metadata || {}, updated_at: now }, { onConflict: "id" });
    if (upsertError) throw upsertError;
  }
  for (const post of snapshot.posts || []) {
    const { error: upsertError } = await supabase.from("v5_posts").upsert({ id: post.id, course_id: course.id, lesson_id: post.lesson_id || null, position: post.position, text_content: post.text_content || null, caption: post.caption || null, origin: post.origin || "direct", origin_ref: post.origin_ref || {}, status: "published", metadata: post.metadata || {}, updated_at: now }, { onConflict: "id" });
    if (upsertError) throw upsertError;
  }

  const allSnapshotPostIds = [...snapshotPostIds];
  if (allSnapshotPostIds.length) {
    const { error: clearError } = await supabase.from("v5_post_assets").delete().in("post_id", allSnapshotPostIds);
    if (clearError) throw clearError;
    if ((snapshot.links || []).length) {
      const { error: linkError } = await supabase.from("v5_post_assets").insert(snapshot.links);
      if (linkError) throw linkError;
    }
  }

  const version = await nextReleaseVersion(course.id);
  const { data: newRelease, error: newReleaseError } = await supabase.from("v5_releases").insert({ course_id: course.id, version, status: "published", snapshot, created_by: admin.email }).select("*").single();
  if (newReleaseError) throw newReleaseError;
  if (current.config?.published_release_id && current.config.published_release_id !== newRelease.id) {
    await supabase.from("v5_releases").update({ status: "superseded" }).eq("id", current.config.published_release_id).eq("course_id", course.id);
  }
  const { error: configError } = await supabase.from("v5_course_configs").update({ status: "published", published_release_id: newRelease.id, source_mode: snapshot.config?.source_mode || "direct", settings: snapshot.config?.settings || {}, updated_at: now }).eq("course_id", course.id);
  if (configError) throw configError;
  return { rollbackFrom: release.id, release: { id: newRelease.id, version: newRelease.version } };
}

async function listReleases(course) {
  const { data, error } = await supabase.from("v5_releases").select("id,version,status,created_by,created_at").eq("course_id", course.id).order("version", { ascending: false }).limit(30);
  if (error) throw error;
  return data || [];
}

export default async function adminV5ReleaseHandler(req, res) {
  res.setHeader("Cache-Control", "private, no-store");
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  try {
    const course = await loadCourse(req.query?.course || req.body?.course);
    if (!course) return res.status(404).json({ success: false, error: "Không tìm thấy khóa học." });
    if (req.method === "GET") {
      const { report } = await preflight(course);
      return res.status(200).json({ success: true, report, releases: await listReleases(course) });
    }
    if (req.method !== "POST") return res.status(405).json({ success: false, error: "Method not allowed" });
    const action = clean(req.body?.action);
    if (action === "preflight") {
      const { report } = await preflight(course);
      return res.status(200).json({ success: true, report, releases: await listReleases(course) });
    }
    if (action === "publish") return res.status(200).json({ success: true, ...(await publish(course, admin)) });
    if (action === "rollback") return res.status(200).json({ success: true, ...(await rollback(course, admin, req.body?.releaseId)) });
    return res.status(400).json({ success: false, error: "V5 release action không hợp lệ." });
  } catch (error) {
    console.error("[admin-v5-release]", error);
    return res.status(error?.code === "v5_preflight_failed" ? 409 : 500).json({ success: false, code: error?.code || "v5_release_failed", error: error?.message || "V5 release error", report: error?.report || null });
  }
}
