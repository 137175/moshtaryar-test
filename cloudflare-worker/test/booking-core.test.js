import test from "node:test";
import assert from "node:assert/strict";
import { findApprovedConflict, intervalsOverlap, toMinutes } from "../src/booking-core.js";

test("parses HH:MM", () => {
  assert.equal(toMinutes("09:30"), 570);
});

test("rejects invalid time", () => {
  assert.throws(() => toMinutes("9:30"), TypeError);
  assert.throws(() => toMinutes("24:00"), TypeError);
});

test("overlapping intervals conflict", () => {
  const candidate = { date: "1405-08-25", startTime: "11:00", durationMinutes: 60 };
  const bookings = [{ date: candidate.date, startTime: "11:30", durationMinutes: 30, status: "approved" }];
  assert.equal(findApprovedConflict(candidate, bookings), bookings[0]);
});

test("adjacent intervals do not conflict", () => {
  const candidate = { date: "1405-08-25", startTime: "11:30", durationMinutes: 30 };
  const bookings = [{ date: candidate.date, startTime: "11:00", durationMinutes: 30, status: "approved" }];
  assert.equal(findApprovedConflict(candidate, bookings), null);
});

test("different dates and non-approved bookings do not conflict", () => {
  const candidate = { date: "1405-08-25", startTime: "11:00", durationMinutes: 30 };
  const bookings = [
    { date: "1405-08-26", startTime: "11:00", durationMinutes: 30, status: "approved" },
    { date: candidate.date, startTime: "11:00", durationMinutes: 30, status: "pending" }
  ];
  assert.equal(findApprovedConflict(candidate, bookings), null);
});

test("rejects bookings extending beyond midnight", () => {
  assert.throws(() => findApprovedConflict(
    { date: "1405-08-25", startTime: "23:30", durationMinutes: 60 }, []
  ), RangeError);
  assert.equal(intervalsOverlap(600, 660, 630, 690), true);
});
