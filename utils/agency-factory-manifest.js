import crypto from "node:crypto";

export const FACTORY_PROFILES = Object.freeze([
  "TENANT_SHELL",
  "LEARNING_READY",
  "COMMERCE_TEST_READY"
]);

const PROFILE_SET = new Set(FACTORY_PROFILES);
const ROLE_SET = new Set(["agency_owner", "agency_staff", "student"]);
const SURFACE_SET = new Set(["lms", "commerce"]);
const FORBIDDEN_KEY = /(password|secret|service[_-]?role|private[_-]?key|jwk|access[_-]?token|refresh[_-]?token|authorization|cookie|api[_-]?key|credential|client[_-]?secret|connection[_-]?(?:string|url)|database[_-]?url|bearer[_-]?token)/i;
const DESIGN_TOKEN_KEYS = new Set([
  "primary_color",
  "secondary_color",
  "accent_color",
  "background_color",
  "surface_color",
  "text_color",
  "muted_text_color",
  "border_color",
  "border_radius",
  "font_family"
]);
const FEATURE_FLAG_KEYS = new Set([
  "homework_enabled",
  "commerce_enabled",
  "learning_enabled",
  "progress_enabled",
  "support_enabled"
]);

const clean = value => String(value ?? "").trim();
const lower = value => clean(value).toLowerCase();

function assertPlainObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`factory_manifest_invalid_${label}`);
  }
}

function assertAllowedKeys(value, allowed, label) {
  assertPlainObject(value, label);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`factory_manifest_unknown_${label}_field:${key}`);
  }
}

function rejectSecretKeys(value, path = "manifest") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => rejectSecretKeys(item, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_KEY.test(key)) throw new Error(`factory_manifest_secret_field_forbidden:${path}.${key}`);
    rejectSecretKeys(child, `${path}.${key}`);
  }
}

function normalizePublicDesignTokens(value) {
  if (value === undefined || value === null) return {};
  assertPlainObject(value, "design_tokens");
  const out = {};
  for (const [key, raw] of Object.entries(value)) {
    if (!DESIGN_TOKEN_KEYS.has(key)) {
      throw new Error(`factory_manifest_unknown_design_token:${key}`);
    }
    if (typeof raw !== "string") {
      throw new Error(`factory_manifest_invalid_design_token:${key}`);
    }
    const normalized = clean(raw);
    if (!normalized || normalized.length > 200) {
      throw new Error(`factory_manifest_invalid_design_token:${key}`);
    }
    out[key] = normalized;
  }
  return out;
}

function normalizePublicFeatureFlags(value) {
  if (value === undefined || value === null) return {};
  assertPlainObject(value, "feature_flags");
  const out = {};
  for (const [key, raw] of Object.entries(value)) {
    if (!FEATURE_FLAG_KEYS.has(key)) {
      throw new Error(`factory_manifest_unknown_feature_flag:${key}`);
    }
    if (typeof raw !== "boolean") {
      throw new Error(`factory_manifest_invalid_feature_flag:${key}`);
    }
    out[key] = raw;
  }
  return out;
}

function normalizeOfferingItem(item) {
  assertPlainObject(item, "offering_item");
  const allowed = new Set(["canonical_course_code","canonical_course_id","item_type","sort_order"]);
  for (const key of Object.keys(item)) {
    if (!allowed.has(key)) throw new Error(`factory_manifest_unknown_offering_item_field:${key}`);
  }
  return {
    canonical_course_code: clean(item.canonical_course_code),
    ...(clean(item.canonical_course_id) ? { canonical_course_id: clean(item.canonical_course_id) } : {}),
    item_type: clean(item.item_type || "canonical_course"),
    sort_order: Number(item.sort_order || 1)
  };
}

