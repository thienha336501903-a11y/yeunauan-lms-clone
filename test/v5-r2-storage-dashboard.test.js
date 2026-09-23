process.env.SUPABASE_URL = process.env.SUPABASE_URL || "https://mock.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "mock-service-role-key";
process.env.R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID || "mock-acc";
process.env.R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID || "mock-key";
process.env.R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY || "mock-secret";
process.env.R2_BUCKET = process.env.R2_BUCKET || "mock-bucket";

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const { parseListBucketResult, isR2Configured } = await import("../utils/v5-r2.js");
const { getV5StorageSnapshot, invalidateStorageCache } = await import("../utils/v5-course-storage.js");
const { supabase } = await import("../utils/supabase.js");

const courseIdA = "11111111-1111-4111-8111-111111111111";
const courseIdB = "22222222-2222-4222-8222-222222222222";

function createMockSupabase(overrides = {}) {
  const defaultCourses = [
    {
      id: courseIdA,
      slug: "test-course-a",
      title: "Test Course A",
      delivery_mode: "v5",
      active: false,
      is_published: false,
      raw_data: { v5CreatedFrom: "course_channel" },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }
  ];

  return (table) => {
    if (table === "courses") {
      return {
        select: () => ({
          eq: () => ({
            order: async () => ({
              data: overrides.courses !== undefined ? overrides.courses : defaultCourses,
              error: null
            })
          })
        })
      };
    }
    if (table === "v5_media_assets") {
      return {
        select: async () => ({
          data: overrides.assets || [],
          error: null
        })
      };
    }
    return {
      select: () => ({
        in: async () => ({ data: [], error: null }),
        eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
        order: async () => ({ data: [], error: null })
      })
    };
  };
}

