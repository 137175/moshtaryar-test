// Pure booking validation helpers. No Firebase access, credentials, or writes.
export function toMinutes(value) {
  if (typeof value !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) {
    throw new TypeError("time must be HH:MM");
  }
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

export function intervalsOverlap(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

export function findApprovedConflict(candidate, bookings) {
  if (!candidate || typeof candidate.date !== "string" ||
      typeof candidate.startTime !== "string" ||
      !Number.isInteger(candidate.durationMinutes) ||
      candidate.durationMinutes <= 0 || candidate.durationMinutes > 1440) {
    throw new TypeError("invalid candidate booking");
  }

  const start = toMinutes(candidate.startTime);
  const end = start + candidate.durationMinutes;
  if (end > 1440) throw new RangeError("booking cannot end after midnight");

  for (const booking of bookings) {
    if (!booking || booking.status !== "approved" || booking.date !== candidate.date) continue;
    if (!Number.isInteger(booking.durationMinutes) ||
        booking.durationMinutes <= 0 || booking.durationMinutes > 1440) {
      throw new TypeError("invalid duration in existing approved booking");
    }
    const otherStart = toMinutes(booking.startTime);
    const otherEnd = otherStart + booking.durationMinutes;
    if (otherEnd > 1440) throw new RangeError("existing booking cannot end after midnight");
    if (intervalsOverlap(start, end, otherStart, otherEnd)) return booking;
  }
  return null;
}
