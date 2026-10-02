import crypto from "node:crypto";
import { supabase as defaultSupabase } from "./supabase.js";
import { getLegacyHostAllowlist } from "./agency-routing.js";
import {
  buildAtomicManifest,
  factoryManifestHash,
  factoryManifestSummary,
  normalizeFactoryManifest,
  providerReadinessBlockers
} from "./agency-factory-manifest.js";
import { prepareAuthPrincipal } from "./agency-auth-principals.js";

function clean(value) {
  return String(value || "").trim();
}

function safeCode(error, fallback = "factory_operation_failed") {
  const message = clean(error?.message);
  const match = message.match(/([a-z][a-z0-9_]{3,})/i);
  return match ? match[1].slice(0, 80) : fallback;
}

function opaqueResourceId(value) {
  return clean(value);
}

async function updateRun(client, runId, patch, expectedRevision = null) {
  let query = client
    .from("agency_provisioning_runs")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", runId);

  if (expectedRevision !== null) query = query.eq("revision", expectedRevision);

  const { data, error } = await query.select("*").maybeSingle();
  if (error) throw error;
  if (!data) {
    const stale = new Error("factory_stale_revision");
    stale.code = "factory_stale_revision";
    throw stale;
  }
  return data;
}

export async function getFactoryRun(runId, options = {}) {
  const client = options.supabaseClient || defaultSupabase;
  const id = clean(runId);
  if (!id) return { ok: false, status: 400, code: "factory_run_id_required" };

  const { data, error } = await client
    .from("agency_provisioning_runs")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) return { ok: false, status: 500, code: "factory_run_lookup_failed" };
  if (!data) return { ok: false, status: 404, code: "factory_run_not_found" };
  return { ok: true, run: data };
}

async function checkLearningReadiness(client, normalized) {
  if (normalized.profile === "TENANT_SHELL") return [];

  const blockers = [];
  for (const course of normalized.learning.courses) {
    const code = clean(course?.code);
    const courseId = clean(course?.course_id);
    if (!code || !courseId) {
      blockers.push("learning_course_reference_incomplete");
      continue;
    }

    const { data: canonical, error: canonicalError } = await client
      .from("canonical_courses")
      .select("id,code,course_id")
      .eq("code", code)
      .maybeSingle();
    if (canonicalError) throw canonicalError;
    if (canonical?.course_id && String(canonical.course_id) !== courseId) {
      blockers.push(`canonical_mapping_conflict:${code}`);
      continue;
    }

    const { data: config, error: configError } = await client
      .from("v5_course_configs")
      .select("course_id,status,published_release_id")
      .eq("course_id", courseId)
      .maybeSingle();
    if (configError) throw configError;
    if (!config || config.status !== "published" || !config.published_release_id) {
      blockers.push(`v5_release_not_ready:${code}`);
      continue;
    }

    const { data: release, error: releaseError } = await client
      .from("v5_releases")
      .select("id,status,snapshot")
      .eq("id", config.published_release_id)
      .eq("course_id", courseId)
      .eq("status", "published")
      .maybeSingle();
    if (releaseError) throw releaseError;
    if (!release?.snapshot) {
      blockers.push(`v5_release_snapshot_missing:${code}`);
      continue;
    }

    const releaseLessonIds = new Set(
      (Array.isArray(release.snapshot?.lessons) ? release.snapshot.lessons : [])
        .map(lesson => clean(lesson?.id))
        .filter(Boolean)
    );
    for (const lesson of Array.isArray(course?.lessons) ? course.lessons : []) {
      const lessonId = clean(lesson?.v5_lesson_id);
      if (!lessonId || !releaseLessonIds.has(lessonId)) {
        blockers.push(`v5_lesson_not_in_release:${code}`);
        break;
      }
    }
  }
  return blockers;
}

