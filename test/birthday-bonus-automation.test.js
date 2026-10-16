import assert from "node:assert/strict";
import test from "node:test";
import { buildBirthdayBonusPatch, msUntilNextMoscowSchedule } from "../backend/server.js";
import { loyaltyFields } from "../backend/contact.js";

test("birthday bonus accrues when birthday is inside the 14-day window", () => {
  const contact = {
    id: 2165,
    birthdate: "2013-08-03T03:00:00+04:00",
    [loyaltyFields.balance]: "300",
  };

  const plan = buildBirthdayBonusPatch(contact, { now: new Date("2026-08-04T12:00:00Z") });

  assert.equal(plan.shouldAccrue, true);
  assert.equal(plan.reason, "in_birthday_window");
  assert.equal(plan.birthdayDate, "2026-08-03");
  assert.equal(plan.expiresAt, "2026-08-10");
  assert.equal(plan.fields[loyaltyFields.birthdayBonusAccrued], 500);
  assert.equal(plan.fields[loyaltyFields.birthdayBonusLastYear], 2026);
  assert.equal(plan.fields[loyaltyFields.accruedTotal], 800);
  assert.equal(plan.fields[loyaltyFields.spentTotal], 0);
});

test("birthday bonus is not accrued twice in the same year", () => {
  const contact = {
    id: 2165,
    birthdate: "2013-08-03",
    [loyaltyFields.birthdayBonusLastYear]: "2026",
  };

  const plan = buildBirthdayBonusPatch(contact, { now: new Date("2026-08-04T12:00:00Z") });

  assert.equal(plan.shouldAccrue, false);
  assert.equal(plan.reason, "already_accrued_this_year");
});

test("birthday bonus is skipped outside the 14-day window", () => {
  const contact = {
    id: 2165,
    birthdate: "2013-10-20",
  };

  const plan = buildBirthdayBonusPatch(contact, { now: new Date("2026-08-04T12:00:00Z") });

  assert.equal(plan.shouldAccrue, false);
  assert.equal(plan.reason, "outside_window");
});

test("birthday bonus schedule waits until 05:00 MSK today before the run time", () => {
  const delayMs = msUntilNextMoscowSchedule(new Date("2026-08-04T01:00:00.000Z"));
  assert.equal(delayMs, 60 * 60 * 1000);
});

test("birthday bonus schedule moves to tomorrow after 05:00 MSK", () => {
  const delayMs = msUntilNextMoscowSchedule(new Date("2026-08-04T02:01:00.000Z"));
  assert.equal(delayMs, 23 * 60 * 60 * 1000 + 59 * 60 * 1000);
});
