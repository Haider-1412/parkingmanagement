export const CHECK_IN_GRACE_MS = 15 * 60 * 1000;

export function checkInDeadline(booking) {
  return Math.min(Date.parse(booking.starts_at) + CHECK_IN_GRACE_MS, Date.parse(booking.ends_at));
}

export function queueDeadline(booking) {
  if (booking.status === "confirmed") return checkInDeadline(booking);
  if (booking.status === "checked_in") return Date.parse(booking.ends_at);
  return Infinity;
}

export function effectiveStatus(booking, now) {
  return booking.status === "confirmed" && now >= checkInDeadline(booking) ? "no_show" : booking.status;
}
