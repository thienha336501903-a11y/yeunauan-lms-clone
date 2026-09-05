import { supabase } from "../supabase.js";
import {
  verifyGoogleIdToken,
  verifyStudentSession,
  createStudentSession,
  parseCookies,
  cookieOptions
} from "../lms.js";
import { verifyLmsVerifiedSessionAccess } from "../lms-session-guard.js";
import { isEnrollmentExpired, isEnrollmentUsable } from "../lms-enrollment-status.js";
import { applySameOriginCors } from "../lms-request-origin.js";

const SESSION_COOKIE = "course_session_token";
function norm(value){return String(value||"").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/đ/g,"d")}
function isApprovedOrder(status){return ["da duyet","approved","active"].includes(norm(status))}
function isRejectedOrder(status){return ["tu choi","da huy","huy","rejected","cancelled","canceled"].includes(norm(status))}
async function verifyGoogleAccessToken(accessToken){const token=String(accessToken||"").trim();if(!token)return"";try{const response=await fetch("https://openidconnect.googleapis.com/v1/userinfo",{method:"GET",headers:{Authorization:"Bearer "+token}});if(!response.ok)return"";const profile=await response.json();if(!profile?.email||profile?.email_verified===false)return"";return String(profile.email).trim().toLowerCase()}catch{return""}}
function getLmsSessionHeaders(req){return{lmsSessionId:String(req.headers["x-lms-session-id"]||"").trim(),lmsDeviceId:String(req.headers["x-lms-device-id"]||"").trim()}}
async function resolveEmail(req){const{credential,accessToken,sessionToken}=req.body||{};const cookies=parseCookies(req);const token=String(sessionToken||cookies[SESSION_COOKIE]||"").trim();const lmsHeaders=getLmsSessionHeaders(req);if(credential){const email=String(await verifyGoogleIdToken(credential)||"").trim().toLowerCase();if(email)return email}if(accessToken){const email=await verifyGoogleAccessToken(accessToken);if(email)return email}if(lmsHeaders.lmsSessionId&&lmsHeaders.lmsDeviceId){const access=await verifyLmsVerifiedSessionAccess(supabase,{...lmsHeaders,courseSlug:null});if(access?.ok&&access.email)return String(access.email).trim().toLowerCase()}if(token){const decoded=verifyStudentSession(token);if(decoded?.email)return String(decoded.email).trim().toLowerCase()}return""}

export default async function handler(req,res){
  const originAllowed=applySameOriginCors(req,res,{methods:"POST, OPTIONS",headers:"Content-Type, X-LMS-Session-Id, X-LMS-Device-Id"});res.setHeader("Cache-Control","no-store");
  if(!originAllowed)return res.status(403).json({success:false,authError:"origin_not_allowed",error:"Origin not allowed"});
  if(req.method==="OPTIONS")return res.status(200).end();if(req.method!=="POST")return res.status(405).json({success:false,error:"Method not allowed"});
  try{
    const email=await resolveEmail(req);if(!email)return res.status(401).json({success:false,authError:"missing_login_session",error:"Missing or expired login session"});
    const[{data:orders,error:orderError},{data:enrollments,error:enrollmentError}]=await Promise.all([
      supabase.from("orders").select("id,course_slug,course_title,status,delivery_mode,created_at,updated_at").eq("customer_email",email).order("created_at",{ascending:false}),
      supabase.from("student_enrollments").select("course_slug,status,expired_at,drive_permission_status,created_at,updated_at").eq("email",email)
    ]);if(orderError)throw orderError;if(enrollmentError)throw enrollmentError;
    const latestOrderBySlug=new Map();for(const order of orders||[]){const slug=String(order.course_slug||"").trim();if(slug&&!latestOrderBySlug.has(slug))latestOrderBySlug.set(slug,order)}
    const enrollmentBySlug=new Map();for(const enrollment of enrollments||[]){const slug=String(enrollment.course_slug||"").trim();if(!slug)continue;const existing=enrollmentBySlug.get(slug);if(!existing||new Date(enrollment.updated_at||enrollment.created_at||0)>new Date(existing.updated_at||existing.created_at||0))enrollmentBySlug.set(slug,enrollment)}
    const slugs=[...new Set([...latestOrderBySlug.keys(),...enrollmentBySlug.keys()])];let courseRows=[];if(slugs.length){const{data,error}=await supabase.from("courses").select("slug,title,image_url,description,active,is_published,delivery_mode,expected_start_date,created_at,raw_data").in("slug",slugs);if(error)throw error;courseRows=data||[]}
    const courseBySlug=new Map(courseRows.map(row=>[String(row.slug||"").trim(),row]));
    const courses=slugs.map(slug=>{const order=latestOrderBySlug.get(slug)||null,enrollment=enrollmentBySlug.get(slug)||null,course=courseBySlug.get(slug)||{},raw=course.raw_data||{},enrollmentActive=Boolean(enrollment&&isEnrollmentUsable(enrollment)),enrollmentExpired=Boolean(enrollment&&isEnrollmentExpired(enrollment.expired_at)),orderApproved=Boolean(order&&isApprovedOrder(order.status)),orderRejected=Boolean(order&&isRejectedOrder(order.status)),ready=enrollmentActive&&course.active!==false&&course.is_published===true;let state="pending_approval";if(enrollmentExpired)state="inactive";else if(ready)state="ready";else if(enrollmentActive||orderApproved)state="approved_waiting_content";else if(orderRejected)state="rejected";else if(!order&&enrollment)state=enrollmentActive?"approved_waiting_content":"inactive";const title=String(raw.studentDisplayTitle||course.title||order?.course_title||slug).trim()||slug;const description=String(raw.studentDisplayDescription||course.description||"").trim();return{slug,title,description,imageUrl:String(course.image_url||""),deliveryMode:String(course.delivery_mode||order?.delivery_mode||"lms"),isPublished:course.is_published===true,active:course.active!==false,originalLessonEntryVisible:raw.originalLessonEntryVisible!==false,expectedStartDate:course.expected_start_date||null,createdAt:course.created_at||order?.created_at||enrollment?.created_at||null,orderStatus:order?.status||null,enrollmentStatus:enrollment?.status||null,expiredAt:enrollment?.expired_at||null,driveStatus:enrollment?.drive_permission_status||null,state,updatedAt:order?.updated_at||enrollment?.updated_at||order?.created_at||enrollment?.created_at||null}}).sort((a,b)=>new Date(b.updatedAt||0)-new Date(a.updatedAt||0));
    const newSession=createStudentSession(email);res.setHeader("Set-Cookie",`${SESSION_COOKIE}=${encodeURIComponent(newSession.token)}; ${cookieOptions(newSession.expiresAt-Date.now())}`);return res.status(200).json({success:true,email,courses,sessionToken:newSession.token,sessionExpiresAt:newSession.expiresAt});
  }catch(error){console.error("[student-dashboard]",error);return res.status(500).json({success:false,error:"Server error"})}
}