function normalizeLearningCourse(course) {
  assertPlainObject(course, "learning_course");
  const allowed = new Set(["code","course_id","title","lessons"]);
  for (const key of Object.keys(course)) {
    if (!allowed.has(key)) throw new Error(`factory_manifest_unknown_learning_course_field:${key}`);
  }
  const lessons = Array.isArray(course.lessons) ? course.lessons.map(lesson => {
    assertPlainObject(lesson, "learning_lesson");
    const lessonAllowed = new Set(["v5_lesson_id","title","sort_order","is_free_preview"]);
    for (const key of Object.keys(lesson)) {
      if (!lessonAllowed.has(key)) throw new Error(`factory_manifest_unknown_learning_lesson_field:${key}`);
    }
    return {
      v5_lesson_id: clean(lesson.v5_lesson_id),
      title: clean(lesson.title),
      sort_order: Number(lesson.sort_order || 1),
      is_free_preview: lesson.is_free_preview === true
    };
  }) : [];
  return {
    code: clean(course.code),
    course_id: clean(course.course_id),
    title: clean(course.title),
    lessons
  };
}

function normalizeLearningAccessGrant(grant) {
  assertPlainObject(grant, "learning_access_grant");
  const allowed = new Set(["principal_email","principal_user_id","canonical_course_code"]);
  for (const key of Object.keys(grant)) {
    if (!allowed.has(key)) throw new Error(`factory_manifest_unknown_learning_access_grant_field:${key}`);
  }
  const principalEmail = lower(grant.principal_email);
  const principalUserId = clean(grant.principal_user_id);
  const canonicalCourseCode = clean(grant.canonical_course_code);
  if (!principalEmail && !principalUserId) {
    throw new Error("factory_manifest_learning_access_principal_required");
  }
  if (principalEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(principalEmail)) {
    throw new Error("factory_manifest_invalid_learning_access_email");
  }
  if (!canonicalCourseCode) {
    throw new Error("factory_manifest_learning_access_course_required");
  }
  return {
    ...(principalEmail ? { principal_email: principalEmail } : {}),
    ...(principalUserId ? { principal_user_id: principalUserId } : {}),
    canonical_course_code: canonicalCourseCode
  };
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value).sort().map(key => [key, stableValue(value[key])])
  );
}

export function stableJson(value) {
  return JSON.stringify(stableValue(value));
}

export function factoryManifestHash(value) {
  return crypto.createHash("sha256").update(stableJson(value)).digest("hex");
}

