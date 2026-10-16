import assert from "node:assert/strict";
import test from "node:test";
import { getMonthKey, getPreviousMonthKey, isFirstDayOfMonth, isLastDayOfMonth } from "../backend/server.js";

test("detects the last calendar day of regular months", () => {
  assert.equal(isLastDayOfMonth(new Date(2026, 3, 29, 12)), false);
  assert.equal(isLastDayOfMonth(new Date(2026, 3, 30, 12)), true);
  assert.equal(isLastDayOfMonth(new Date(2026, 6, 30, 12)), false);
  assert.equal(isLastDayOfMonth(new Date(2026, 6, 31, 12)), true);
});

test("detects February month-end in leap and non-leap years", () => {
  assert.equal(isLastDayOfMonth(new Date(2025, 1, 28, 12)), true);
  assert.equal(isLastDayOfMonth(new Date(2026, 1, 28, 12)), true);
  assert.equal(isLastDayOfMonth(new Date(2028, 1, 28, 12)), false);
  assert.equal(isLastDayOfMonth(new Date(2028, 1, 29, 12)), true);
});

test("builds stable month keys", () => {
  assert.equal(getMonthKey(new Date(2026, 0, 31, 23, 59, 59)), "2026-01");
  assert.equal(getMonthKey(new Date(2026, 11, 1, 0, 0, 0)), "2026-12");
  assert.equal(getPreviousMonthKey(new Date(2026, 7, 1, 12)), "2026-07");
  assert.equal(getPreviousMonthKey(new Date(2026, 0, 1, 12)), "2025-12");
});

test("detects the first day after month close", () => {
  assert.equal(isFirstDayOfMonth(new Date(2026, 6, 31, 12)), false);
  assert.equal(isFirstDayOfMonth(new Date(2026, 7, 1, 12)), true);
});
