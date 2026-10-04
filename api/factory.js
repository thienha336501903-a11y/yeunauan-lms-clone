import {
  applyFactoryRun,
  auditFactoryAction,
  createFactoryRun,
  getFactoryRun,
  preflightFactoryManifest,
  prepareFactoryPrincipals,
  setFactoryTenantRuntime,
  upgradeFactoryRun,
  validateFactoryRun
} from "../utils/agency-factory.js";
import { normalizeFactoryManifest } from "../utils/agency-factory-manifest.js";
import { issueFactoryCsrf, requireFactoryAdmin } from "../utils/agency-factory-admin.js";

function clean(value) {
  return String(value || "").trim();
}

function send(res, result) {
  const status = Number(result?.status || (result?.ok === false ? 400 : 200));
  return res.status(status).json(result);
}

export default async function handler(req, res) {
  const auth = requireFactoryAdmin(req, res);
  if (!auth.ok) return send(res, auth);

  const method = String(req.method || "GET").toUpperCase();
  const queryAction = clean(req.query?.action).toLowerCase();

  try {
    if (method === "GET") {
      if (!queryAction || queryAction === "bootstrap") {
        const csrf = issueFactoryCsrf(req, res);
        return res.status(200).json({
          ok: true,
          factory: "system-b-agency-factory-v1",
          admin: auth.session.email,
          csrf,
          levels: {
            target: "LEVEL_2",
            content: "PLATFORM_MANAGED",
            activation: "SEPARATE"
          }
        });
      }

      if (queryAction === "run") {
        return send(res, await getFactoryRun(req.query?.runId));
      }

      return res.status(404).json({ ok: false, code: "factory_action_not_found" });
    }

    if (method !== "POST") {
      return res.status(405).json({ ok: false, code: "method_not_allowed" });
    }

    const action = clean(req.body?.action).toLowerCase();
    const manifest = req.body?.manifest;
    const runId = clean(req.body?.runId);
    const expectedRevisionRaw = req.body?.expectedRevision;
    const expectedRevision = expectedRevisionRaw === undefined || expectedRevisionRaw === null || expectedRevisionRaw === ""
      ? null
      : Number(expectedRevisionRaw);
    if (expectedRevision !== null && !Number.isSafeInteger(expectedRevision)) {
      return res.status(400).json({ ok: false, code: "factory_invalid_expected_revision" });
    }
    const revisionRequired = new Set([
      "prepare-principals","apply","retry","upgrade","validate","activate","resume","suspend"
    ]);
    if (revisionRequired.has(action) && expectedRevision === null) {
      return res.status(409).json({ ok: false, code: "factory_expected_revision_required" });
    }
    let result;

    if (action === "preflight") {
      result = await preflightFactoryManifest(manifest);
    } else if (action === "create-run") {
      result = await createFactoryRun({
        manifest,
        idempotencyKey: clean(req.body?.idempotencyKey),
        actorRef: auth.actorRef,
        sourceLmsSha: clean(process.env.VERCEL_GIT_COMMIT_SHA),
        sourceCommerceSha: clean(req.body?.sourceCommerceSha)
      });
    } else if (action === "prepare-principals") {
      const allowCreate =
        req.body?.allowCreate === true &&
        clean(req.body?.confirmation) === "CREATE_MISSING_AUTH_PRINCIPALS";
      result = await prepareFactoryPrincipals(runId, manifest, auth.actorRef, {
        allowCreate,
        expectedRevision
      });
    } else if (action === "apply" || action === "retry") {
      result = await applyFactoryRun(runId, manifest, auth.actorRef, { expectedRevision });
    } else if (action === "upgrade") {
      result = await upgradeFactoryRun(runId, manifest, auth.actorRef, {
        expectedRevision,
        sourceCommerceSha: clean(req.body?.sourceCommerceSha)
      });
    } else if (action === "validate") {
      result = await validateFactoryRun(runId, manifest, auth.actorRef, { expectedRevision });
    } else if (action === "activate" || action === "resume") {
      const validation = await validateFactoryRun(runId, manifest, auth.actorRef, { expectedRevision });
      if (!validation.ok) {
        result = validation;
      } else if (validation.run?.phase === "ACTIVE") {
        result = { ok: true, idempotent: true, run: validation.run };
      } else {
        result = await setFactoryTenantRuntime(runId, action, auth.actorRef, {
          expectedRevision: validation.run?.revision
        });
      }
    } else if (action === "suspend") {
      result = await setFactoryTenantRuntime(runId, "suspend", auth.actorRef, { expectedRevision });
    } else if (action === "normalize-preview") {
      // Read-only helper for the Platform Admin UI. Never returns secrets because
      // normalizeFactoryManifest rejects secret-bearing keys.
      result = { ok: true, manifest: normalizeFactoryManifest(manifest) };
    } else {
      result = { ok: false, status: 404, code: "factory_action_not_found" };
    }

    const audit = await auditFactoryAction(auth.session.email, action || "unknown", {
      run_id: result?.run?.id || runId,
      target_slug: result?.run?.target_slug || result?.slug || manifest?.agency?.slug,
      phase: result?.run?.phase || result?.result?.phase,
      code: result?.code,
      actor_ref: auth.actorRef
    });

    if (!audit.ok && result?.ok !== false) {
      result = { ...result, auditWarning: "factory_audit_write_failed" };
    }

    return send(res, result);
  } catch (error) {
    console.error("[agency-factory-v1]", {
      code: clean(error?.code || error?.message || "factory_unhandled_error").slice(0, 120)
    });
    return res.status(500).json({
      ok: false,
      code: "factory_internal_error",
      error: "Factory operation failed."
    });
  }
}