export async function preflightFactoryManifest(manifest, options = {}) {
  const client = options.supabaseClient || defaultSupabase;
  const normalized = normalizeFactoryManifest(manifest);
  const blockers = [];
  const checks = {
    manifest: "PASS",
    domains: "PENDING",
    principals: "PENDING",
    learning: normalized.profile === "TENANT_SHELL" ? "N/A" : "PENDING",
    provider: "PENDING"
  };

  const legacyHosts = new Set(getLegacyHostAllowlist());
  const { data: existingAgency, error: agencyError } = await client
    .from("agencies")
    .select("id,slug,status")
    .eq("slug", normalized.agency.slug)
    .maybeSingle();
  if (agencyError) throw agencyError;
  const targetAgencyId = existingAgency?.id || null;

  for (const domain of normalized.domains) {
    if (legacyHosts.has(domain.hostname)) blockers.push(`legacy_host_overlap:${domain.surface}`);
    const { data: collision, error } = await client
      .from("agency_domains")
      .select("agency_id,hostname,surface,status")
      .eq("hostname", domain.hostname)
      .maybeSingle();
    if (error) throw error;
    if (collision && String(collision.agency_id) !== String(targetAgencyId || "")) {
      blockers.push(`domain_ownership_conflict:${domain.surface}`);
    }
  }
  checks.domains = blockers.some(item => item.includes("host_") || item.includes("domain_")) ? "FAIL" : "PASS";

  for (const principal of normalized.principals) {
    const result = await prepareAuthPrincipal(client, principal, { mode: "reuse_only", allowCreate: false });
    if (!result.ok) blockers.push(`principal_not_prepared:${principal.role}`);
  }
  checks.principals = blockers.some(item => item.startsWith("principal_")) ? "BLOCKED_OPERATOR_ACTION" : "PASS";

  const learningBlockers = await checkLearningReadiness(client, normalized);
  blockers.push(...learningBlockers);
  if (normalized.profile !== "TENANT_SHELL") {
    checks.learning = learningBlockers.length ? "BLOCKED_OPERATOR_ACTION" : "PASS";
  }

  const providerBlockers = providerReadinessBlockers(normalized);
  blockers.push(...providerBlockers);
  checks.provider = providerBlockers.length ? "BLOCKED_OPERATOR_ACTION" : "PASS";

  return {
    ok: blockers.length === 0,
    status: blockers.length ? 409 : 200,
    code: blockers.length ? "factory_preflight_blocked" : "factory_preflight_ready",
    profile: normalized.profile,
    slug: normalized.agency.slug,
    manifestHash: factoryManifestHash(normalized),
    checks,
    blockers
  };
}

export async function createFactoryRun({
  manifest,
  idempotencyKey,
  actorRef,
  sourceLmsSha = "",
  sourceCommerceSha = ""
}, options = {}) {
  const client = options.supabaseClient || defaultSupabase;
  const normalized = normalizeFactoryManifest(manifest);
  const manifestHash = factoryManifestHash(normalized);
  const key = clean(idempotencyKey);

  if (!/^[A-Za-z0-9:_-]{16,160}$/.test(key)) {
    return { ok: false, status: 400, code: "factory_invalid_idempotency_key" };
  }
  if (!clean(actorRef)) {
    return { ok: false, status: 400, code: "factory_actor_required" };
  }

  const { data: existing, error: existingError } = await client
    .from("agency_provisioning_runs")
    .select("*")
    .eq("idempotency_key", key)
    .maybeSingle();
  if (existingError) throw existingError;

  if (existing) {
    if (
      existing.manifest_hash !== manifestHash ||
      existing.target_slug !== normalized.agency.slug ||
      existing.actor_ref !== actorRef
    ) {
      return { ok: false, status: 409, code: "factory_idempotency_ownership_conflict" };
    }
    return { ok: true, idempotent: true, run: existing, manifest: normalized };
  }

  const { data: created, error } = await client
    .from("agency_provisioning_runs")
    .insert({
      idempotency_key: key,
      target_slug: normalized.agency.slug,
      profile: normalized.profile,
      phase: "DRAFT",
      manifest_version: normalized.version,
      manifest_hash: manifestHash,
      manifest_summary: factoryManifestSummary(normalized),
      actor_ref: actorRef,
      provider_readiness: normalized.provider_readiness,
      source_lms_sha: clean(sourceLmsSha) || null,
      source_commerce_sha: clean(sourceCommerceSha) || null
    })
    .select("*")
    .single();

  if (error) throw error;
  return { ok: true, idempotent: false, run: created, manifest: normalized };
}

