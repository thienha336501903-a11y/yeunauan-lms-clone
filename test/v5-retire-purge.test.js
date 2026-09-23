process.env.SUPABASE_URL = process.env.SUPABASE_URL || "https://mock.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "mock-service-role-key";

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const {
  TERMINAL_ORDER_STATUSES,
  TERMINAL_JOB_STATUSES,
  TERMINAL_UPLOAD_STATUSES,
  computeRetirePlanHash,
  evaluateRetirePurgeEligibility,
  statusCounts
} = await import("../utils/v5-retire-purge.js");

const migrationSql = fs.readFileSync(new URL("../supabase/migrations/20260923143000_v5_retire_purge_content.sql", import.meta.url), "utf8");
const handlerSource = fs.readFileSync(new URL("../utils/lms-handlers/admin-v5-course-retire-purge.js", import.meta.url), "utf8");
const adminSource = fs.readFileSync(new URL("../v5-admin.html", import.meta.url), "utf8");
const accessSource = fs.readFileSync(new URL("../utils/v4-telegram-access.js", import.meta.url), "utf8");
const contentSource = fs.readFileSync(new URL("../utils/lms-handlers/admin-v5-content.js", import.meta.url), "utf8");
const uploadSource = fs.readFileSync(new URL("../utils/lms-handlers/admin-v5-upload.js", import.meta.url), "utf8");
const releaseSource = fs.readFileSync(new URL("../utils/lms-handlers/admin-v5-release.js", import.meta.url), "utf8");
const telegramSource = fs.readFileSync(new URL("../utils/lms-handlers/admin-v5-telegram-import-scoped.js", import.meta.url), "utf8");

const courseId = "e3f4698f-846d-4b8f-9c02-40a729fdf2ed";
function course(overrides={}) {
  return { id:courseId, slug:"banh-bao-kinh-doanh-2026", delivery_mode:"v5", active:true, is_published:true, updated_at:"2026-09-23T00:00:00Z", ...overrides };
}
function config(overrides={}) {
  return { status:"published", published_release_id:"af998bc3-a760-4d73-a0f1-ff0f8884a192", ...overrides };
}
function eligibleArgs(overrides={}) {
  return {
    course:course(),
    config:config(),
    orders:[{id:"o1",status:"Đã duyệt"}],
    jobs:[],
    uploads:[{id:"u1",status:"completed"}],
    v4Sources:[],
    courseAssets:[{id:"a1",r2_object_key:"media/v5/"+courseId+"/a1/file.mp4"}],
    missingAssetRefs:[],
    sharedPostAssets:[],
    sharedSourceMappings:[],
    sharedJobs:[],
    sharedUploadSessions:[],
    sharedReleaseAssets:[],
    sharedThumbnailAssets:[],
    r2Configured:true,
    r2Verified:true,
    ...overrides
  };
}

