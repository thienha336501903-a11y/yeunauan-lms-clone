import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  REQUIRED_SURFACES,
  auditEntrypointRouting,
  auditFileContent,
  checkM0dCutoverReadiness,
  generateLegacyDependencyMatrix,
  traceTransitiveLocalImports
} from "../utils/m0d-dependency-checker.js";

test("M0D-DEPENDENCY-CHECKER", async (t) => {
  await t.test("live sibling workspace passes all seven surfaces", () => {
    const result = checkM0dCutoverReadiness();
    assert.equal(result.ok, true);
    assert.equal(result.M0D_DEPENDENCY_MATRIX, "PASS");
    assert.equal(result.M0D_CUTOVER_CHECKER, "PASS");
    assert.equal(result.summary.passedSurfaces, 7);
  });

  await t.test("all authoritative surfaces are declared", () => {
    assert.deepEqual(
      REQUIRED_SURFACES.map(row => row.surface),
      ["storefront", "checkout", "agency admin", "learner", "learning/player", "homework", "V5 playback"]
    );
    for (const surface of REQUIRED_SURFACES) {
      assert.ok(surface.entrypoints.length > 0);
      for (const entrypoint of surface.entrypoints) {
        assert.ok(["lms", "commerce"].includes(entrypoint.repo));
        assert.ok(entrypoint.file);
        assert.ok(Array.isArray(entrypoint.requiredTokens));
      }
    }
    assert.ok(REQUIRED_SURFACES.find(row => row.surface === "storefront")
      .entrypoints.some(item => item.file === "api/hero.js"));
    assert.ok(REQUIRED_SURFACES.find(row => row.surface === "learning/player")
      .entrypoints.some(item => item.file === "api/learning.js"));
  });

  await t.test("side-effect imports and unresolved local imports remain visible", () => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), "m0d-import-"));
    try {
      fs.writeFileSync(path.join(temp, "entry.js"), 'import "./legacy.js";\nimport "./missing.js";');
      fs.writeFileSync(path.join(temp, "legacy.js"), 'export const x = db.from("student_enrollments");');
      const traced = traceTransitiveLocalImports("entry.js", temp);
      assert.ok(traced.has(path.join(temp, "legacy.js")));
      assert.ok(traced.has(path.join(temp, "missing.js")));
      assert.equal(auditFileContent("legacy.js", fs.readFileSync(path.join(temp, "legacy.js"), "utf8"))[0].pattern,
        "unscoped_student_enrollments");
    } finally {
      fs.rmSync(temp, { recursive: true, force: true });
    }
  });

  await t.test("prohibited Legacy table access is detected", () => {
    const violations = auditFileContent(
      "commerce:utils/fake.js",
      'export async function bad(client){ return client.from("student_enrollments").select("*"); }'
    );
    assert.equal(violations[0]?.pattern, "unscoped_student_enrollments");
  });

  await t.test("legacy HMAC auth is detected", () => {
    const violations = auditFileContent(
      "lms:utils/fake.js",
      "export function bad(cookie){ return verifyHmacSession(cookie); }"
    );
    assert.equal(violations[0]?.pattern, "legacy_hmac_session");
  });

  await t.test("entrypoint without Agency routing guard is detected", () => {
    const routing = auditEntrypointRouting("api/fake.js", "export default function handler(req,res){res.end();}");
    assert.equal(routing.hasRoutingGuard, false);
    assert.equal(routing.hasAgencyBranch, false);
  });

  await t.test("empty workspace is UNKNOWN, never false PASS", () => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), "m0d-empty-"));
    try {
      const result = generateLegacyDependencyMatrix(temp);
      assert.equal(result.ok, false);
      assert.equal(result.summary.passedSurfaces, 0);
      assert.equal(result.summary.unknownSurfaces, REQUIRED_SURFACES.length);
      for (const row of result.matrix) {
        assert.equal(row.status, "UNKNOWN");
        assert.equal(row.LEGACY_REQUIRED, "UNKNOWN");
      }
    } finally {
      fs.rmSync(temp, { recursive: true, force: true });
    }
  });

  await t.test("LMS-only workspace cannot pass without Commerce sibling", () => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), "m0d-lms-only-"));
    try {
      fs.mkdirSync(path.join(temp, "api/lms"), { recursive: true });
      fs.writeFileSync(
        path.join(temp, "api/lms/portal.js"),
        'import { resolveRequestRoute } from "../../utils/agency-routing.js"; if (routeDecision.route === "AGENCY") { handleAgencyLearnerDashboard(); }'
      );
      const result = generateLegacyDependencyMatrix(temp);
      assert.equal(result.ok, false);
      assert.ok(result.matrix.some(row => row.status === "UNKNOWN"));
      assert.ok(result.matrix.some(row => row.missingEvidence?.some(item => item.repo === "commerce")));
    } finally {
      fs.rmSync(temp, { recursive: true, force: true });
    }
  });
});
