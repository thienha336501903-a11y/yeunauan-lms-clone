import { supabase } from "../supabase.js";
import { parseCookies, verifyStudentSession } from "../lms.js";
import {
  createLmsEntryToken,
  createStudentActiveSession,
  getActiveStudentSessionByEmail,
  touchStudentSession
} from "../lms-session-guard.js";

const SESSION_COOKIE = "course_session_token";
const ACTIVE_ENROLLMENT_STATUSES = new Set(["active","approved","approved_ready","approved_waiting_content","completed","da duyet"]);
const norm = value => String(value || "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
const isActive = status => ACTIVE_ENROLLMENT_STATUSES.has(norm(status));
function ip(req){return String(req.headers["x-forwarded-for"]||"").split(",")[0].trim()||String(req.headers["x-real-ip"]||"").trim()||null}

export default async function handler(req,res){
  res.setHeader("Cache-Control","no-store");
  if(req.method!=="POST") return res.status(405).json({ok:false,error:"Method not allowed"});
  try{
    const cookies=parseCookies(req);
    const session=verifyStudentSession(cookies[SESSION_COOKIE]||req.body?.sessionToken||"");
    if(!session?.email) return res.status(401).json({ok:false,error:"Bạn cần đăng nhập Gmail trước khi vào học."});
    const courseSlug=String(req.body?.course_slug||"").trim();
    const portalDeviceId=String(req.body?.portal_device_id||"").trim();
    if(!courseSlug||!portalDeviceId) return res.status(400).json({ok:false,error:"Thiếu thông tin phiên học viên."});

    const [{data:course,error:courseError},{data:enrollments,error:enrollError}]=await Promise.all([
      supabase.from("courses").select("slug,active,is_published,delivery_mode").eq("slug",courseSlug).maybeSingle(),
      supabase.from("student_enrollments").select("id,status").eq("email",String(session.email).toLowerCase()).eq("course_slug",courseSlug).limit(10)
    ]);
    if(courseError) throw courseError;if(enrollError) throw enrollError;
    if(!course||course.active===false||course.is_published!==true||String(course.delivery_mode||"lms").toLowerCase()!=="lms") return res.status(403).json({ok:false,error:"Khóa học chưa sẵn sàng để vào lớp."});
    if(!(enrollments||[]).some(row=>isActive(row.status))) return res.status(403).json({ok:false,error:"Gmail này chưa được cấp quyền học khóa này."});

    let studentSession=await getActiveStudentSessionByEmail(supabase,session.email);
    if(studentSession&&String(studentSession.portal_device_id||"")!==portalDeviceId){
      return res.status(409).json({ok:false,error:"Tài khoản đang có phiên học trên thiết bị khác. Vui lòng đăng xuất phiên cũ hoặc liên hệ Admin."});
    }
    if(studentSession) await touchStudentSession(supabase,studentSession.student_session_id);
    else studentSession=await createStudentActiveSession(supabase,{email:session.email,portalDeviceId,ip:ip(req),userAgent:req.headers["user-agent"]||null});

    const {rawToken}=await createLmsEntryToken(supabase,{email:session.email,studentSessionId:studentSession.student_session_id,portalDeviceId,courseSlug,postId:null,createdIp:ip(req),createdUserAgent:req.headers["user-agent"]||null});
    return res.status(200).json({ok:true,url:`/lms.html?entry_token=${encodeURIComponent(rawToken)}`});
  }catch(error){console.error("[legacy-entry-token]",error);return res.status(500).json({ok:false,error:"Không tạo được link vào học. Vui lòng thử lại sau."})}
}