test("1. approved order is terminal",()=>assert.equal(TERMINAL_ORDER_STATUSES.has("Đã duyệt"),true));
test("2. rejected order is terminal",()=>assert.equal(TERMINAL_ORDER_STATUSES.has("Từ chối"),true));
test("3. pending order is not terminal",()=>assert.equal(TERMINAL_ORDER_STATUSES.has("Chờ duyệt"),false));
test("4. target-style published course is eligible",()=>{
  const r=evaluateRetirePurgeEligibility(eligibleArgs());
  assert.equal(r.eligible,true); assert.deepEqual(r.blockedReasons,[]);
});
test("5. pending order blocks",()=>{
  const r=evaluateRetirePurgeEligibility(eligibleArgs({orders:[{status:"Chờ duyệt"}]}));
  assert.equal(r.eligible,false); assert.match(r.blockedReasons.join(" "),/đơn hàng/i);
});
test("6. unknown order status blocks",()=>assert.equal(evaluateRetirePurgeEligibility(eligibleArgs({orders:[{status:"mystery"}]})).eligible,false));
test("7. running job blocks",()=>{
  const r=evaluateRetirePurgeEligibility(eligibleArgs({jobs:[{status:"running"}]}));
  assert.equal(r.eligible,false); assert.match(r.blockedReasons.join(" "),/job/i);
});
test("8. success failed cancelled jobs terminal",()=>{
  for(const s of ["success","failed","cancelled","canceled"]) assert.equal(TERMINAL_JOB_STATUSES.has(s),true);
});
test("9. active upload blocks",()=>{
  const r=evaluateRetirePurgeEligibility(eligibleArgs({uploads:[{status:"uploading",expires_at:new Date(Date.now()+60000).toISOString()}]}));
  assert.equal(r.eligible,false); assert.match(r.blockedReasons.join(" "),/upload/i);
});
test("10. completed aborted expired uploads terminal",()=>{
  for(const s of ["completed","aborted","expired"]) assert.equal(TERMINAL_UPLOAD_STATUSES.has(s),true);
});
test("11. V4 mapping blocks",()=>assert.equal(evaluateRetirePurgeEligibility(eligibleArgs({v4Sources:[{source_id:"x"}]})).eligible,false));
test("12. missing referenced asset blocks",()=>assert.equal(evaluateRetirePurgeEligibility(eligibleArgs({missingAssetRefs:["a2"]})).eligible,false));
test("13. outside namespace asset blocks",()=>assert.equal(evaluateRetirePurgeEligibility(eligibleArgs({courseAssets:[{id:"a",r2_object_key:"media/v5/other/file.mp4"}]})).eligible,false));
test("14. shared post asset blocks",()=>assert.equal(evaluateRetirePurgeEligibility(eligibleArgs({sharedPostAssets:["a1"]})).eligible,false));
test("15. shared source asset blocks",()=>assert.equal(evaluateRetirePurgeEligibility(eligibleArgs({sharedSourceMappings:["a1"]})).eligible,false));
test("16. shared job asset blocks",()=>assert.equal(evaluateRetirePurgeEligibility(eligibleArgs({sharedJobs:["a1"]})).eligible,false));
test("17. shared upload asset blocks",()=>assert.equal(evaluateRetirePurgeEligibility(eligibleArgs({sharedUploadSessions:["a1"]})).eligible,false));
test("18. shared release asset blocks",()=>assert.equal(evaluateRetirePurgeEligibility(eligibleArgs({sharedReleaseAssets:["a1"]})).eligible,false));
test("19. shared thumbnail asset blocks",()=>assert.equal(evaluateRetirePurgeEligibility(eligibleArgs({sharedThumbnailAssets:["a1"]})).eligible,false));
test("20. R2 unavailable blocks",()=>assert.equal(evaluateRetirePurgeEligibility(eligibleArgs({r2Configured:false,r2Verified:false})).eligible,false));
test("21. R2 unverified blocks",()=>assert.equal(evaluateRetirePurgeEligibility(eligibleArgs({r2Verified:false})).eligible,false));
test("22. non-V5 course blocks",()=>assert.equal(evaluateRetirePurgeEligibility(eligibleArgs({course:course({delivery_mode:"v4"})})).eligible,false));
test("23. non-published config cannot start",()=>{
  for(const status of ["draft","archived","ready"]) assert.equal(evaluateRetirePurgeEligibility(eligibleArgs({config:config({status})})).eligible,false);
});
test("24. missing published release blocks",()=>assert.equal(evaluateRetirePurgeEligibility(eligibleArgs({config:config({published_release_id:null})})).eligible,false));

