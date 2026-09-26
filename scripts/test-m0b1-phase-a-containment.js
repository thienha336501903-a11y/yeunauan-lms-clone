// scripts/test-m0b1-phase-a-containment.js
// Verification script for M0B.1 Phase A RPC Containment
// Proves that authenticated users CANNOT invoke any of the 6 privileged write RPCs directly.

import { createClient } from "@supabase/supabase-js";
import crypto from "node:crypto";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SERVICE_KEY || !ANON_KEY) {
  console.error("Missing SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, or SUPABASE_ANON_KEY");
  process.exit(1);
}

const adminClient = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

const publicClient = createClient(SUPABASE_URL, ANON_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

async function main() {
  console.log("=== M0B.1 PHASE A RPC CONTAINMENT VERIFICATION ===");
  console.log(`Target: ${SUPABASE_URL}\n`);

  const testEmail = `phase-a-test-${Date.now()}@example.com`;
  const testPassword = `TestP@ss_${crypto.randomBytes(8).toString("hex")}`;
  let userId = null;

  try {
    // 1. Create a real authenticated user
    const { data: userCreated, error: createError } = await adminClient.auth.admin.createUser({
      email: testEmail,
      password: testPassword,
      email_confirm: true
    });
    if (createError) throw createError;
    userId = userCreated.user.id;

    // 2. Sign in as authenticated user to get genuine signed JWT
    const { data: signinData, error: signinError } = await publicClient.auth.signInWithPassword({
      email: testEmail,
      password: testPassword
    });
    if (signinError) throw signinError;
    const userJwt = signinData.session.access_token;

    // Authenticated client using user's signed JWT
    const authUserClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${userJwt}` } },
      auth: { autoRefreshToken: false, persistSession: false }
    });

    const dummyUuid = "00000000-0000-0000-0000-000000000000";
    const targets = [
      {
        rpc: "checkout_agency_offering",
        params: {
          p_agency_id: dummyUuid,
          p_membership_id: dummyUuid,
          p_offering_id: dummyUuid,
          p_bank_account_id: dummyUuid,
          p_idempotency_order_code: "TEST1234"
        }
      },
      {
        rpc: "approve_agency_order",
        params: {
          p_agency_id: dummyUuid,
          p_order_id: dummyUuid,
          p_approved_by_membership_id: dummyUuid
        }
      },
      {
        rpc: "refund_agency_order",
        params: {
          p_agency_id: dummyUuid,
          p_order_id: dummyUuid,
          p_reason: "Test refund"
        }
      },
      {
        rpc: "recompute_effective_entitlement",
        params: {
          p_agency_id: dummyUuid,
          p_entitlement_id: dummyUuid
        }
      },
      {
        rpc: "submit_agency_homework",
        params: {
          p_agency_id: dummyUuid,
          p_membership_id: dummyUuid,
          p_canonical_course_id: dummyUuid,
          p_lesson_id: "test",
          p_title: "Test HW",
          p_content: {}
        }
      },
      {
        rpc: "grade_agency_homework",
        params: {
          p_agency_id: dummyUuid,
          p_staff_membership_id: dummyUuid,
          p_submission_id: dummyUuid,
          p_status: "evaluated",
          p_feedback: "Test",
          p_score: 10
        }
      }
    ];

    let allDenied = true;
    for (const t of targets) {
      const { data, error } = await authUserClient.rpc(t.rpc, t.params);
      if (error && error.message.includes("permission denied for function")) {
        console.log(`[PASS] ${t.rpc}: DENIED as expected -> "${error.message}"`);
      } else {
        console.error(`[FAIL] ${t.rpc} was NOT denied! Result:`, { data, error });
        allDenied = false;
      }
    }

    if (!allDenied) {
      console.error("\nPHASE_A_RPC_CONTAINMENT = FAIL");
      process.exit(1);
    }

    console.log("\n=======================================================");
    console.log("PHASE_A_RPC_CONTAINMENT = PASS (All 6 RPCs denied to authenticated users)");
    console.log("=======================================================");
  } finally {
    if (userId) {
      await adminClient.auth.admin.deleteUser(userId);
    }
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
