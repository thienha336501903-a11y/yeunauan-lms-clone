// utils/m0d-dependency-checker.js
// System B Milestone M0D — Cross-repo zero-Legacy dependency checker.
// Authoritative Plan: SYSTEM_B_MULTI_AGENCY_MASTER_IMPLEMENTATION_PLAN_V1_1.md
//
// Invariants:
// - Audits BOTH LMS and Commerce from real entrypoints.
// - Every audited module is bound to an explicit repository.
// - Missing sibling repository / entrypoint / module is UNKNOWN, never PASS.
// - Agency branches are checked for prohibited Legacy dependencies.
// - M0D_EXECUTION remains NOT_STARTED until runtime zero-Legacy proof is completed.

import fs from "node:fs";
import path from "node:path";

const ref = (repo, file, requiredTokens = []) => Object.freeze({
  repo,
  file,
  requiredTokens: Object.freeze([...requiredTokens])
});

export const REQUIRED_SURFACES = Object.freeze([
  {
    surface: "storefront",
    description: "Public storefront catalog, offerings, and UI profile resolution",
    entrypoints: [
      ref("commerce", "api/config.js", ["getAgencyCommerceConfig"])
    ],
    agencyModules: [
      ref("commerce", "utils/agency-routing.js"),
      ref("commerce", "utils/agency-commerce.js", ["agency_offerings", "agency_bank_accounts"]),
      ref("commerce", "utils/ui-variant-engine.js", ["STOREFRONT"]),
      ref("commerce", "agency-checkout.html", ["/api/config", "offerings"])
    ]
  },
  {
    surface: "checkout",
    description: "Server-side quote, VietQR generation, checkout RPC, immutable order snapshot",
    entrypoints: [
      ref("commerce", "api/register.js", ["bridgeGoogleAccessTokenToSupabaseSession", "checkoutOffering"]),
      ref("commerce", "api/orders.js", ["getAgencyOrder"])
    ],
    agencyModules: [
      ref("commerce", "utils/agency-commerce.js", ["checkout_agency_offering", "generateVietQrUrl"]),
      ref("commerce", "utils/agency-routing.js"),
      ref("commerce", "agency-checkout.html", ["vietQrUrl", "/api/register"])
    ]
  },
  {
    surface: "agency admin",
    description: "Role-gated management, agency order approval, refund state machine",
    entrypoints: [
      ref("lms", "api/lms/admin.js", ["listAgencyOrders", "approveAgencyOrder", "refundAgencyOrder"])
    ],
    agencyModules: [
      ref("lms", "utils/agency-auth.js"),
      ref("lms", "utils/tenant-db-resolver.js"),
      ref("lms", "utils/agency-commerce.js")
    ]
  },
  {
    surface: "learner",
    description: "Authenticated student dashboard, active entitlements list, identity validation",
    entrypoints: [
      ref("lms", "api/lms/portal.js", ["handleAgencyLearnerDashboard"])
    ],
    agencyModules: [
      ref("lms", "utils/agency-auth.js"),
      ref("lms", "utils/agency-lms-bridge.js", ["student_entitlements"]),
      ref("lms", "utils/tenant-db-resolver.js")
    ]
  },
  {
    surface: "learning/player",
    description: "Canonical courses & lessons hierarchy, learning UI cinema/card variants",
    entrypoints: [
      ref("lms", "api/lms/portal.js", ["handleAgencyV5Feed", "handleAgencyCourseIntro", "agency-progress"])
    ],
    agencyModules: [
      ref("lms", "utils/agency-lms-bridge.js", ["canonical_lessons", "v5LearnerReleaseContent"]),
      ref("lms", "utils/agency-progress.js", ["agency_lesson_progress", "upsertAgencyLessonProgress"]),
      ref("lms", "utils/ui-variant-engine.js", ["LEARNING"])
    ]
  },
  {
    surface: "homework",
    description: "Tenant homework submissions, reviews, grading, canonical lesson binding",
    entrypoints: [
      ref("lms", "api/lms/portal.js", ["listAgencyHomework", "submitAgencyHomework", "gradeAgencyHomework"])
    ],
    agencyModules: [
      ref("lms", "utils/agency-homework.js", ["submit_agency_homework", "grade_agency_homework"])
    ]
  },
  {
    surface: "V5 playback",
    description: "ECDSA P-256 signed playback leases, B1.1 agency playback authorization",
    entrypoints: [
      ref("lms", "api/lms/portal.js", ["handleAgencyV5Play"])
    ],
    agencyModules: [
      ref("lms", "utils/agency-lms-bridge.js", ["v5_authorize_agency_playback"]),
      ref("lms", "utils/v5-playback-lease.js", ["issueV5PlaybackLease"])
    ]
  }
]);

