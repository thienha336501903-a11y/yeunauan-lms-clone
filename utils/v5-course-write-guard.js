import { supabase } from "./supabase.js";

export async function assertV5CourseWritable(courseId) {
  const { data: config, error } = await supabase
    .from("v5_course_configs")
    .select("status")
    .eq("course_id", courseId)
    .maybeSingle();
  if (error) throw error;
  if (String(config?.status || "").trim().toLowerCase() === "archived") {
    const err = new Error("Khóa V5 đã Archived / Retired. Nội dung đang ở chế độ chỉ đọc.");
    err.code = "v5_course_archived";
    throw err;
  }
  return config;
}