export async function prepareFactoryPrincipals(runId, manifest, actorRef, options = {}) {
  const client = options.supabaseClient || defaultSupabase;
  const normalized = normalizeFactoryManifest(manifest);
  const lookup = await getFactoryRun(runId, { supabaseClient: client });
  if (!lookup.ok) return lookup;
  const run = lookup.run;

  if (run.actor_ref !== actorRef || run.manifest_hash !== factoryManifestHash(normalized)) {
    return { ok: false, status: 409, code: "factory_run_binding_mismatch" };
  }

  const mode = options.allowCreate === true ? "create_if_missing" : "reuse_only";
  const prepared = [];
  for (const principal of normalized.principals) {
    const result = await prepareAuthPrincipal(client, principal, {
      mode,
      allowCreate: options.allowCreate === true
    });
    if (!result.ok) {
      return { ...result, ok: false, principalRole: principal.role };
    }
    prepared.push({
      user_id: opaqueResourceId(result.user.id),
      role: principal.role,
      created: result.created === true,
      reused: result.reused === true
    });
  }

  const stepResults = {
    ...(run.step_results || {}),
    principals: {
      status: "PASS",
      count: prepared.length,
      created: prepared.filter(item => item.created).length,
      reused: prepared.filter(item => item.reused).length,
      at: new Date().toISOString()
    }
  };
  const resourceLedger = {
    ...(run.resource_ledger || {}),
    principals: prepared
  };

  const updated = await updateRun(
    client,
    run.id,
    {
      step_results: stepResults,
      resource_ledger: resourceLedger,
      revision: Number(run.revision) + 1
    },
    Number(run.revision)
  );

  return { ok: true, run: updated, principals: prepared };
}

export async function applyFactoryRun(runId, manifest, actorRef, options = {}) {
  const client = options.supabaseClient || defaultSupabase;
  const normalized = normalizeFactoryManifest(manifest);
  const hash = factoryManifestHash(normalized);
  const atomicManifest = buildAtomicManifest(normalized);
  const lookup = await getFactoryRun(runId, { supabaseClient: client });
  if (!lookup.ok) return lookup;

  const run = lookup.run;
  if (run.actor_ref !== actorRef || run.manifest_hash !== hash) {
    return { ok: false, status: 409, code: "factory_run_binding_mismatch" };
  }
  if (run.phase === "ACTIVE") {
    return { ok: true, idempotent: true, run, agencyId: run.agency_id };
  }

  try {
    const { data, error } = await client.rpc("provision_agency_factory_v1_atomic", {
      p_run_id: run.id,
      p_manifest: atomicManifest,
      p_manifest_hash: hash,
      p_profile: normalized.profile,
      p_actor_ref: actorRef
    });
    if (error) throw error;

    const after = await getFactoryRun(run.id, { supabaseClient: client });
    return {
      ok: true,
      idempotent: Boolean(run.agency_id),
      result: data,
      run: after.ok ? after.run : run
    };
  } catch (error) {
    try {
      const current = await getFactoryRun(run.id, { supabaseClient: client });
      if (current.ok && current.run.phase !== "ACTIVE") {
        await updateRun(
          client,
          run.id,
          {
            phase: "BLOCKED",
            last_error_code: safeCode(error),
            revision: Number(current.run.revision) + 1
          },
          Number(current.run.revision)
        );
      }
    } catch {
      // Preserve the original apply error; the durable DB transaction still rolled back.
    }
    return { ok: false, status: 409, code: safeCode(error), error: "Factory staged apply failed." };
  }
}

