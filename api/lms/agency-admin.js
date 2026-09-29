// api/lms/agency-admin.js
// M0D Agency-only administrative entrypoint.
// This route is intentionally separate from api/lms/admin.js so Legacy/System A
// admin behavior remains unchanged until formal M0E retirement.

import { resolveRequestRoute } from "../../utils/agency-routing.js";
import { requireAgencyRole } from "../../utils/agency-auth.js";
import {
  approveAgencyOrder,
  refundAgencyOrder
} from "../../utils/agency-commerce.js";

const ADMIN_ROLES = ["agency_staff", "agency_owner"];

function clean(value) {
  return String(value || "").trim();
}

function sendResult(res, result) {
  if (!result?.ok) {
    return res.status(result?.status || 500).json({
      success: false,
      code: result?.code || "agency_admin_error",
      error: result?.error || "Agency admin request failed."
    });
  }
  return res.status(result.status || 200).json({ success: true, ...result });
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store");

  const options = req.__options || {};
  const endpoint = clean(req.query?.endpoint);

  // Resolve the current request host before any admin action. There is no
  // fallback to the historical LMS admin dispatcher from this entrypoint.
  const routeDecision = await resolveRequestRoute(req, options);
  if (routeDecision.route === "DENY") {
    return res.status(routeDecision.status || 403).json({
      success: false,
      code: routeDecision.code,
      error: routeDecision.error
    });
  }

  // Keep the Agency branch explicit so M0D can audit the exact execution
  // surface independently from all Legacy admin handlers.
  if (routeDecision.route === "AGENCY") {
    if (endpoint === "profile") {
      if (req.method !== "GET") {
        return res.status(405).json({ success: false, code: "method_not_allowed", error: "Method not allowed." });
      }

      const roleResult = await requireAgencyRole(req, ADMIN_ROLES, options);
      if (!roleResult.ok) return sendResult(res, roleResult);

      const { tenant, membership, user } = roleResult;
      return res.status(200).json({
        success: true,
        agency: {
          id: tenant.agencyId,
          slug: tenant.agencySlug,
          name: tenant.agencyName,
          hostname: tenant.hostname
        },
        member: {
          id: membership.id,
          userId: user.id,
          email: user.email || "",
          displayName: membership.display_name,
          role: membership.role,
          status: membership.status
        }
      });
    }

    if (endpoint === "order-approve") {
      if (req.method !== "POST") {
        return res.status(405).json({ success: false, code: "method_not_allowed", error: "Method not allowed." });
      }

      const orderId = clean(req.body?.orderId || req.query?.orderId);
      if (!orderId) {
        return res.status(400).json({ success: false, code: "missing_order_id", error: "orderId is required." });
      }

      const result = await approveAgencyOrder(req, orderId, options);
      return sendResult(res, result);
    }

    if (endpoint === "order-refund") {
      if (req.method !== "POST") {
        return res.status(405).json({ success: false, code: "method_not_allowed", error: "Method not allowed." });
      }

      const orderId = clean(req.body?.orderId || req.query?.orderId);
      if (!orderId) {
        return res.status(400).json({ success: false, code: "missing_order_id", error: "orderId is required." });
      }

      const reason = clean(req.body?.reason) || "Customer refund";
      const result = await refundAgencyOrder(req, orderId, reason, options);
      return sendResult(res, result);
    }

    return res.status(404).json({
      success: false,
      code: "agency_admin_endpoint_not_found",
      error: "Requested Agency admin endpoint is not supported."
    });
  }

  // Explicit Legacy hosts are intentionally NOT delegated to api/lms/admin.js.
  return res.status(404).json({
    success: false,
    code: "agency_admin_not_available",
    error: "Agency admin endpoints are available only on an active Agency domain."
  });
}
