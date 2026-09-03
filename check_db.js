import { createClient } from "@supabase/supabase-js";

const SYSTEM_B_PROJECT_REF = "yyiavtiwtekkocqpephr";
const supabaseUrl = String(process.env.SUPABASE_URL || "").trim();
const supabaseKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
const email = String(process.env.CHECK_EMAIL || "").trim().toLowerCase();

function fail(message) {
  console.error(message);
  process.exit(1);
}

let projectRef = "";
try {
  projectRef = new URL(supabaseUrl).hostname.split(".")[0];
} catch {
  fail("SUPABASE_URL must be a valid URL");
}

if (projectRef !== SYSTEM_B_PROJECT_REF) fail("Refusing to query a project outside System B");
if (!supabaseKey) fail("SUPABASE_SERVICE_ROLE_KEY is required");
if (!email || !email.includes("@")) fail("CHECK_EMAIL is required");

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkStudent() {
  const [{ data: enrollments, error: enrollmentError }, { data: orders, error: orderError }, { data: courses, error: courseError }] = await Promise.all([
    supabase.from("student_enrollments").select("course_slug,status,expired_at").eq("email", email),
    supabase.from("orders").select("status,course_slug").eq("customer_email", email),
    supabase.from("courses").select("slug,title")
  ]);

  if (enrollmentError) throw enrollmentError;
  if (orderError) throw orderError;
  if (courseError) throw courseError;

  console.log("System B student diagnostic:", {
    enrollmentCount: enrollments?.length || 0,
    enrollmentStates: (enrollments || []).map(row => ({
      course: row.course_slug,
      status: row.status,
      expired: Boolean(row.expired_at && Date.parse(row.expired_at) <= Date.now())
    })),
    orderCount: orders?.length || 0,
    orderStates: (orders || []).map(row => ({ course: row.course_slug, status: row.status })),
    courseCount: courses?.length || 0
  });
}

checkStudent().catch(error => {
  console.error("System B diagnostic failed:", error?.message || "unknown_error");
  process.exitCode = 1;
});