test("25. plan hash deterministic across input ordering",()=>{
  const p={courseId,slug:"banh-bao-kinh-doanh-2026",courseUpdatedAt:"x",active:true,isPublished:true,configStatus:"published",publishedReleaseId:"r1",releaseIds:["r2","r1"],orderStatusCounts:{"Đã duyệt":1},assetIds:["b","a"],registeredR2Keys:["z","x"],courseNamespace:"media/v5/"+courseId+"/"};
  assert.equal(computeRetirePlanHash(p),computeRetirePlanHash({...p,releaseIds:["r1","r2"],assetIds:["a","b"],registeredR2Keys:["x","z"]}));
});
test("26. plan hash changes when course touched",()=>{
  const p={courseId,slug:"s",courseUpdatedAt:"1",configStatus:"published",releaseIds:["r1"],courseNamespace:"media/v5/"+courseId+"/"};
  assert.notEqual(computeRetirePlanHash(p),computeRetirePlanHash({...p,courseUpdatedAt:"2"}));
});
test("27. status counts preserve real taxonomy",()=>assert.deepEqual(statusCounts([{status:"Đã duyệt"},{status:"Đã duyệt"},{status:"Từ chối"}]),{"Đã duyệt":2,"Từ chối":1}));

test("28. migration creates durable operation table",()=>{
  assert.match(migrationSql,/create table if not exists public\.v5_course_retire_operations/i);
  assert.match(migrationSql,/r2_verified_empty/);
  assert.match(migrationSql,/completed_at timestamptz/);
});
test("29. operation table is service-only",()=>{
  assert.match(migrationSql,/enable row level security/i);
  assert.match(migrationSql,/revoke all on table public\.v5_course_retire_operations from authenticated/i);
  assert.match(migrationSql,/grant select, insert, update, delete on table public\.v5_course_retire_operations to service_role/i);
});
test("30. begin retires sale and archives config without deleting course",()=>{
  assert.match(migrationSql,/update public\.courses\s+set active = false/i);
  assert.match(migrationSql,/status = 'archived'/);
  assert.match(migrationSql,/published_release_id = null/);
  assert.doesNotMatch(migrationSql,/delete from public\.courses/i);
});
test("31. migration never deletes orders or enrollments",()=>{
  assert.doesNotMatch(migrationSql,/delete from public\.orders/i);
  assert.doesNotMatch(migrationSql,/delete from public\.student_enrollments/i);
});
test("32. migration never deletes Telegram source history",()=>{
  assert.doesNotMatch(migrationSql,/delete from public\.tgcloner_sources/i);
  assert.doesNotMatch(migrationSql,/delete from public\.tgcloner_source_messages/i);
});
test("33. SQL blocks nonterminal orders",()=>{
  assert.match(migrationSql,/not in \('Đã duyệt', 'Từ chối'\)/);
  assert.match(migrationSql,/v5_retire_has_nonterminal_order/);
});
test("34. begin/finalize include cross-course ownership guards",()=>{
  for(const code of ["shared_post","shared_source","shared_job","shared_upload","shared_release","shared_thumbnail"]) assert.match(migrationSql,new RegExp(code));
  assert.match(migrationSql,/v5_retire_finalize_shared_post_asset/);
});
test("35. release delete capability is narrow and clone path retained",()=>{
  assert.match(migrationSql,/v5_clone_factory_cleanup_allowed\(old\.course_id\)[\s\S]*v5_retire_purge_release_delete_allowed\(old\.course_id\)/i);
  assert.match(migrationSql,/o\.status in \('r2_verified_empty', 'finalizing'\)/);
  assert.match(migrationSql,/cfg\.status = 'archived'/);
});
test("36. release UPDATE immutability remains",()=>{
  assert.match(migrationSql,/raise exception 'v5_release_immutable'/);
  assert.match(migrationSql,/old\.status = 'published' and new\.status = 'superseded'/);
  assert.match(migrationSql,/v5_release_status_transition_forbidden/);
});
test("37. finalize requires R2 verified empty",()=>{
  assert.match(migrationSql,/if v_op\.status <> 'r2_verified_empty'/);
  assert.match(migrationSql,/v5_retire_r2_not_verified_empty/);
});
test("38. finalize archives releases before deletion",()=>{
  assert.match(migrationSql,/release_archive=v_release_archive/);
  assert.match(migrationSql,/delete from public\.v5_releases where course_id=p_course_id/);
});
test("39. finalize purges V5 content/media and preserves config",()=>{
  assert.match(migrationSql,/delete from public\.v5_posts/);
  assert.match(migrationSql,/delete from public\.v5_lessons/);
  assert.match(migrationSql,/delete from public\.v5_media_assets/);
  assert.match(migrationSql,/update public\.v5_course_configs[\s\S]*content_purged_at/);
  assert.doesNotMatch(migrationSql,/delete from public\.v5_course_configs/i);
});
test("40. new RPCs are service-role only",()=>{
  assert.match(migrationSql,/grant execute on function public\.begin_v5_course_retire_purge[\s\S]*to service_role/i);
  assert.match(migrationSql,/grant execute on function public\.finalize_v5_course_retire_purge[\s\S]*to service_role/i);
});

