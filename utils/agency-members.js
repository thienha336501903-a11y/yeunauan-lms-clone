import { supabase as defaultSupabase } from "./supabase.js";
import { requireAgencyRole } from "./agency-auth.js";

const STAFF_ROLES = ["agency_owner", "agency_staff"];

function clean(value) {
  return String(value || "").trim();
}

export async function listAgencyMembers(req, options = {}) {
  const client = options.supabaseClient || defaultSupabase;
  const auth = await requireAgencyRole(req, STAFF_ROLES, options);
  if (!auth.ok) return auth;

  const { data, error } = await client
    .from("agency_memberships")
    .select("id,user_id,role,display_name,status,created_at,updated_at")
    .eq("agency_id", auth.tenant.agencyId)
    .order("created_at", { ascending: true });

  if (error) {
    return { ok: false, status: 500, code: "agency_members_list_failed", error: "Unable to list Agency members." };
  }

  return {
    ok: true,
    status: 200,
    agencyId: auth.tenant.agencyId,
    actorRole: auth.membership.role,
    members: data || []
  };
}

export async function setAgencyMemberStatus(req, payload = {}, options = {}) {
  const client = options.supabaseClient || defaultSupabase;
  const auth = await requireAgencyRole(req, ["agency_owner"], options);
  if (!auth.ok) return auth;

  const membershipId = clean(payload.membershipId);
  const status = clean(payload.status).toLowerCase();
  if (!membershipId || !["active", "suspended"].includes(status)) {
    return { ok: false, status: 400, code: "agency_member_status_invalid", error: "membershipId and active/suspended status are required." };
  }

  const { data, error } = await client.rpc("set_agency_member_status_atomic", {
    p_agency_id: auth.tenant.agencyId,
    p_actor_membership_id: auth.membership.id,
    p_target_membership_id: membershipId,
    p_status: status
  });

  if (error) {
    const message = String(error.message || "");
    const codeMatch = message.match(/(agency_[a-z0-9_]+)/i);
    const code = codeMatch ? codeMatch[1].toLowerCase() : "agency_member_status_update_failed";
    const httpStatus =
      code === "agency_last_owner_protected" ? 409 :
      code === "agency_member_not_found" ? 404 :
      code === "agency_owner_required" || code === "agency_not_active" ? 403 :
      code === "agency_member_status_invalid" ? 400 :
      500;
    return {
      ok: false,
      status: httpStatus,
      code,
      error:
        code === "agency_last_owner_protected"
          ? "The last active Agency owner cannot be suspended."
          : "Unable to update Agency member."
    };
  }

  if (!data?.ok || !data?.id) {
    return { ok: false, status: 500, code: "agency_member_status_update_failed", error: "Unable to update Agency member." };
  }

  return {
    ok: true,
    status: 200,
    member: {
      id: data.id,
      user_id: data.user_id,
      role: data.role,
      display_name: data.display_name,
      status: data.status,
      created_at: data.created_at,
      updated_at: data.updated_at
    }
  };
}
