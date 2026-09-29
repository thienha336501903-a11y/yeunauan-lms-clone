import test from "node:test";
import assert from "node:assert/strict";

import { handleAgencyLessonProgress } from "../utils/agency-lms-bridge.js";
import { _clearTenantCache } from "../utils/tenant-resolver.js";

const AGENCY_ID = "agency-progress-a";
const MEMBERSHIP_ID = "member-progress-a";
const USER_ID = "user-progress-a";
const COURSE_ID = "canonical-course-progress";
const LESSON_ID = "canonical-lesson-progress";

function mockResponse() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    setHeader(name, value) {
      this.headers[String(name).toLowerCase()] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return body;
    }
  };
}

function makeProgressDb({ lessonMatches = true } = {}) {
  const calls = [];
  let savedProgress = null;

  function makeBuilder(table) {
    const filters = {};
    const state = { upsertRow: null, inValues: null };

    const builder = {
      select() { return builder; },
      eq(column, value) {
        filters[column] = value;
        return builder;
      },
      in(column, values) {
        state.inValues = { column, values };
        return builder;
      },
      upsert(row, options) {
        state.upsertRow = { row, options };
        calls.push({ type: "upsert", table, row, options });
        return builder;
      },
      async maybeSingle() {
        if (table === "agency_memberships") {
          return {
            data: {
              id: MEMBERSHIP_ID,
              agency_id: AGENCY_ID,
              user_id: USER_ID,
              role: "student",
              display_name: "Progress Student",
              status: "active"
            },
            error: null
          };
        }

        if (table === "canonical_courses") {
          return {
            data: {
              id: COURSE_ID,
              course_id: "v5-progress-course",
              code: "F-PROGRESS",
              default_title: "Progress Course",
              status: "published"
            },
            error: null
          };
        }

        if (table === "student_entitlements") {
          return {
            data: {
              id: "ent-progress",
              agency_id: AGENCY_ID,
              membership_id: MEMBERSHIP_ID,
              canonical_course_id: COURSE_ID,
              status: "active",
              expires_at: null
            },
            error: null
          };
        }

        if (table === "canonical_lessons") {
          return {
            data: lessonMatches
              ? { id: LESSON_ID, canonical_course_id: COURSE_ID }
              : null,
            error: null
          };
        }

        return { data: null, error: null };
      },
      async single() {
        if (table !== "agency_lesson_progress" || !state.upsertRow) {
          throw new Error(`Unexpected single() on ${table}`);
        }
        savedProgress = {
          canonical_lesson_id: state.upsertRow.row.canonical_lesson_id,
          progress_percent: state.upsertRow.row.progress_percent,
          is_completed: state.upsertRow.row.is_completed,
          last_position_seconds: state.upsertRow.row.last_position_seconds,
          updated_at: state.upsertRow.row.updated_at
        };
        return { data: savedProgress, error: null };
      },
      then(resolve, reject) {
        const promise = (async () => {
          if (table === "canonical_lessons") {
            return {
              data: [{ id: LESSON_ID }],
              error: null
            };
          }
          if (table === "agency_lesson_progress") {
            calls.push({
              type: "read-progress",
              table,
              filters: { ...filters },
              inValues: state.inValues
            });
            return {
              data: [{
                canonical_lesson_id: LESSON_ID,
                progress_percent: 100,
                is_completed: true,
                last_position_seconds: 0,
                updated_at: "2026-09-29T00:00:00.000Z"
              }],
              error: null
            };
          }
          return { data: [], error: null };
        })();
        return promise.then(resolve, reject);
      }
    };

    return builder;
  }

  const db = {
    calls,
    get savedProgress() {
      return savedProgress;
    },
    auth: {
      async getUser() {
        return {
          data: { user: { id: USER_ID, email: "progress@example.com" } },
          error: null
        };
      }
    },
    async rpc(name, args) {
      calls.push({ type: "rpc", name, args });
      if (name === "resolve_agency_domain") {
        return {
          data: {
            found: true,
            agency_id: AGENCY_ID,
            agency_slug: "agency-progress",
            agency_name: "Agency Progress",
            domain_id: "domain-progress",
            domain_status: "active",
            ssl_status: "active",
            is_primary: false
          },
          error: null
        };
      }
      throw new Error(`Unexpected RPC: ${name}`);
    },
    from(table) {
      calls.push({ type: "from", table });
      if (table === "lesson_progress") {
        throw new Error("Legacy lesson_progress must never be used by Agency progress.");
      }
      return makeBuilder(table);
    }
  };

  return db;
}

function request({ method, body = {} }) {
  return {
    method,
    headers: {
      host: "progress-agency.example.test",
      authorization: "Bearer progress-jwt"
    },
    query: { course: "F-PROGRESS" },
    body
  };
}

test("M0D Agency progress upserts only tenant/member/canonical lesson progress", async () => {
  _clearTenantCache();
  const db = makeProgressDb();
  const res = mockResponse();

  await handleAgencyLessonProgress(
    request({
      method: "POST",
      body: {
        canonicalLessonId: LESSON_ID,
        progressPercent: 100,
        isCompleted: true,
        lastPositionSeconds: 42
      }
    }),
    res,
    { supabaseClient: db }
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);

  const upsert = db.calls.find(call => call.type === "upsert");
  assert.ok(upsert);
  assert.equal(upsert.table, "agency_lesson_progress");
  assert.equal(upsert.row.agency_id, AGENCY_ID);
  assert.equal(upsert.row.membership_id, MEMBERSHIP_ID);
  assert.equal(upsert.row.canonical_lesson_id, LESSON_ID);
  assert.equal(upsert.row.progress_percent, 100);
  assert.equal(upsert.row.is_completed, true);
  assert.equal(upsert.row.last_position_seconds, 42);
  assert.equal(upsert.options.onConflict, "agency_id,membership_id,canonical_lesson_id");
  assert.equal(db.calls.some(call => call.table === "lesson_progress"), false);
});

test("M0D Agency progress rejects canonical lesson outside authorized course", async () => {
  _clearTenantCache();
  const db = makeProgressDb({ lessonMatches: false });
  const res = mockResponse();

  await handleAgencyLessonProgress(
    request({
      method: "POST",
      body: {
        canonicalLessonId: "other-course-lesson",
        progressPercent: 50,
        lastPositionSeconds: 12
      }
    }),
    res,
    { supabaseClient: db }
  );

  assert.equal(res.statusCode, 403);
  assert.equal(res.body.success, false);
  assert.equal(res.body.code, "progress_lesson_course_mismatch");
  assert.equal(db.calls.some(call => call.type === "upsert"), false);
});

test("M0D Agency progress GET scopes rows by agency, membership, and course lessons", async () => {
  _clearTenantCache();
  const db = makeProgressDb();
  const res = mockResponse();

  await handleAgencyLessonProgress(
    request({ method: "GET" }),
    res,
    { supabaseClient: db }
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.progress.length, 1);

  const read = db.calls.find(call => call.type === "read-progress");
  assert.ok(read);
  assert.equal(read.filters.agency_id, AGENCY_ID);
  assert.equal(read.filters.membership_id, MEMBERSHIP_ID);
  assert.equal(read.inValues.column, "canonical_lesson_id");
  assert.deepEqual(read.inValues.values, [LESSON_ID]);
  assert.equal(db.calls.some(call => call.table === "lesson_progress"), false);
});
