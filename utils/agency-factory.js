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

function principalLedgerKey(principal = {}) {
  const material = clean(principal.user_id)
    ? `uid:${clean(principal.user_id)}`
    : `email:${clean(principal.email).toLowerCase()}`;
  return crypto.createHash("sha256").update(material).digest("hex");
}

async function persistPrincipalLedger(client, runId, actorRef, manifestHash, entry, totalCount) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const lookup = await getFactoryRun(runId, { supabaseClient: client });
    if (!lookup.ok) return lookup;
    const run = lookup.run;
    if (run.actor_ref !== actorRef || run.manifest_hash !== manifestHash) {
      return { ok: false, status: 409, code: "factory_run_binding_mismatch" };
    }

    const ledger = run.resource_ledger && typeof run.resource_ledger === "object"
      ? { ...run.resource_ledger }
      : {};
    const principals = Array.isArray(ledger.principals) ? [...ledger.principals] : [];
    const index = principals.findIndex(item => clean(item?.identity_ref) === clean(entry.identity_ref));
    const prior = index >= 0 ? principals[index] : null;

    if (prior?.user_id && entry.user_id && clean(prior.user_id) !== clean(entry.user_id)) {
      return { ok: false, status: 409, code: "factory_principal_ledger_identity_conflict" };
    }

    const merged = {
      ...(prior || {}),
      ...entry,
      created_by_run: prior?.created_by_run === true || entry.created_by_run === true,
      first_created_at:
        prior?.first_created_at ||
        (entry.created_by_run === true ? new Date().toISOString() : null)
    };
    if (index >= 0) principals[index] = merged;
    else principals.push(merged);
    ledger.principals = principals;

    const passed = principals.filter(item => item.status === "PASS");
    const failed = principals.filter(item => item.status === "FAIL");
    const stepStatus = failed.length
      ? "FAIL"
      : (passed.length >= totalCount ? "PASS" : "IN_PROGRESS");

    const stepResults = {
      ...(run.step_results || {}),
      principals: {
        status: stepStatus,
        count: passed.length,
        expected: totalCount,
        created: passed.filter(item => item.created_by_run === true).length,
        reused: passed.filter(item => item.created_by_run !== true).length,
        at: new Date().toISOString()
      }
    };

    const expectedRevision = Number(run.revision);
    try {
      const updated = await updateRun(
        client,
        run.id,
        {
          step_results: stepResults,
          resource_ledger: ledger,
          revision: expectedRevision + 1
        },
        expectedRevision
      );
      return { ok: true, run: updated, entry: merged };
    } catch (error) {
      if (clean(error?.code || error?.message) !== "factory_stale_revision" && !String(error?.message || "").includes("factory_stale_revision")) {
        throw error;
      }
    }
  }

  return { ok: false, status: 409, code: "factory_principal_ledger_stale" };
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


function profileRank(profile) {
  if (profile === "TENANT_SHELL") return 1;
  if (profile === "LEARNING_READY") return 2;
  if (profile === "COMMERCE_TEST_READY") return 3;
  return 0;
}

function factoryLearningAccessSourceRef(runId, userId, canonicalCourseId) {
  return `factory:${clean(runId)}:${clean(userId)}:${clean(canonicalCourseId)}`;
}

async function applyFactoryLearningAccess(client, run, normalized, actorRef) {
  const grants = Array.isArray(normalized?.learning?.access_grants)
    ? normalized.learning.access_grants
    : [];
  if (!grants.length || normalized.profile === "TENANT_SHELL") {
    return { ok: true, idempotent: true, run };
  }

  const prior = run?.step_results?.learning_access;
  if (prior?.status === "PASS" && Number(prior?.count) === grants.length) {
    return { ok: true, idempotent: true, run };
  }

  const { data, error } = await client.rpc("apply_agency_factory_v1_1_learning_access", {
    p_run_id: run.id,
    p_expected_revision: Number(run.revision),
    p_manifest_hash: run.manifest_hash,
    p_actor_ref: actorRef,
    p_access_grants: grants
  });

  if (error) {
    return {
      ok: false,
      status: 409,
      code: safeCode(error, "factory_learning_access_failed"),
      error: "Factory learning access apply failed."
    };
  }

  const after = await getFactoryRun(run.id, { supabaseClient: client });
  return {
    ok: true,
    idempotent: Boolean(data?.idempotent),
    result: data,
    run: after.ok ? after.run : run
  };
}

