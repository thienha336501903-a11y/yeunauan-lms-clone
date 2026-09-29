import assert from "node:assert/strict";
import test from "node:test";

import {
  generateLegacyDependencyMatrix,
  checkM0dCutoverReadiness
} from "../utils/m0d-dependency-checker.js";

test("M0D-READINESS: cross-repo Agency surfaces have zero Legacy dependency", () => {
  const matrixResult = generateLegacyDependencyMatrix();

  assert.equal(matrixResult.ok, true, "All seven Agency surfaces must have complete cross-repo evidence.");
  assert.equal(matrixResult.summary.totalSurfaces, 7);
  assert.equal(matrixResult.summary.passedSurfaces, 7);
  assert.equal(matrixResult.summary.failedSurfaces, 0);
  assert.equal(matrixResult.summary.unknownSurfaces, 0);
  assert.equal(matrixResult.summary.violationsCount, 0);
  assert.equal(matrixResult.summary.cleanPaths, 7);
  assert.ok(matrixResult.repoRoots.lms);
  assert.ok(matrixResult.repoRoots.commerce);

  for (const row of matrixResult.matrix) {
    assert.equal(row.status, "PASS", `Surface '${row.surface}' must pass.`);
    assert.equal(row.LEGACY_REQUIRED, "NO");
    assert.equal(row.LEGACY_REFERENCE_FOUND, "NO");
    assert.equal(row.BLOCKING_REFERENCE, null);
    assert.equal(row.violations, null);
    assert.equal(row.missingEvidence, null);
  }

  const readiness = checkM0dCutoverReadiness();
  assert.equal(readiness.ok, true);
  assert.equal(readiness.M0D_DEPENDENCY_MATRIX, "PASS");
  assert.equal(readiness.M0D_CUTOVER_CHECKER, "PASS");
  assert.equal(readiness.M0D_READINESS_TOOLING, "PASS");
  assert.equal(readiness.M0D_AUTH_BOUNDARY, "PASS");
  assert.equal(readiness.M0D_PLAYBACK_ROUTING, "PASS");
  assert.equal(readiness.M0D_EXECUTION, "NOT_STARTED");

  for (const [gate, value] of Object.entries(readiness.gates)) {
    assert.equal(value, true, `Operational gate '${gate}' must pass.`);
  }
});
