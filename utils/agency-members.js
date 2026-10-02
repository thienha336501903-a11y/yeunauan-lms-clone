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

  const { data: target, error: targetError } = await client
    .from("agency_memberships")
    .select("id,agency_id,user_id,role,status")
    .eq("id", membershipId)
    .eq("agency_id", auth.tenant.agencyId)
    .maybeSingle();

  if (targetError) {
    return { ok: false, status: 500, code: "agency_member_lookup_failed", error: "Unable to resolve Agency member." };
  }
  if (!target) {
    return { ok: false, status: 404, code: "agency_member_not_found", error: "Agency member not found." };
  }

  if (target.role === "agency_owner" && status !== "active") {
    const { data: otherOwners, error: ownerError } = await client
      .from("agency_memberships")
      .select("id")
      .eq("agency_id", auth.tenant.agencyId)
      .eq("role", "agency_owner")
      .eq("status", "active")
      .neq("id", target.id)
      .limit(1);
    if (ownerError) {
      return { ok: false, status: 500, code: "agency_owner_guard_failed", error: "Unable to validate Agency owner safety." };
    }
    if (!otherOwners?.length) {
      return { ok: false, status: 409, code: "agency_last_owner_protected", error: "The last active Agency owner cannot be suspended." };
    }
  }

  const { data: updated, error } = await client
    .from("agency_memberships")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", target.id)
    .eq("agency_id", auth.tenant.agencyId)
    .select("id,user_id,role,display_name,status,created_at,updated_at")
    .single();

  if (error) {
    return { ok: false, status: 500, code: "agency_member_status_update_failed", error: "Unable to update Agency member." };
  }

  return { ok: true, status: 200, member: updated };
}