export function normalizeFactoryManifest(input = {}) {
  rejectSecretKeys(input);
  assertAllowedKeys(
    input,
    new Set(["version","profile","agency","domains","ui","principals","bank_accounts","offerings","learning","provider_readiness"]),
    "root"
  );

  const profile = clean(input.profile || "TENANT_SHELL").toUpperCase();
  if (!PROFILE_SET.has(profile)) throw new Error("factory_manifest_invalid_profile");

  assertAllowedKeys(input.agency, new Set(["slug","name","status"]), "agency");
  const slug = lower(input.agency.slug);
  const name = clean(input.agency.name);
  if (!/^[a-z0-9](?:[a-z0-9_-]{0,62})$/.test(slug)) throw new Error("factory_manifest_invalid_slug");
  if (!name || name.length > 160) throw new Error("factory_manifest_invalid_name");

  const domains = Array.isArray(input.domains) ? input.domains.map(domain => {
    assertAllowedKeys(domain, new Set(["hostname","surface","is_primary","ssl_status","status"]), "domain");
    const hostname = lower(domain.hostname);
    const surface = lower(domain.surface);
    if (!hostname || hostname.includes("://") || hostname.includes("/") || hostname.includes(":")) {
      throw new Error("factory_manifest_invalid_hostname");
    }
    if (!SURFACE_SET.has(surface)) throw new Error("factory_manifest_invalid_surface");
    return {
      hostname,
      surface,
      is_primary: true,
      ssl_status: clean(domain.ssl_status || "active").toLowerCase()
    };
  }) : [];

  if (domains.length !== 2) throw new Error("factory_manifest_requires_two_typed_hosts");
  for (const surface of SURFACE_SET) {
    if (domains.filter(domain => domain.surface === surface).length !== 1) {
      throw new Error(`factory_manifest_requires_one_${surface}_host`);
    }
  }
  if (new Set(domains.map(domain => domain.hostname)).size !== domains.length) {
    throw new Error("factory_manifest_duplicate_hostname");
  }

  const uiInput = input.ui && typeof input.ui === "object" ? input.ui : {};
  assertAllowedKeys(
    uiInput,
    new Set([
      "brand_name","logo_url","favicon_url","storefront_variant","checkout_variant","admin_variant",
      "learner_variant","learning_variant","homework_variant","design_tokens","feature_flags"
    ]),
    "ui"
  );
  const ui = {
    brand_name: clean(uiInput.brand_name || name),
    logo_url: clean(uiInput.logo_url) || null,
    favicon_url: clean(uiInput.favicon_url) || null,
    storefront_variant: clean(uiInput.storefront_variant || "classic_culinary"),
    checkout_variant: clean(uiInput.checkout_variant || "one_page_qr"),
    admin_variant: clean(uiInput.admin_variant || "standard_agency"),
    learner_variant: clean(uiInput.learner_variant || "card_dashboard"),
    learning_variant: clean(uiInput.learning_variant || "cinema_player"),
    homework_variant: clean(uiInput.homework_variant || "photo_submission"),
    design_tokens: normalizePublicDesignTokens(uiInput.design_tokens),
    feature_flags: normalizePublicFeatureFlags(uiInput.feature_flags)
  };

  const principals = Array.isArray(input.principals) ? input.principals.map(principal => {
    assertAllowedKeys(principal, new Set(["email","user_id","role","display_name"]), "principal");
    const email = lower(principal.email);
    const userId = clean(principal.user_id);
    const role = clean(principal.role || "student");
    if (!email && !userId) throw new Error("factory_manifest_principal_identity_required");
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("factory_manifest_invalid_email");
    if (!ROLE_SET.has(role)) throw new Error("factory_manifest_invalid_role");
    return {
      ...(email ? { email } : {}),
      ...(userId ? { user_id: userId } : {}),
      role,
      display_name: clean(principal.display_name || (email ? email.split("@")[0] : role))
    };
  }) : [];

  if (!principals.length) throw new Error("factory_manifest_principal_required");
  if (!principals.some(principal => principal.role === "agency_owner")) {
    throw new Error("factory_manifest_owner_required");
  }

  const bankAccounts = Array.isArray(input.bank_accounts) ? input.bank_accounts.map(bank => {
    assertAllowedKeys(bank, new Set(["bank_code","account_number","account_holder","branch","is_active","is_default"]), "bank");
    return {
    bank_code: clean(bank?.bank_code),
    account_number: clean(bank?.account_number),
    account_holder: clean(bank?.account_holder),
    branch: clean(bank?.branch) || null,
    is_active: bank?.is_active !== false,
    is_default: bank?.is_default === true
    };
  }) : [];

  const offerings = Array.isArray(input.offerings) ? input.offerings.map(offering => {
    assertPlainObject(offering, "offering");
    const allowed = new Set([
      "slug","display_title","display_description","thumbnail_url",
      "price_vnd","sale_price_vnd","sort_order","is_published","items"
    ]);
    for (const key of Object.keys(offering)) {
      if (!allowed.has(key)) throw new Error(`factory_manifest_unknown_offering_field:${key}`);
    }
    return {
      slug: lower(offering.slug),
      display_title: clean(offering.display_title),
      display_description: clean(offering.display_description),
      thumbnail_url: clean(offering.thumbnail_url) || null,
      price_vnd: Number(offering.price_vnd),
      sale_price_vnd: offering.sale_price_vnd === null || offering.sale_price_vnd === undefined
        ? null
        : Number(offering.sale_price_vnd),
      sort_order: Number(offering.sort_order || 1),
      is_published: false,
      items: Array.isArray(offering.items) ? offering.items.map(normalizeOfferingItem) : []
    };
  }) : [];

  const learningInput = input.learning && typeof input.learning === "object"
    ? input.learning
    : { courses: [], access_grants: [] };
  assertAllowedKeys(learningInput, new Set(["courses","access_grants"]), "learning");
  const learning = {
    courses: Array.isArray(learningInput.courses) ? learningInput.courses.map(normalizeLearningCourse) : [],
    access_grants: Array.isArray(learningInput.access_grants)
      ? learningInput.access_grants.map(normalizeLearningAccessGrant)
      : []
  };

  if (profile !== "TENANT_SHELL" && learning.courses.length === 0) {
    throw new Error("factory_manifest_learning_required");
  }
  if (profile !== "TENANT_SHELL" && learning.access_grants.length === 0) {
    throw new Error("factory_manifest_learning_access_required");
  }
  if (profile === "COMMERCE_TEST_READY") {
    if (!bankAccounts.length) throw new Error("factory_manifest_bank_required");
    if (!offerings.length) throw new Error("factory_manifest_offering_required");
  }

  for (const bank of bankAccounts) {
    if (!bank.bank_code || !bank.account_number || !bank.account_holder) {
      throw new Error("factory_manifest_invalid_bank");
    }
  }
  for (const offering of offerings) {
    if (!offering.slug || !offering.display_title || !Number.isSafeInteger(offering.price_vnd) || offering.price_vnd < 0) {
      throw new Error("factory_manifest_invalid_offering");
    }
    if (offering.sale_price_vnd !== null && (!Number.isSafeInteger(offering.sale_price_vnd) || offering.sale_price_vnd < 0)) {
      throw new Error("factory_manifest_invalid_offering_sale_price");
    }
    if (!Number.isSafeInteger(offering.sort_order) || offering.sort_order < 1) {
      throw new Error("factory_manifest_invalid_offering_sort_order");
    }
    if (!offering.items.length) throw new Error("factory_manifest_offering_items_required");
    for (const item of offering.items) {
      if (!item.canonical_course_code || item.item_type !== "canonical_course") {
        throw new Error("factory_manifest_invalid_offering_item");
      }
      if (!Number.isSafeInteger(item.sort_order) || item.sort_order < 1) {
        throw new Error("factory_manifest_invalid_offering_item_sort_order");
      }
    }
  }

  for (const course of learning.courses) {
    if (!course.code || !course.course_id) throw new Error("factory_manifest_invalid_learning_course");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(course.course_id)) {
      throw new Error("factory_manifest_invalid_learning_course_id");
    }
    for (const lesson of course.lessons) {
      if (!lesson.v5_lesson_id) throw new Error("factory_manifest_invalid_learning_lesson");
      if (!Number.isSafeInteger(lesson.sort_order) || lesson.sort_order < 1) {
        throw new Error("factory_manifest_invalid_learning_lesson_sort_order");
      }
    }
  }

  const principalKeys = new Set();
  const principalIdentityKeys = new Set();
  for (const principal of principals) {
    const key = principal.user_id ? `uid:${principal.user_id}` : `email:${principal.email}`;
    if (principalKeys.has(key)) throw new Error("factory_manifest_duplicate_principal");
    principalKeys.add(key);
    if (principal.user_id) principalIdentityKeys.add(`uid:${principal.user_id}`);
    if (principal.email) principalIdentityKeys.add(`email:${principal.email}`);
  }

  const learningCourseCodes = new Set(learning.courses.map(course => course.code));
  const learningAccessKeys = new Set();
  for (const grant of learning.access_grants) {
    const principalKey = grant.principal_user_id
      ? `uid:${grant.principal_user_id}`
      : `email:${grant.principal_email}`;
    if (!principalIdentityKeys.has(principalKey)) {
      throw new Error("factory_manifest_learning_access_principal_not_declared");
    }
    if (!learningCourseCodes.has(grant.canonical_course_code)) {
      throw new Error("factory_manifest_learning_access_course_not_declared");
    }
    const accessKey = `${principalKey}:${grant.canonical_course_code}`;
    if (learningAccessKeys.has(accessKey)) {
      throw new Error("factory_manifest_duplicate_learning_access_grant");
    }
    learningAccessKeys.add(accessKey);
  }

  const providerReadinessInput = input.provider_readiness && typeof input.provider_readiness === "object"
    ? input.provider_readiness
    : {};
  assertAllowedKeys(
    providerReadinessInput,
    new Set([
      "lms_host_ready","commerce_host_ready","google_lms_origin_ready",
      "google_commerce_origin_ready","worker_lms_origin_ready","evidence_refs"
    ]),
    "provider_readiness"
  );
  const provider_readiness = {
    lms_host_ready: providerReadinessInput.lms_host_ready === true,
    commerce_host_ready: providerReadinessInput.commerce_host_ready === true,
    google_lms_origin_ready: providerReadinessInput.google_lms_origin_ready === true,
    google_commerce_origin_ready: providerReadinessInput.google_commerce_origin_ready === true,
    worker_lms_origin_ready: providerReadinessInput.worker_lms_origin_ready === true,
    evidence_refs: Array.isArray(providerReadinessInput.evidence_refs)
      ? providerReadinessInput.evidence_refs.map(clean).filter(Boolean).slice(0, 20)
      : []
  };

  return {
    version: Number(input.version || 1),
    profile,
    agency: { slug, name, status: "suspended" },
    domains,
    ui,
    bank_accounts: bankAccounts,
    offerings,
    learning,
    principals,
    provider_readiness
  };
}