test("41. handler uses exact UUID namespace and bounded batches",()=>{
  assert.match(handlerSource,/media\/v5\/\$\{courseId\}\//);
  assert.match(handlerSource,/const MAX_OBJECTS_PER_PASS = 100/);
  assert.match(handlerSource,/const CONCURRENCY = 8/);
});
test("42. browser cannot supply R2 key list",()=>{
  assert.doesNotMatch(handlerSource,/req\.body\?\.(?:keys|r2Keys|objectKeys)/);
  assert.match(handlerSource,/page\.objects\.map\(obj => obj\.key\)/);
});
test("43. handler fresh-lists R2 before finalize",()=>{
  assert.match(handlerSource,/const remaining = await listAllR2Objects\(\{ prefix \}\)/);
  assert.match(handlerSource,/code: "r2_not_empty"/);
});
test("44. preview response excludes raw manifest/keys",()=>{
  const a=handlerSource.indexOf('if (action === "preview")');
  const b=handlerSource.indexOf('if (action === "begin")');
  const block=handlerSource.slice(a,b);
  assert.doesNotMatch(block,/manifest:/);
  assert.doesNotMatch(block,/registered_r2_keys/);
});
test("45. learner access is still gated by is_published",()=>{
  assert.match(accessSource,/if \(!course\?\.is_published\)/);
  assert.match(accessSource,/code: "course_not_ready"/);
});
test("46. archived content writes blocked",()=>assert.match(contentSource,/assertV5CourseWritable\(course\.id\)/));
test("47. archived upload writes blocked",()=>assert.match(uploadSource,/assertV5CourseWritable\(course\.id\)/));
test("48. archived release writes blocked",()=>assert.match(releaseSource,/assertV5CourseWritable\(course\.id\)/));
test("49. archived Telegram mutations blocked",()=>assert.match(telegramSource,/assertV5CourseWritable\(course\.id\)/));

test("50. UI exposes distinct Retire Purge action",()=>{
  assert.match(adminSource,/Ngừng khóa & dọn nội dung/);
  assert.match(adminSource,/NGỪNG KHÓA & DỌN NỘI DUNG V5/);
});
test("51. UI says business history retained",()=>{
  assert.match(adminSource,/Đơn hàng:[\s\S]*GIỮ NGUYÊN/);
  assert.match(adminSource,/Ghi danh:[\s\S]*GIỮ NGUYÊN/);
});
test("52. UI requires exact slug and checkbox",()=>{
  assert.match(adminSource,/retireConfirmationSlugInput/);
  assert.match(adminSource,/retireConfirmCheckbox/);
});
test("53. UI supports safe resume",()=>{
  assert.match(adminSource,/Cleanup chưa hoàn tất — có thể tiếp tục an toàn/);
  assert.match(adminSource,/TIẾP TỤC DỌN/);
});
test("54. completed archived course is read-only",()=>{
  assert.match(adminSource,/Archived \/ Retired/);
  assert.match(adminSource,/content_purged_at/);
  assert.match(adminSource,/isCourseArchived/);
});
