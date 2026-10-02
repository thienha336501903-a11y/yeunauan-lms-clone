import crypto from "node:crypto";

export const FACTORY_PROFILES = Object.freeze([
  "TENANT_SHELL",
  "LEARNING_READY",
  "COMMERCE_TEST_READY"
]);

const PROFILE_SET = new Set(FACTORY_PROFILES);
const ROLE_SET = new Set(["agency_owner", "agency_staff", "student"]);
const SURFACE_SET = new Set(["lms", "commerce"]);
const FORBIDDEN_KEY = /(password|secret|service[_-]?role|private[_-]?key|jwk|access[_-]?token|refresh[_-]?token|authorization|cookie)/i;

const clean = value => String(value ?? "").trim();
const lower = value => clean(value).toLowerCase();

function assertPlainObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`factory_manifest_invalid_${label}`);
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
  assertPlainObject(input, "root");
  rejectSecretKeys(input);

  const profile = clean(input.profile || "TENANT_SHELL").toUpperCase();
  if (!PROFILE_SET.has(profile)) throw new Error("factory_manifest_invalid_profile");

  assertPlainObject(input.agency, "agency");
  const slug = lower(input.agency.slug);
  const name = clean(input.agency.name);
  if (!/^[a-z0-9](?:[a-z0-9_-]{0,62})$/.test(slug)) throw new Error("factory_manifest_invalid_slug");
  if (!name || name.length > 160) throw new Error("factory_manifest_invalid_name");

  const domains = Array.isArray(input.domains) ? input.domains.map(domain => {
    assertPlainObject(domain, "domain");
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
    design_tokens: uiInput.design_tokens && typeof uiInput.design_tokens === "object" ? uiInput.design_tokens : {},
    feature_flags: uiInput.feature_flags && typeof uiInput.feature_flags === "object" ? uiInput.feature_flags : {}
  };

  const principals = Array.isArray(input.principals) ? input.principals.map(principal => {
    assertPlainObject(principal, "principal");
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

  const bankAccounts = Array.isArray(input.bank_accounts) ? input.bank_accounts.map(bank => ({
    bank_code: clean(bank?.bank_code),
    account_number: clean(bank?.account_number),
    account_holder: clean(bank?.account_holder),
    branch: clean(bank?.branch) || null,
    is_active: bank?.is_active !== false,
    is_default: bank?.is_default === true
  })) : [];

  const offerings = Array.isArray(input.offerings) ? input.offerings.map(offering => ({
    ...offering,
    slug: lower(offering?.slug),
    display_title: clean(offering?.display_title),
    display_description: clean(offering?.display_description),
    is_published: false,
    items: Array.isArray(offering?.items) ? offering.items.map(item => ({ ...item })) : []
  })) : [];

  const learning = input.learning && typeof input.learning === "object"
    ? { courses: Array.isArray(input.learning.courses) ? input.learning.courses.map(course => ({ ...course })) : [] }
    : { courses: [] };

  if (profile !== "TENANT_SHELL" && learning.courses.length === 0) {
    throw new Error("factory_manifest_learning_required");
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
    if (!offering.slug || !offering.display_title || offering.price_vnd === undefined) {
      throw new Error("factory_manifest_invalid_offering");
    }
    if (!offering.items.length) throw new Error("factory_manifest_offering_items_required");
  }

  const providerReadinessInput = input.provider_readiness && typeof input.provider_readiness === "object"
    ? input.provider_readiness
    : {};
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