export function buildAtomicManifest(factoryManifest) {
  const normalized = normalizeFactoryManifest(factoryManifest);
  const atomic = {
    agency: { ...normalized.agency, status: "suspended" },
    domains: normalized.domains.map(({ hostname, surface, is_primary, ssl_status }) => ({
      hostname, surface, is_primary, ssl_status
    })),
    ui: normalized.ui,
    principals: normalized.principals
  };
  if (normalized.bank_accounts.length) atomic.bank_accounts = normalized.bank_accounts;
  if (normalized.offerings.length) {
    atomic.offerings = normalized.offerings.map(offering => ({ ...offering, is_published: false }));
  }
  if (normalized.learning.courses.length) atomic.learning = normalized.learning;
  return atomic;
}

export function factoryManifestSummary(factoryManifest) {
  const normalized = normalizeFactoryManifest(factoryManifest);
  return {
    version: normalized.version,
    profile: normalized.profile,
    agency: { slug: normalized.agency.slug, name: normalized.agency.name },
    domains: normalized.domains.map(({ hostname, surface }) => ({ hostname, surface })),
    principal_count: normalized.principals.length,
    principal_roles: [...new Set(normalized.principals.map(item => item.role))].sort(),
    bank_count: normalized.bank_accounts.length,
    offering_count: normalized.offerings.length,
    course_codes: normalized.learning.courses.map(course => clean(course.code)).filter(Boolean).sort(),
    learning_access_grant_count: normalized.learning.access_grants.length,
    provider_readiness: {
      lms_host_ready: normalized.provider_readiness.lms_host_ready,
      commerce_host_ready: normalized.provider_readiness.commerce_host_ready,
      google_lms_origin_ready: normalized.provider_readiness.google_lms_origin_ready,
      google_commerce_origin_ready: normalized.provider_readiness.google_commerce_origin_ready,
      worker_lms_origin_ready: normalized.provider_readiness.worker_lms_origin_ready,
      evidence_refs: normalized.provider_readiness.evidence_refs
    }
  };
}

export function providerReadinessBlockers(factoryManifest) {
  const normalized = normalizeFactoryManifest(factoryManifest);
  const p = normalized.provider_readiness;
  const blockers = [];
  if (!p.lms_host_ready) blockers.push("lms_host_not_verified");
  if (!p.commerce_host_ready) blockers.push("commerce_host_not_verified");

  if (normalized.profile !== "TENANT_SHELL") {
    if (!p.google_lms_origin_ready) blockers.push("google_lms_origin_not_verified");
    if (!p.worker_lms_origin_ready) blockers.push("worker_lms_origin_not_verified");
  }
  if (normalized.profile === "COMMERCE_TEST_READY" && !p.google_commerce_origin_ready) {
    blockers.push("google_commerce_origin_not_verified");
  }
  return blockers;
}