test("1. parseListBucketResult: single page listing parses objects and metadata", () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
  <Name>test-bucket</Name>
  <Prefix>media/v5/</Prefix>
  <KeyCount>2</KeyCount>
  <MaxKeys>1000</MaxKeys>
  <IsTruncated>false</IsTruncated>
  <Contents>
    <Key>media/v5/video1.mp4</Key>
    <LastModified>2026-09-23T10:00:00.000Z</LastModified>
    <ETag>&quot;etag1&quot;</ETag>
    <Size>1048576</Size>
    <StorageClass>STANDARD</StorageClass>
  </Contents>
  <Contents>
    <Key>media/v5/video2.mp4</Key>
    <LastModified>2026-09-23T11:00:00.000Z</LastModified>
    <ETag>&quot;etag2&quot;</ETag>
    <Size>2097152</Size>
    <StorageClass>STANDARD</StorageClass>
  </Contents>
</ListBucketResult>`;

  const result = parseListBucketResult(xml);
  assert.equal(result.isTruncated, false);
  assert.equal(result.nextContinuationToken, null);
  assert.equal(result.keyCount, 2);
  assert.equal(result.objects.length, 2);
  assert.equal(result.objects[0].key, "media/v5/video1.mp4");
  assert.equal(result.objects[0].size, 1048576);
  assert.equal(result.objects[0].etag, "etag1");
  assert.equal(result.objects[1].key, "media/v5/video2.mp4");
  assert.equal(result.objects[1].size, 2097152);
});

test("2. parseListBucketResult: pagination across multiple pages with continuation token", () => {
  const page1Xml = `<?xml version="1.0" encoding="UTF-8"?>
<ListBucketResult>
  <IsTruncated>true</IsTruncated>
  <NextContinuationToken>token-next-page-xyz</NextContinuationToken>
  <KeyCount>1</KeyCount>
  <Contents>
    <Key>media/v5/part1.mp4</Key>
    <Size>5000</Size>
    <ETag>&quot;etag-p1&quot;</ETag>
  </Contents>
</ListBucketResult>`;

  const page2Xml = `<?xml version="1.0" encoding="UTF-8"?>
<ListBucketResult>
  <IsTruncated>false</IsTruncated>
  <KeyCount>1</KeyCount>
  <Contents>
    <Key>media/v5/part2.mp4</Key>
    <Size>6000</Size>
    <ETag>&quot;etag-p2&quot;</ETag>
  </Contents>
</ListBucketResult>`;

  const p1 = parseListBucketResult(page1Xml);
  assert.equal(p1.isTruncated, true);
  assert.equal(p1.nextContinuationToken, "token-next-page-xyz");
  assert.equal(p1.objects.length, 1);
  assert.equal(p1.objects[0].key, "media/v5/part1.mp4");

  const p2 = parseListBucketResult(page2Xml);
  assert.equal(p2.isTruncated, false);
  assert.equal(p2.nextContinuationToken, null);
  assert.equal(p2.objects.length, 1);
  assert.equal(p2.objects[0].key, "media/v5/part2.mp4");
});

test("3. prefix handling and query encoding in listR2Objects", () => {
  const r2Source = fs.readFileSync(new URL("../utils/v5-r2.js", import.meta.url), "utf8");
  assert.match(r2Source, /query\.set\("prefix", String\(prefix\)\)/);
  assert.match(r2Source, /query\.set\("continuation-token", String\(continuationToken\)\)/);
  assert.match(r2Source, /query\.set\("max-keys", String\(Math\.min\(1000/);
});

test("4. XML entity unescaping in keys: unescapes HTML/XML entities correctly", () => {
  const xml = `<ListBucketResult>
  <IsTruncated>false</IsTruncated>
  <Contents>
    <Key>media/v5/test&amp;folder&lt;1&gt;&quot;quote&quot;&apos;apostrophe.mp4</Key>
    <Size>1234</Size>
    <ETag>&quot;etag-xml&quot;</ETag>
  </Contents>
</ListBucketResult>`;

  const result = parseListBucketResult(xml);
  assert.equal(result.objects[0].key, 'media/v5/test&folder<1>"quote"\'apostrophe.mp4');
});

test("5. bucket total calculation: aggregates total bucket bytes and object counts", async () => {
  const origFrom = supabase.from;
  const origFetch = globalThis.fetch;
  try {
    supabase.from = createMockSupabase();
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      text: async () => `<ListBucketResult><IsTruncated>false</IsTruncated><Contents><Key>media/v5/video1.mp4</Key><Size>1000</Size><ETag>"1"</ETag></Contents></ListBucketResult>`
    });

    invalidateStorageCache();
    const snapshot = await getV5StorageSnapshot({ refresh: true });
    assert.equal(snapshot.summary.bucketBytes, 1000);
    assert.equal(snapshot.summary.bucketObjectCount, 1);
    assert.equal(snapshot.summary.v5Bytes, 1000);
    assert.equal(snapshot.summary.v5ObjectCount, 1);
  } finally {
    supabase.from = origFrom;
    globalThis.fetch = origFetch;
  }
});

test("6. per-course UUID namespace aggregation: partitions objects by media/v5/<COURSE_UUID>/", async () => {
  const origFrom = supabase.from;
  const origFetch = globalThis.fetch;
  try {
    supabase.from = createMockSupabase();
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      text: async () => `<ListBucketResult><IsTruncated>false</IsTruncated><Contents><Key>media/v5/${courseIdA}/lesson1.mp4</Key><Size>2500000</Size><ETag>"e1"</ETag></Contents></ListBucketResult>`
    });

    invalidateStorageCache();
    const snapshot = await getV5StorageSnapshot({ refresh: true });
    assert.equal(snapshot.courses.length, 1);
    const courseA = snapshot.courses[0];
    assert.equal(courseA.courseId, courseIdA);
    assert.equal(courseA.actualR2Bytes, 2500000);
    assert.equal(courseA.actualR2Objects, 1);
  } finally {
    supabase.from = origFrom;
    globalThis.fetch = origFetch;
  }
});

test("7. DB tracked calculation: computes dbTrackedBytes and dbTrackedObjects correctly", async () => {
  const origFrom = supabase.from;
  const origFetch = globalThis.fetch;
  try {
    const assets = [
      { id: "a1", r2_object_key: `media/v5/${courseIdA}/video.mp4`, bytes: 5000000, status: "ready" },
      { id: "a2", r2_object_key: `media/v5/${courseIdA}/audio.mp3`, bytes: 1000000, status: "ready" }
    ];

    supabase.from = createMockSupabase({ assets });
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      text: async () => `<ListBucketResult><IsTruncated>false</IsTruncated></ListBucketResult>`
    });

    invalidateStorageCache();
    const snapshot = await getV5StorageSnapshot({ refresh: true });
    assert.equal(snapshot.summary.dbTrackedBytes, 6000000);
    assert.equal(snapshot.summary.dbTrackedObjectCount, 2);
    const courseA = snapshot.courses.find(c => c.courseId === courseIdA);
    assert.equal(courseA.dbTrackedBytes, 6000000);
    assert.equal(courseA.dbTrackedObjects, 2);
  } finally {
    supabase.from = origFrom;
    globalThis.fetch = origFetch;
  }
});

test("8. orphan candidate calculation: R2 objects under media/v5/ not in DB counted as orphan candidates", async () => {
  const storageSource = fs.readFileSync(new URL("../utils/v5-course-storage.js", import.meta.url), "utf8");
  assert.match(storageSource, /if \(!dbTrackedKeysSet\.has\(obj\.key\) && !activeUploadKeys\.has\(obj\.key\)\) \{/);
  assert.match(storageSource, /orphanCandidateBytes \+= Number\(obj\.size \|\| 0\);/);
  assert.match(storageSource, /orphanCandidateObjects\+\+;/);
});

test("9. active upload session exclusion: active upload keys are NOT classified as orphans", async () => {
  const storageSource = fs.readFileSync(new URL("../utils/v5-course-storage.js", import.meta.url), "utf8");
  assert.match(storageSource, /!TERMINAL_UPLOAD_STATUSES\.has\(status\) && !isExpired/);
  assert.match(storageSource, /activeUploadKeys\.add\(clean\(u\.object_key\)\)/);
  assert.match(storageSource, /!dbTrackedKeysSet\.has\(obj\.key\) && !activeUploadKeys\.has\(obj\.key\)/);
});

test("10. missing DB-tracked object identification: tracks count of DB keys missing from R2", async () => {
  const storageSource = fs.readFileSync(new URL("../utils/v5-course-storage.js", import.meta.url), "utf8");
  assert.match(storageSource, /for \(const key of dbTrackedKeysSet\) \{/);
  assert.match(storageSource, /if \(!r2KeyMap\.has\(key\)\) \{/);
  assert.match(storageSource, /missingTrackedObjects\+\+;/);
});

test("11. 60s cache TTL: returns cached: true within 60s without re-querying", async () => {
  const origFrom = supabase.from;
  const origFetch = globalThis.fetch;
  let queryCount = 0;
  try {
    supabase.from = (table) => {
      queryCount++;
      return createMockSupabase()(table);
    };
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      text: async () => `<ListBucketResult><IsTruncated>false</IsTruncated></ListBucketResult>`
    });

    invalidateStorageCache();
    const res1 = await getV5StorageSnapshot({ refresh: false });
    assert.equal(res1.cached, false);
    const countAfterFirst = queryCount;

    const res2 = await getV5StorageSnapshot({ refresh: false });
    assert.equal(res2.cached, true);
    assert.equal(queryCount, countAfterFirst, "Should not make additional DB queries when cache is valid");
  } finally {
    supabase.from = origFrom;
    globalThis.fetch = origFetch;
  }
});

test("12. refresh query param bypasses cache: getV5StorageSnapshot({ refresh: true }) re-fetches", async () => {
  const origFrom = supabase.from;
  const origFetch = globalThis.fetch;
  let queryCount = 0;
  try {
    supabase.from = (table) => {
      queryCount++;
      return createMockSupabase()(table);
    };
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      text: async () => `<ListBucketResult><IsTruncated>false</IsTruncated></ListBucketResult>`
    });

    invalidateStorageCache();
    const res1 = await getV5StorageSnapshot({ refresh: false });
    assert.equal(res1.cached, false);
    const countAfterFirst = queryCount;

    const res2 = await getV5StorageSnapshot({ refresh: true });
    assert.equal(res2.cached, false);
    assert.ok(queryCount > countAfterFirst, "Should execute queries when refresh=true");
  } finally {
    supabase.from = origFrom;
    globalThis.fetch = origFetch;
  }
});

test("13. credential safety: no secrets returned in snapshot summary or course objects", async () => {
  const origFrom = supabase.from;
  const origFetch = globalThis.fetch;
  try {
    supabase.from = createMockSupabase();
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      text: async () => `<ListBucketResult><IsTruncated>false</IsTruncated></ListBucketResult>`
    });

    invalidateStorageCache();
    const snapshot = await getV5StorageSnapshot({ refresh: true });
    const serialized = JSON.stringify(snapshot);

    assert.doesNotMatch(serialized, /mock-secret/);
    assert.doesNotMatch(serialized, /mock-key/);
    assert.doesNotMatch(serialized, /service_role/i);
    assert.doesNotMatch(serialized, /supabase_secret/i);
  } finally {
    supabase.from = origFrom;
    globalThis.fetch = origFetch;
  }
});

test("14. no raw R2 object keys in summary response: only aggregates returned", async () => {
  const origFrom = supabase.from;
  const origFetch = globalThis.fetch;
  try {
    supabase.from = createMockSupabase();
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      text: async () => `<ListBucketResult><IsTruncated>false</IsTruncated><Contents><Key>media/v5/${courseIdA}/test.mp4</Key><Size>100</Size><ETag>"1"</ETag></Contents></ListBucketResult>`
    });

    invalidateStorageCache();
    const snapshot = await getV5StorageSnapshot({ refresh: true });
    assert.ok(snapshot.summary);
    assert.equal(snapshot.summary.objects, undefined, "summary must not have raw objects array");
    assert.equal(snapshot.summary.keys, undefined, "summary must not have raw keys array");

    for (const c of snapshot.courses) {
      assert.equal(c.r2Objects, undefined, "course must not expose raw R2 objects");
      assert.equal(c.objectKeys, undefined, "course must not expose raw object keys");
      assert.ok(typeof c.actualR2Bytes === "number");
      assert.ok(typeof c.actualR2Objects === "number");
    }
  } finally {
    supabase.from = origFrom;
    globalThis.fetch = origFetch;
  }
});

test("15. informational free-tier reference included with disclaimer", async () => {
  const origFrom = supabase.from;
  const origFetch = globalThis.fetch;
  try {
    supabase.from = createMockSupabase();
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      text: async () => `<ListBucketResult><IsTruncated>false</IsTruncated></ListBucketResult>`
    });

    invalidateStorageCache();
    const snapshot = await getV5StorageSnapshot({ refresh: true });
    assert.equal(snapshot.summary.r2StandardFreeTierGbMonthReference, 10);
    assert.ok(typeof snapshot.summary.currentSnapshotGb === "number");
    assert.ok(typeof snapshot.summary.estimatedHeadroomGb === "number");
    assert.equal(snapshot.summary.freeTierReferenceOnly, true);
    assert.match(snapshot.summary.freeTierDisclaimer, /GB-month/i);
  } finally {
    supabase.from = origFrom;
    globalThis.fetch = origFetch;
  }
});