export const PROHIBITED_LEGACY_PATTERNS = Object.freeze([
  {
    name: "legacy_hmac_session",
    regex: /(?:verifyHmacSession|HMAC_SECRET|createHmacSession|parseHmacCookie)\b/g,
    description: "Legacy HMAC session cookie auth (Agency uses Supabase JWT)"
  },
  {
    name: "unscoped_student_enrollments",
    regex: /\.from\(\s*["']student_enrollments["']\s*\)/g,
    description: "Legacy student_enrollments table (Agency uses student_entitlements)"
  },
  {
    name: "unverified_email_lookup",
    regex: /(?:email_identity_lookup|legacy_student_auth)\b/g,
    description: "Legacy unverified email-only login lookup"
  },
  {
    name: "legacy_supabase_project_ref",
    regex: /aqozjkfwzmyfunqvcyjv/g,
    description: "Deprecated Legacy Supabase project reference"
  },
  {
    name: "legacy_unscoped_orders",
    regex: /\.from\(\s*["']orders["']\s*\)/g,
    description: "Legacy single-tenant orders table (Agency uses agency_orders)"
  },
  {
    name: "legacy_unscoped_lesson_progress",
    regex: /\.from\(\s*["']lesson_progress["']\s*\)/g,
    description: "Legacy lesson_progress table (Agency uses agency_lesson_progress)"
  }
]);

function fileKey(repo, file) {
  return `${repo}:${file}`;
}

function exists(file) {
  return Boolean(file && fs.existsSync(file));
}

function detectRepoRoots(rootDir = process.cwd()) {
  const root = path.resolve(rootDir);
  const rootIsLms = exists(path.join(root, "api/lms/portal.js"));
  const rootIsCommerce = exists(path.join(root, "api/config.js"));

  if (rootIsLms) {
    return {
      lms: root,
      commerce: path.resolve(root, "../yeunauan-commerce-clone")
    };
  }

  if (rootIsCommerce) {
    return {
      commerce: root,
      lms: path.resolve(root, "../yeunauan-lms-clone")
    };
  }

  // Also support running from a workspace parent.
  return {
    lms: path.join(root, "yeunauan-lms-clone"),
    commerce: path.join(root, "yeunauan-commerce-clone")
  };
}

function repoAvailable(repoRoots, repo) {
  const dir = repoRoots[repo];
  if (!dir) return false;
  if (repo === "lms") return exists(path.join(dir, "api/lms/portal.js"));
  if (repo === "commerce") return exists(path.join(dir, "api/config.js"));
  return false;
}

export function auditFileContent(filePath, content) {
  const violations = [];
  for (const pat of PROHIBITED_LEGACY_PATTERNS) {
    pat.regex.lastIndex = 0;
    const matches = String(content || "").match(pat.regex);
    if (matches?.length) {
      violations.push({
        file: filePath,
        pattern: pat.name,
        description: pat.description,
        count: matches.length
      });
    }
  }
  return violations;
}

export function traceTransitiveLocalImports(filePath, rootDir, visited = new Set()) {
  const fullPath = path.resolve(rootDir, filePath);
  if (visited.has(fullPath) || !exists(fullPath)) return visited;
  visited.add(fullPath);

  try {
    const content = fs.readFileSync(fullPath, "utf8");
    const importRegex = /(?:import\s+.*?from\s+["'](\.[^"']+)["']|import\(["'](\.[^"']+)["']\)|from\s+["'](\.[^"']+)["'])/g;
    let match;
    while ((match = importRegex.exec(content)) !== null) {
      const relPath = match[1] || match[2] || match[3];
      if (!relPath) continue;

      const dir = path.dirname(fullPath);
      let resolved = path.resolve(dir, relPath);
      if (!exists(resolved)) {
        if (exists(resolved + ".js")) resolved += ".js";
        else if (exists(path.join(resolved, "index.js"))) resolved = path.join(resolved, "index.js");
      }
      if (exists(resolved) && !visited.has(resolved)) {
        traceTransitiveLocalImports(path.relative(rootDir, resolved), rootDir, visited);
      }
    }
  } catch (_) {
    // Missing/unreadable evidence is handled by the caller for required files.
  }

  return visited;
}

export function extractAgencyBranchContent(content) {
  const source = String(content || "");
  const candidates = [
    'route === "AGENCY"',
    'routeDecision.route === "AGENCY"'
  ];
  let agencyIdx = -1;
  for (const needle of candidates) {
    const idx = source.indexOf(needle);
    if (idx !== -1 && (agencyIdx === -1 || idx < agencyIdx)) agencyIdx = idx;
  }
  if (agencyIdx === -1) return "";

  const openBrace = source.indexOf("{", agencyIdx);
  if (openBrace === -1) return "";

  let depth = 1;
  let cursor = openBrace + 1;
  while (depth > 0 && cursor < source.length) {
    if (source[cursor] === "{") depth++;
    else if (source[cursor] === "}") depth--;
    cursor++;
  }

  return depth === 0 ? source.slice(openBrace, cursor) : "";
}

export function auditEntrypointRouting(filePath, content) {
  const source = String(content || "");
  const hasRoutingGuard = source.includes("resolveRequestRoute");
  const agencyBranch = extractAgencyBranchContent(source);
  return {
    hasRoutingGuard,
    hasAgencyBranch: hasRoutingGuard && Boolean(agencyBranch),
    agencyBranch
  };
}

function missingRequiredTokens(source, requiredTokens = []) {
  return (requiredTokens || []).filter(token => !String(source || "").includes(token));
}

function addMissing(missingEvidence, repo, file, kind, description) {
  missingEvidence.push({
    repo,
    file,
    kind,
    description
  });
}

export function generateLegacyDependencyMatrix(rootDir = process.cwd()) {
  const repoRoots = detectRepoRoots(rootDir);
  const matrix = [];

  for (const surf of REQUIRED_SURFACES) {
    const auditedFiles = [];
    const violations = [];
    const missingEvidence = [];

    for (const ep of surf.entrypoints) {
      if (!repoAvailable(repoRoots, ep.repo)) {
        addMissing(
          missingEvidence,
          ep.repo,
          ep.file,
          "missing_repository",
          `Required ${ep.repo} repository is unavailable for cross-repo M0D audit.`
        );
        continue;
      }

      const repoDir = repoRoots[ep.repo];
      const fullPath = path.join(repoDir, ep.file);
      if (!exists(fullPath)) {
        addMissing(
          missingEvidence,
          ep.repo,
          ep.file,
          "missing_entrypoint",
          `Required entrypoint '${ep.file}' is missing from ${ep.repo}.`
        );
        continue;
      }

      const key = fileKey(ep.repo, ep.file);
      auditedFiles.push(key);
      const source = fs.readFileSync(fullPath, "utf8");
      const routing = auditEntrypointRouting(ep.file, source);
      if (!routing.hasRoutingGuard || !routing.hasAgencyBranch) {
        violations.push({
          file: key,
          pattern: "missing_agency_routing_guard",
          description: "Required entrypoint must explicitly resolve and branch Agency routing.",
          count: 1
        });
      } else {
        const missingTokens = missingRequiredTokens(routing.agencyBranch, ep.requiredTokens);
        if (missingTokens.length) {
          violations.push({
            file: key,
            pattern: "missing_agency_surface_operation",
            description: `Agency branch is missing required surface operations: ${missingTokens.join(", ")}`,
            count: missingTokens.length
          });
        }
        violations.push(...auditFileContent(key, routing.agencyBranch));
      }
    }

    for (const mod of surf.agencyModules) {
      if (!repoAvailable(repoRoots, mod.repo)) {
        addMissing(
          missingEvidence,
          mod.repo,
          mod.file,
          "missing_repository",
          `Required ${mod.repo} repository is unavailable for module audit.`
        );
        continue;
      }

      const repoDir = repoRoots[mod.repo];
      const fullPath = path.join(repoDir, mod.file);
      if (!exists(fullPath)) {
        addMissing(
          missingEvidence,
          mod.repo,
          mod.file,
          "missing_module",
          `Required Agency module '${mod.file}' is missing from ${mod.repo}.`
        );
        continue;
      }

      const key = fileKey(mod.repo, mod.file);
      if (!auditedFiles.includes(key)) auditedFiles.push(key);
      const source = fs.readFileSync(fullPath, "utf8");
      const missingTokens = missingRequiredTokens(source, mod.requiredTokens);
      if (missingTokens.length) {
        violations.push({
          file: key,
          pattern: "missing_agency_surface_operation",
          description: `Required Agency module evidence is missing: ${missingTokens.join(", ")}`,
          count: missingTokens.length
        });
      }
      violations.push(...auditFileContent(key, source));

      const traced = traceTransitiveLocalImports(mod.file, repoDir);
      for (const absolute of traced) {
        const rel = path.relative(repoDir, absolute);
        const tracedKey = fileKey(mod.repo, rel);
        if (auditedFiles.includes(tracedKey)) continue;
        auditedFiles.push(tracedKey);
        violations.push(...auditFileContent(tracedKey, fs.readFileSync(absolute, "utf8")));
      }
    }

    const status = violations.length
      ? "FAIL"
      : missingEvidence.length
        ? "UNKNOWN"
        : "PASS";

    matrix.push({
      surface: surf.surface,
      pathName: surf.surface,
      description: surf.description,
      status,
      LEGACY_REQUIRED: status === "PASS" ? "NO" : (status === "FAIL" ? "YES" : "UNKNOWN"),
      LEGACY_REFERENCE_FOUND: violations.length ? "YES" : "NO",
      BLOCKING_REFERENCE: violations[0] || missingEvidence[0] || null,
      auditedFiles,
      missingEvidence: missingEvidence.length ? missingEvidence : null,
      violations: violations.length ? violations : null
    });
  }

  const summary = {
    totalSurfaces: matrix.length,
    passedSurfaces: matrix.filter(row => row.status === "PASS").length,
    failedSurfaces: matrix.filter(row => row.status === "FAIL").length,
    unknownSurfaces: matrix.filter(row => row.status === "UNKNOWN").length,
    violationsCount: matrix.reduce((sum, row) => sum + (row.violations?.length || 0), 0),
    cleanPaths: matrix.filter(row => row.status === "PASS").length
  };

  return {
    ok: matrix.every(row => row.status === "PASS"),
    matrix,
    summary,
    repoRoots: {
      lms: repoAvailable(repoRoots, "lms") ? repoRoots.lms : null,
      commerce: repoAvailable(repoRoots, "commerce") ? repoRoots.commerce : null
    }
  };
}

function readIfPresent(repoRoots, repo, file) {
  if (!repoAvailable(repoRoots, repo)) return "";
  const full = path.join(repoRoots[repo], file);
  return exists(full) ? fs.readFileSync(full, "utf8") : "";
}

export function checkM0dCutoverReadiness(rootDir = process.cwd()) {
  const repoRoots = detectRepoRoots(rootDir);
  const matrixResult = generateLegacyDependencyMatrix(rootDir);

  const lmsRouting = readIfPresent(repoRoots, "lms", "utils/agency-routing.js");
  const commerceRouting = readIfPresent(repoRoots, "commerce", "utils/agency-routing.js");
  const routingModulesClean = [lmsRouting, commerceRouting].every(code =>
    code.includes("resolveRequestRoute") &&
    code.includes('route: "AGENCY"') &&
    code.includes("overlapping_host_configuration") &&
    code.includes("resolver_error")
  );

  const lmsBridge = readIfPresent(repoRoots, "lms", "utils/agency-lms-bridge.js");
  const commerceCore = readIfPresent(repoRoots, "commerce", "utils/agency-commerce.js");
  const lmsPlayback = readIfPresent(repoRoots, "lms", "utils/v5-playback-lease.js");
  const lmsProgress = readIfPresent(repoRoots, "lms", "utils/agency-progress.js");
  const lmsPortal = readIfPresent(repoRoots, "lms", "api/lms/portal.js");
  const lmsHomework = readIfPresent(repoRoots, "lms", "utils/agency-homework.js");

  const entitlementGrantModelEvidence =
    lmsBridge.includes("student_entitlements") &&
    commerceCore.includes("approve_agency_order");

  const playbackEvidence =
    lmsBridge.includes("v5_authorize_agency_playback") &&
    (lmsPlayback.includes("issueV5PlaybackLease") || lmsPlayback.includes("isV5PlaybackConfigured"));

  const progressEvidence =
    lmsProgress.includes("agency_lesson_progress") &&
    lmsProgress.includes("upsertAgencyLessonProgress") &&
    lmsPortal.includes('endpoint === "agency-progress"');

  const homeworkEvidence =
    lmsHomework.includes("agency_homework_submissions") &&
    lmsHomework.includes("submit_agency_homework") &&
    lmsHomework.includes("grade_agency_homework");

  const gates = {
    AGENCY_HOST_ROUTES_NEVER_FALL_TO_LEGACY: routingModulesClean && matrixResult.ok,
    AUTHENTICATED_AGENCY_USER_NEVER_USES_HMAC: matrixResult.ok,
    COMMERCE_USES_AGENCY_TABLES_EXCLUSIVELY: matrixResult.matrix
      .filter(row => ["storefront", "checkout"].includes(row.surface))
      .every(row => row.status === "PASS"),
    ENTITLEMENT_USES_NEW_GRANT_MODEL: entitlementGrantModelEvidence,
    PLAYBACK_USES_B1_1_AGENCY_AUTHORIZATION: playbackEvidence,
    PROGRESS_USES_AGENCY_SCOPED_PROGRESS: progressEvidence,
    HOMEWORK_USES_AGENCY_SCOPED_MODEL: homeworkEvidence,
    NO_AGENCY_REQUESTS_REQUIRE_LEGACY_DB: matrixResult.ok
  };

  const allGatesPass = Object.values(gates).every(Boolean);

  return {
    ok: allGatesPass,
    M0D_DEPENDENCY_MATRIX: matrixResult.ok ? "PASS" : "FAIL",
    M0D_CUTOVER_CHECKER: allGatesPass ? "PASS" : "FAIL",
    M0D_READINESS_TOOLING: allGatesPass ? "PASS" : "FAIL",
    M0D_AUTH_BOUNDARY:
      gates.AGENCY_HOST_ROUTES_NEVER_FALL_TO_LEGACY &&
      gates.AUTHENTICATED_AGENCY_USER_NEVER_USES_HMAC
        ? "PASS"
        : "FAIL",
    M0D_PLAYBACK_ROUTING: gates.PLAYBACK_USES_B1_1_AGENCY_AUTHORIZATION ? "PASS" : "FAIL",
    M0D_EXECUTION: "NOT_STARTED",
    gates,
    matrix: matrixResult.matrix,
    summary: matrixResult.summary
  };
}

if (process.argv[1] && process.argv[1].endsWith("m0d-dependency-checker.js")) {
  const result = checkM0dCutoverReadiness();
  console.log("=== M0D READINESS CHECKER RESULTS ===");
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
}