export async function validateFactoryRun(runId, manifest, actorRef, options = {}) {
  const client = options.supabaseClient || defaultSupabase;
  const normalized = normalizeFactoryManifest(manifest);
  const hash = factoryManifestHash(normalized);
  const lookup = await getFactoryRun(runId, { supabaseClient: client });
  if (!lookup.ok) return lookup;
  const run = lookup.run;

  if (run.actor_ref !== actorRef || run.manifest_hash !== hash) {
    return { ok: false, status: 409, code: "factory_run_binding_mismatch" };
  }
  if (!run.agency_id) return { ok: false, status: 409, code: "factory_agency_not_applied" };

  const blockers = [];
  const { data: agency, error: agencyError } = await client
    .from("agencies")
    .select("id,slug,status")
    .eq("id", run.agency_id)
    .maybeSingle();
  if (agencyError) throw agencyError;
  if (!agency || agency.slug !== normalized.agency.slug) blockers.push("agency_identity_mismatch");
  if (agency && !["suspended", "active"].includes(agency.status)) blockers.push("agency_runtime_state_invalid");

  for (const domain of normalized.domains) {
    const { data, error } = await client
      .from("agency_domains")
      .select("agency_id,hostname,surface,status,ssl_status,is_primary")
      .eq("hostname", domain.hostname)
      .maybeSingle();
    if (error) throw error;
    if (
      !data ||
      String(data.agency_id) !== String(run.agency_id) ||
      data.surface !== domain.surface ||
      data.status !== "active" ||
      data.ssl_status !== "active" ||
      data.is_primary !== true
    ) {
      blockers.push(`domain_not_ready:${domain.surface}`);
    }
  }

  for (const principal of normalized.principals) {
    const prepared = await prepareAuthPrincipal(client, principal, { mode: "reuse_only", allowCreate: false });
    if (!prepared.ok) {
      blockers.push(`principal_not_ready:${principal.role}`);
      continue;
    }
    const { data: membership, error } = await client
      .from("agency_memberships")
      .select("id,role,status")
      .eq("agency_id", run.agency_id)
      .eq("user_id", prepared.user.id)
      .maybeSingle();
    if (error) throw error;
    if (!membership || membership.status !== "active" || membership.role !== principal.role) {
      blockers.push(`membership_not_ready:${principal.role}`);
    }
  }

  blockers.push(...await checkLearningReadiness(client, normalized));
  blockers.push(...providerReadinessBlockers(normalized));

  if (normalized.profile === "COMMERCE_TEST_READY") {
    const { data: banks, error: bankError } = await client
      .from("agency_bank_accounts")
      .select("id,is_active")
      .eq("agency_id", run.agency_id)
      .eq("is_active", true)
      .limit(1);
    if (bankError) throw bankError;
    if (!banks?.length) blockers.push("commerce_bank_not_ready");

    const { data: offerings, error: offeringError } = await client
      .from("agency_offerings")
      .select("id,is_published")
      .eq("agency_id", run.agency_id);
    if (offeringError) throw offeringError;
    if (!offerings?.length) blockers.push("commerce_offering_not_ready");
    if ((offerings || []).some(item => item.is_published === true)) {
      blockers.push("commerce_offering_unexpectedly_published");
    }
  }

  if (blockers.length) {
    const current = await getFactoryRun(run.id, { supabaseClient: client });
    if (current.ok && current.run.phase !== "ACTIVE") {
      await updateRun(
        client,
        run.id,
        {
          phase: "BLOCKED",
          last_error_code: blockers[0],
          step_results: {
            ...(current.run.step_results || {}),
            validation: { status: "FAIL", blockers, at: new Date().toISOString() }
          },
          revision: Number(current.run.revision) + 1
        },
        Number(current.run.revision)
      );
    }
    // Never silently demote an ACTIVE tenant without an explicit suspend action.
    return { ok: false, status: 409, code: "factory_validation_blocked", blockers, run };
  }

  if (run.phase === "ACTIVE") {
    return { ok: true, idempotent: true, run, blockers: [] };
  }

  const current = await getFactoryRun(run.id, { supabaseClient: client });
  const updated = await updateRun(
    client,
    run.id,
    {
      phase: "READY",
      last_error_code: null,
      step_results: {
        ...(current.run.step_results || {}),
        validation: { status: "PASS", at: new Date().toISOString() }
      },
      revision: Number(current.run.revision) + 1
    },
    Number(current.run.revision)
  );

  return { ok: true, run: updated, blockers: [] };
}

export async function setFactoryTenantRuntime(runId, action, actorRef, options = {}) {
  const client = options.supabaseClient || defaultSupabase;
  const lookup = await getFactoryRun(runId, { supabaseClient: client });
  if (!lookup.ok) return lookup;
  const run = lookup.run;

  if (run.actor_ref !== actorRef) {
    return { ok: false, status: 403, code: "factory_actor_mismatch" };
  }

  const { data, error } = await client.rpc("set_agency_factory_runtime_state", {
    p_run_id: run.id,
    p_expected_revision: Number(run.revision),
    p_action: clean(action).toLowerCase(),
    p_actor_ref: actorRef
  });
  if (error) {
    return { ok: false, status: 409, code: safeCode(error), error: "Factory runtime transition failed." };
  }
  return { ok: true, result: data };
}

export async function auditFactoryAction(adminEmail, action, metadata = {}, options = {}) {
  const client = options.supabaseClient || defaultSupabase;
  const safeMetadata = {
    run_id: clean(metadata.run_id) || null,
    target_slug: clean(metadata.target_slug) || null,
    phase: clean(metadata.phase) || null,
    code: clean(metadata.code) || null,
    actor_ref: clean(metadata.actor_ref) || null
  };
  const { error } = await client.from("admin_audit_logs").insert({
    admin_email: clean(adminEmail).toLowerCase() || null,
    action: `agency_factory_v1:${clean(action).slice(0, 80)}`,
    metadata: safeMetadata
  });
  return { ok: !error, error: error || null };
}
