const ACTIVE_ENROLLMENT_STATUSES = new Set([
  "active",
  "approved",
  "approved_ready",
  "approved_waiting_content",
  "completed",
  "da duyet"
]);

export function normalizeEnrollmentStatus(status) {
  return String(status || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d");
}

export function isActiveEnrollmentStatus(status) {
  return ACTIVE_ENROLLMENT_STATUSES.has(normalizeEnrollmentStatus(status));
}

export function isEnrollmentExpired(expiredAt, now = Date.now()) {
  if (!expiredAt) return false;
  const time = Date.parse(expiredAt);
  return Number.isFinite(time) && time <= now;
}

export function isEnrollmentUsable(enrollment, now = Date.now()) {
  if (!enrollment) return false;
  return isActiveEnrollmentStatus(enrollment.status) && !isEnrollmentExpired(enrollment.expired_at, now);
}
