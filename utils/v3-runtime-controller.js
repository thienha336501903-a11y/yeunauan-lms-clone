import { supabase } from "./supabase.js";

export const ACTIVE_MODES = Object.freeze({ V2: "v2", V3: "v3" });
export const MODE_KEY = "clone_learning_mode";
export const KILL_SWITCH_KEY = "clone_v3_kill_switch";

const CACHE_TTL_MS = 5000;
let cached = null;
let cachedAt = 0;
let inflight = null;

function normalizeMode(value) {
  const raw = String(value ?? "").trim().toLowerCase();
  if (raw === "2" || raw === "v2") return ACTIVE_MODES.V2;
  if (raw === "3" || raw === "v3") return ACTIVE_MODES.V3;
  return null;
}

function parseBoolean(value) {
  if (value === true || value === 1) return true;
  const raw = String(value ?? "").trim().toLowerCase();
  return ["1", "true", "yes", "on", "enabled"].includes(raw);
}

function rowValue(row) {
  if (!row || row.value == null) return null;
  const value = row.value;
  if (typeof value === "string" || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "object") {
    if (value.value != null) return value.value;
    if (value.val != null) return value.val;
  }
  return null;
}

function applyEffective(activeMode, killSwitch, source, ok = true, updatedAt = null) {
  const safeActive = normalizeMode(activeMode) || ACTIVE_MODES.V2;
  const killed = Boolean(killSwitch);
  const effectiveMode = killed ? ACTIVE_MODES.V2 : safeActive;
  return {
    activeMode: safeActive,
    effectiveMode,
    effective: effectiveMode === ACTIVE_MODES.V3,
    killSwitch: killed,
    source,
    ok: Boolean(ok),
    updatedAt,
  };
}

function envOverride() {
  const forceKill = parseBoolean(process.env.CLONE_V3_RUNTIME_FORCE_KILL);
  const forcedMode = normalizeMode(process.env.CLONE_V3_RUNTIME_FORCE_MODE);
  if (forceKill) return applyEffective(forcedMode || ACTIVE_MODES.V2, true, "env_force_kill", true, null);
  if (forcedMode) return applyEffective(forcedMode, false, "env_force_mode", true, null);
  return null;
}

async function loadFromDb() {
  try {
    const { data, error } = await supabase
      .from("site_config")
      .select("key,value,updated_at")
      .in("key", [MODE_KEY, KILL_SWITCH_KEY]);
    if (error) throw error;

    let activeMode = null;
    let killSwitch = false;
    let updatedAt = null;
    for (const row of data || []) {
      if (row.key === MODE_KEY) activeMode = normalizeMode(rowValue(row));
      if (row.key === KILL_SWITCH_KEY) killSwitch = parseBoolean(rowValue(row));
      if (row.updated_at && (!updatedAt || new Date(row.updated_at) > new Date(updatedAt))) updatedAt = row.updated_at;
    }

    if (!activeMode) return applyEffective(ACTIVE_MODES.V2, killSwitch, "db_default", true, updatedAt);
    return applyEffective(activeMode, killSwitch, killSwitch ? "db_kill_switch" : "db", true, updatedAt);
  } catch (error) {
    console.error("[v3-runtime-controller] read failed:", error?.message);
    return applyEffective(ACTIVE_MODES.V2, false, "db_error", false, null);
  }
}

export async function getRuntimeSnapshot({ forceRefresh = false } = {}) {
  const override = envOverride();
  if (override) return override;

  const now = Date.now();
  if (!forceRefresh && cached && now - cachedAt < CACHE_TTL_MS) return { ...cached };
  if (forceRefresh) {
    cached = null;
    cachedAt = 0;
  }
  if (!inflight) {
    inflight = loadFromDb().then((snapshot) => {
      cached = snapshot;
      cachedAt = Date.now();
      return snapshot;
    }).finally(() => {
      inflight = null;
    });
  }
  return { ...(await inflight) };
}

async function upsertConfig(key, value) {
  const { error } = await supabase
    .from("site_config")
    .upsert({ key, value }, { onConflict: "key" });
  if (error) throw error;
}

export async function setActiveMode(mode) {
  const normalized = normalizeMode(mode);
  if (!normalized) return { ok: false, code: "invalid_mode" };
  try {
    await upsertConfig(MODE_KEY, normalized);
    const snapshot = await getRuntimeSnapshot({ forceRefresh: true });
    return { ok: true, ...snapshot };
  } catch (error) {
    console.error("[v3-runtime-controller] set mode failed:", error?.message);
    return { ok: false, code: "mode_save_failed" };
  }
}

export async function setKillSwitch(enabled) {
  const value = parseBoolean(enabled);
  try {
    await upsertConfig(KILL_SWITCH_KEY, value);
    const snapshot = await getRuntimeSnapshot({ forceRefresh: true });
    return { ok: true, ...snapshot };
  } catch (error) {
    console.error("[v3-runtime-controller] set kill switch failed:", error?.message);
    return { ok: false, code: "kill_switch_save_failed" };
  }
}

export function clearRuntimeCache() {
  cached = null;
  cachedAt = 0;
  inflight = null;
}