async function checkLearningAccessReadiness(client, normalized, run) {
  if (normalized.profile === "TENANT_SHELL") return [];

  const blockers = [];
  for (const grant of normalized.learning.access_grants || []) {
    const principal = {
      ...(grant.principal_email ? { email: grant.principal_email } : {}),
      ...(grant.principal_user_id ? { user_id: grant.principal_user_id } : {})
    };
    const prepared = await prepareAuthPrincipal(client, principal, {
      mode: "reuse_only",
      allowCreate: false
    });
    if (!prepared.ok) {
      blockers.push(`learning_access_principal_not_ready:${grant.canonical_course_code}`);
      continue;
    }

    const { data: canonical, error: canonicalError } = await client
      .from("canonical_courses")
      .select("id,code")
      .eq("code", grant.canonical_course_code)
      .maybeSingle();
    if (canonicalError) throw canonicalError;
    if (!canonical?.id) {
      blockers.push(`learning_access_course_not_ready:${grant.canonical_course_code}`);
      continue;
    }

    const { data: membership, error: membershipError } = await client
      .from("agency_memberships")
      .select("id,status")
      .eq("agency_id", run.agency_id)
      .eq("user_id", prepared.user.id)
      .maybeSingle();
    if (membershipError) throw membershipError;
    if (!membership || membership.status !== "active") {
      blockers.push(`learning_access_membership_not_ready:${grant.canonical_course_code}`);
      continue;
    }

    const { data: entitlement, error: entitlementError } = await client
      .from("student_entitlements")
      .select("id,status")
      .eq("agency_id", run.agency_id)
      .eq("membership_id", membership.id)
      .eq("canonical_course_id", canonical.id)
      .maybeSingle();
    if (entitlementError) throw entitlementError;
    if (!entitlement || entitlement.status !== "active") {
      blockers.push(`learning_access_entitlement_not_ready:${grant.canonical_course_code}`);
      continue;
    }

    const sourceRef = factoryLearningAccessSourceRef(run.id, prepared.user.id, canonical.id);
    const { data: provenance, error: grantError } = await client
      .from("entitlement_grants")
      .select("id,status")
      .eq("agency_id", run.agency_id)
      .eq("entitlement_id", entitlement.id)
      .eq("source_type", "manual_admin")
      .eq("source_reference_id", sourceRef)
      .maybeSingle();
    if (grantError) throw grantError;
    if (!provenance || provenance.status !== "active") {
      blockers.push(`learning_access_provenance_not_ready:${grant.canonical_course_code}`);
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
    target: "PENDING",
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
  if (existingAgency) blockers.push("factory_target_already_exists");
  checks.target = existingAgency ? "FAIL" : "PASS";

  for (const domain of normalized.domains) {
    if (legacyHosts.has(domain.hostname)) blockers.push(`legacy_host_overlap:${domain.surface}`);
    const { data: collision, error } = await client
      .from("agency_domains")
      .select("agency_id,hostname,surface,status")
      .eq("hostname", domain.hostname)
      .maybeSingle();
    if (error) throw error;
    if (collision) blockers.push(`domain_ownership_conflict:${domain.surface}`);
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
  const commerceSha = clean(sourceCommerceSha).toLowerCase();
  if (commerceSha && !/^[0-9a-f]{40}$/.test(commerceSha)) {
    return { ok: false, status: 400, code: "factory_invalid_source_commerce_sha" };
  }

  if (!/^[A-Za-z0-9:_-]{16,160}$/.test(key)) {
    return { ok: false, status: 400, code: "factory_invalid_idempotency_key" };
  }
  if (!clean(actorRef)) {
    return { ok: false, status: 400, code: "factory_actor_required" };
  }

  const bound = row =>
    row &&
    row.manifest_hash === manifestHash &&
    row.target_slug === normalized.agency.slug &&
    row.actor_ref === actorRef;

  const { data: existing, error: existingError } = await client
    .from("agency_provisioning_runs")
    .select("*")
    .eq("idempotency_key", key)
    .maybeSingle();
  if (existingError) throw existingError;
  if (existing) {
    if (!bound(existing)) {
      return { ok: false, status: 409, code: "factory_idempotency_ownership_conflict" };
    }
    return { ok: true, idempotent: true, run: existing, manifest: normalized };
  }

  const { data: reserved, error: reservedError } = await client
    .from("agency_provisioning_runs")
    .select("*")
    .eq("target_slug", normalized.agency.slug)
    .maybeSingle();
  if (reservedError) throw reservedError;
  if (reserved) {
    return { ok: false, status: 409, code: "factory_target_reserved" };
  }

  const insertPayload = {
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
    source_commerce_sha: commerceSha || null
  };

  const { data: created, error } = await client
    .from("agency_provisioning_runs")
    .insert(insertPayload)
    .select("*")
    .single();

  if (error) {
    if (String(error.code || "") !== "23505") throw error;

    const { data: raced, error: racedError } = await client
      .from("agency_provisioning_runs")
      .select("*")
      .eq("idempotency_key", key)
      .maybeSingle();
    if (racedError) throw racedError;
    if (raced) {
      if (!bound(raced)) {
        return { ok: false, status: 409, code: "factory_idempotency_ownership_conflict" };
      }
      return { ok: true, idempotent: true, run: raced, manifest: normalized };
    }

    const { data: targetRun, error: targetError } = await client
      .from("agency_provisioning_runs")
      .select("id,target_slug,actor_ref")
      .eq("target_slug", normalized.agency.slug)
      .maybeSingle();
    if (targetError) throw targetError;
    if (targetRun) return { ok: false, status: 409, code: "factory_target_reserved" };
    throw error;
  }

  return { ok: true, idempotent: false, run: created, manifest: normalized };
}

export async function prepareFactoryPrincipals(runId, manifest, actorRef, options = {}) {
  const client = options.supabaseClient || defaultSupabase;
  const normalized = normalizeFactoryManifest(manifest);
  const manifestHash = factoryManifestHash(normalized);
  const lookup = await getFactoryRun(runId, { supabaseClient: client });
  if (!lookup.ok) return lookup;
  let run = lookup.run;
  const requestedRevision = options.expectedRevision === undefined || options.expectedRevision === null
    ? Number(run.revision)
    : Number(options.expectedRevision);
  if (!Number.isSafeInteger(requestedRevision) || Number(run.revision) !== requestedRevision) {
    return { ok: false, status: 409, code: "factory_stale_revision" };
  }

  if (run.actor_ref !== actorRef || run.manifest_hash !== manifestHash) {
    return { ok: false, status: 409, code: "factory_run_binding_mismatch" };
  }
  if (run.phase === "ACTIVE") {
    return { ok: false, status: 409, code: "factory_principal_prepare_after_activation_denied" };
  }

  const mode = options.allowCreate === true ? "create_if_missing" : "reuse_only";
  const prepared = [];

  for (const principal of normalized.principals) {
    const identityRef = principalLedgerKey(principal);
    const intent = await persistPrincipalLedger(
      client,
      run.id,
      actorRef,
      manifestHash,
      {
        identity_ref: identityRef,
        role: principal.role,
        status: "PREPARING",
        error_code: null
      },
      normalized.principals.length
    );
    if (!intent.ok) return intent;
    run = intent.run;

    const result = await prepareAuthPrincipal(client, principal, {
      mode,
      allowCreate: options.allowCreate === true,
      factoryRunId: run.id
    });

    if (!result.ok) {
      await persistPrincipalLedger(
        client,
        run.id,
        actorRef,
        manifestHash,
        {
          identity_ref: identityRef,
          role: principal.role,
          status: "FAIL",
          error_code: result.code || "auth_principal_prepare_failed"
        },
        normalized.principals.length
      );
      return { ...result, ok: false, principalRole: principal.role };
    }

    const ledgerResult = await persistPrincipalLedger(
      client,
      run.id,
      actorRef,
      manifestHash,
      {
        identity_ref: identityRef,
        role: principal.role,
        status: "PASS",
        user_id: opaqueResourceId(result.user.id),
        created_by_run: result.createdByRun === true,
        recovered: result.recovered === true,
        reused: result.createdByRun !== true,
        error_code: null
      },
      normalized.principals.length
    );
    if (!ledgerResult.ok) return ledgerResult;
    run = ledgerResult.run;

    prepared.push({
      user_id: opaqueResourceId(result.user.id),
      role: principal.role,
      created_by_run: result.createdByRun === true,
      recovered: result.recovered === true,
      reused: result.createdByRun !== true
    });
  }

  return { ok: true, run, principals: prepared };
}

export async function applyFactoryRun(runId, manifest, actorRef, options = {}) {
  const client = options.supabaseClient || defaultSupabase;
  const normalized = normalizeFactoryManifest(manifest);
  const hash = factoryManifestHash(normalized);
  const atomicManifest = buildAtomicManifest(normalized);
  const lookup = await getFactoryRun(runId, { supabaseClient: client });
  if (!lookup.ok) return lookup;

  const run = lookup.run;
  const requestedRevision = options.expectedRevision === undefined || options.expectedRevision === null
    ? Number(run.revision)
    : Number(options.expectedRevision);
  if (!Number.isSafeInteger(requestedRevision) || Number(run.revision) !== requestedRevision) {
    return { ok: false, status: 409, code: "factory_stale_revision" };
  }
  if (run.actor_ref !== actorRef || run.manifest_hash !== hash) {
    return { ok: false, status: 409, code: "factory_run_binding_mismatch" };
  }

  if (run.agency_id) {
    const { data: ownedAgency, error: ownedError } = await client
      .from("agencies")
      .select("id,slug,status")
      .eq("id", run.agency_id)
      .eq("slug", normalized.agency.slug)
      .maybeSingle();
    if (ownedError) throw ownedError;
    if (!ownedAgency) return { ok: false, status: 409, code: "factory_target_ownership_mismatch" };
    if (run.phase === "ACTIVE") {
      return { ok: true, idempotent: true, run, agencyId: run.agency_id };
    }
    const learning = await applyFactoryLearningAccess(client, run, normalized, actorRef);
    if (!learning.ok) return learning;
    return {
      ok: true,
      idempotent: true,
      run: learning.run || run,
      agencyId: run.agency_id
    };
  }

  if (!["DRAFT", "BLOCKED"].includes(run.phase)) {
    return { ok: false, status: 409, code: "factory_apply_phase_invalid" };
  }

  try {
    const { data, error } = await client.rpc("provision_agency_factory_v1_atomic", {
      p_run_id: run.id,
      p_expected_revision: requestedRevision,
      p_manifest: atomicManifest,
      p_manifest_hash: hash,
      p_profile: normalized.profile,
      p_actor_ref: actorRef
    });
    if (error) throw error;

    const after = await getFactoryRun(run.id, { supabaseClient: client });
    const appliedRun = after.ok ? after.run : run;
    const learning = await applyFactoryLearningAccess(client, appliedRun, normalized, actorRef);
    if (!learning.ok) return learning;
    return {
      ok: true,
      idempotent: Boolean(data?.idempotent),
      result: data,
      run: learning.run || appliedRun
    };
  } catch (error) {
    try {
      await updateRun(
        client,
        run.id,
        {
          phase: "BLOCKED",
          last_error_code: safeCode(error),
          revision: Number(run.revision) + 1
        },
        Number(run.revision)
      );
    } catch {
      // A concurrent state change wins. Never overwrite it just to record an apply error.
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
  const expectedRevision = options.expectedRevision === undefined || options.expectedRevision === null
    ? Number(run.revision)
    : Number(options.expectedRevision);
  if (!Number.isSafeInteger(expectedRevision) || Number(run.revision) !== expectedRevision) {
    return { ok: false, status: 409, code: "factory_stale_revision" };
  }

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
  blockers.push(...await checkLearningAccessReadiness(client, normalized, run));
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
    if (run.phase === "ACTIVE") {
      return { ok: false, status: 409, code: "factory_validation_blocked", blockers, run };
    }
    try {
      const updated = await updateRun(
        client,
        run.id,
        {
          phase: "BLOCKED",
          last_error_code: blockers[0],
          step_results: {
            ...(run.step_results || {}),
            validation: { status: "FAIL", blockers, at: new Date().toISOString() }
          },
          revision: expectedRevision + 1
        },
        expectedRevision
      );
      return { ok: false, status: 409, code: "factory_validation_blocked", blockers, run: updated };
    } catch (error) {
      if (String(error?.message || "").includes("factory_stale_revision")) {
        return { ok: false, status: 409, code: "factory_stale_revision", blockers };
      }
      throw error;
    }
  }

  if (run.phase === "ACTIVE") {
    return { ok: true, idempotent: true, run, blockers: [] };
  }

  if (!["PREPARING", "BLOCKED", "READY"].includes(run.phase)) {
    return { ok: false, status: 409, code: "factory_validation_phase_invalid" };
  }

  try {
    const updated = await updateRun(
      client,
      run.id,
      {
        phase: "READY",
        last_error_code: null,
        step_results: {
          ...(run.step_results || {}),
          validation: { status: "PASS", at: new Date().toISOString() }
        },
        revision: expectedRevision + 1
      },
      expectedRevision
    );
    return { ok: true, run: updated, blockers: [] };
  } catch (error) {
    if (String(error?.message || "").includes("factory_stale_revision")) {
      return { ok: false, status: 409, code: "factory_stale_revision" };
    }
    throw error;
  }
}

export async function upgradeFactoryRun(runId, manifest, actorRef, options = {}) {
  const client = options.supabaseClient || defaultSupabase;
  const normalized = normalizeFactoryManifest(manifest);
  const hash = factoryManifestHash(normalized);
  const summary = factoryManifestSummary(normalized);
  const lookup = await getFactoryRun(runId, { supabaseClient: client });
  if (!lookup.ok) return lookup;
  let run = lookup.run;

  let expectedRevision = options.expectedRevision === undefined || options.expectedRevision === null
    ? Number(run.revision)
    : Number(options.expectedRevision);
  if (!Number.isSafeInteger(expectedRevision) || Number(run.revision) !== expectedRevision) {
    return { ok: false, status: 409, code: "factory_stale_revision" };
  }

  const requestedSourceCommerceSha = clean(options.sourceCommerceSha).toLowerCase();
  if (requestedSourceCommerceSha && !/^[0-9a-f]{40}$/.test(requestedSourceCommerceSha)) {
    return { ok: false, status: 400, code: "factory_invalid_source_commerce_sha" };
  }
  const existingSourceCommerceSha = clean(run.source_commerce_sha).toLowerCase();
  if (existingSourceCommerceSha && requestedSourceCommerceSha && existingSourceCommerceSha !== requestedSourceCommerceSha) {
    return { ok: false, status: 409, code: "factory_source_commerce_sha_conflict" };
  }
  if (!existingSourceCommerceSha && !requestedSourceCommerceSha) {
    return { ok: false, status: 409, code: "factory_source_commerce_sha_required" };
  }

  if (run.actor_ref !== actorRef) {
    return { ok: false, status: 403, code: "factory_actor_mismatch" };
  }
  if (!run.agency_id || run.target_slug !== normalized.agency.slug) {
    return { ok: false, status: 409, code: "factory_target_ownership_mismatch" };
  }
  const committedUpgradeRetry =
    run.phase === "PREPARING" &&
    run.profile === normalized.profile &&
    run.manifest_hash === hash;
  if (run.phase !== "READY" && !committedUpgradeRetry) {
    return { ok: false, status: 409, code: "factory_upgrade_requires_ready_suspended_run" };
  }
  if (profileRank(normalized.profile) < profileRank(run.profile)) {
    return { ok: false, status: 409, code: "factory_profile_downgrade_forbidden" };
  }

  const { data: agency, error: agencyError } = await client
    .from("agencies")
    .select("id,slug,status")
    .eq("id", run.agency_id)
    .maybeSingle();
  if (agencyError) throw agencyError;
  if (!agency || agency.slug !== run.target_slug) {
    return { ok: false, status: 409, code: "factory_target_ownership_mismatch" };
  }
  if (agency.status !== "suspended") {
    return { ok: false, status: 409, code: "factory_upgrade_requires_suspended_tenant" };
  }

  const blockers = [
    ...await checkLearningReadiness(client, normalized),
    ...providerReadinessBlockers(normalized)
  ];
  for (const principal of normalized.principals) {
    const prepared = await prepareAuthPrincipal(client, principal, {
      mode: "reuse_only",
      allowCreate: false
    });
    if (!prepared.ok) blockers.push(`principal_not_prepared:${principal.role}`);
  }
  if (blockers.length) {
    return {
      ok: false,
      status: 409,
      code: "factory_upgrade_preflight_blocked",
      blockers
    };
  }

  if (!existingSourceCommerceSha && requestedSourceCommerceSha) {
    try {
      run = await updateRun(
        client,
        run.id,
        {
          source_commerce_sha: requestedSourceCommerceSha,
          revision: expectedRevision + 1
        },
        expectedRevision
      );
      expectedRevision = Number(run.revision);
    } catch (error) {
      if (String(error?.message || "").includes("factory_stale_revision")) {
        return { ok: false, status: 409, code: "factory_stale_revision" };
      }
      throw error;
    }
  }

  if (committedUpgradeRetry) {
    const learning = await applyFactoryLearningAccess(client, run, normalized, actorRef);
    if (!learning.ok) return learning;
    return {
      ok: true,
      idempotent: true,
      run: learning.run || run
    };
  }

  const atomicManifest = buildAtomicManifest(normalized);
  const { data, error } = await client.rpc("upgrade_agency_factory_v1_1_atomic", {
    p_run_id: run.id,
    p_expected_revision: expectedRevision,
    p_manifest: atomicManifest,
    p_manifest_hash: hash,
    p_manifest_summary: summary,
    p_profile: normalized.profile,
    p_actor_ref: actorRef
  });

  if (error) {
    return {
      ok: false,
      status: 409,
      code: safeCode(error, "factory_upgrade_failed"),
      error: "Factory staged upgrade failed."
    };
  }

  const after = await getFactoryRun(run.id, { supabaseClient: client });
  const upgradedRun = after.ok ? after.run : run;
  const learning = await applyFactoryLearningAccess(client, upgradedRun, normalized, actorRef);
  if (!learning.ok) return learning;

  return {
    ok: true,
    idempotent: Boolean(data?.idempotent),
    result: data,
    run: learning.run || upgradedRun
  };
}

export async function setFactoryTenantRuntime(runId, action, actorRef, options = {}) {
  const client = options.supabaseClient || defaultSupabase;
  const lookup = await getFactoryRun(runId, { supabaseClient: client });
  if (!lookup.ok) return lookup;
  const run = lookup.run;

  if (run.actor_ref !== actorRef) {
    return { ok: false, status: 403, code: "factory_actor_mismatch" };
  }

  const expectedRevision = options.expectedRevision === undefined || options.expectedRevision === null
    ? Number(run.revision)
    : Number(options.expectedRevision);

  if (!Number.isSafeInteger(expectedRevision) || Number(run.revision) !== expectedRevision) {
    return { ok: false, status: 409, code: "factory_stale_revision" };
  }

  const { data, error } = await client.rpc("set_agency_factory_runtime_state", {
    p_run_id: run.id,
    p_expected_revision: expectedRevision,
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
