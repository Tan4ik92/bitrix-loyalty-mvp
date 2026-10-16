import assert from "node:assert/strict";
import test from "node:test";
import { buildBirthdayBonusState, buildWelcomeBonusState, loyaltyFields, mapContact, normalizeSearchQuery, selectBestContact, selectMatchingContacts } from "../backend/contact.js";

test("normalizes Russian phone and email searches", () => {
  assert.deepEqual(normalizeSearchQuery("+7 (999) 123-45-67"), { type: "phone", value: "79991234567" });
  assert.deepEqual(normalizeSearchQuery("8 999 123-45-67"), { type: "phone", value: "79991234567" });
  assert.deepEqual(normalizeSearchQuery("CLIENT@MAIL.RU"), { type: "email", value: "client@mail.ru" });
});

test("selects exact contact and maps loyalty fields", () => {
  const raw = {
    items: [{
      id: 21223,
      name: "Иван",
      lastName: "Иванов",
      phone: [{ value: "+7 999 123-45-67" }],
      email: [{ value: "client@mail.ru" }],
      [loyaltyFields.balance]: "300",
      [loyaltyFields.welcomeBonusUsed]: "",
      [loyaltyFields.welcomeBonusExpired]: "",
      [loyaltyFields.birthdayBonusAccrued]: "500",
      [loyaltyFields.birthdayBonusUsed]: "",
      [loyaltyFields.birthdayBonusExpired]: "",
      [loyaltyFields.birthdayBonusAccruedAt]: "2026-11-01",
      [loyaltyFields.birthdayBonusExpiresAt]: "2026-11-15",
      [loyaltyFields.purchaseSum]: "126000",
      [loyaltyFields.discountPercent]: "10",
      [loyaltyFields.accruedTotal]: "300",
      [loyaltyFields.spentTotal]: "300",
      [loyaltyFields.ordersCount]: "0",
      [loyaltyFields.registeredAt]: "2026-07-30T10:00:00+03:00",
    }],
  };

  const selected = selectBestContact(raw, { type: "phone", value: "79991234567" });
  const contact = mapContact(selected.contact);
  assert.equal(selected.matches, 1);
  assert.equal(contact.fullName, "Иванов Иван");
  assert.equal(contact.loyalty.balance, 800);
  assert.equal(contact.loyalty.welcomeBonus.available, 300);
  assert.equal(contact.loyalty.birthdayBonus.available, 500);
  assert.equal(contact.loyalty.accruedTotal, 300);
  assert.equal(contact.loyalty.spentTotal, 300);
});

test("matches additional Bitrix REST email and phone values", () => {
  const raw = {
    result: [{
      ID: 5167,
      NAME: "Екатерина",
      LAST_NAME: "Сенчук",
      PHONE: [
        { VALUE: "+7 917 546-76-36" },
        { VALUE: "+7 989 266-23-86" },
      ],
      EMAIL: [
        { VALUE: "krons167@gmail.com" },
        { VALUE: "18102204@mail.ru" },
      ],
      [loyaltyFields.balance]: "300",
      [loyaltyFields.ordersCount]: "0",
      [loyaltyFields.registeredAt]: "2026-01-07T19:24:27+03:00",
    }],
  };

  assert.equal(selectBestContact(raw, { type: "email", value: "18102204@mail.ru" }).contact.ID, 5167);
  assert.equal(selectBestContact(raw, { type: "phone", value: "79892662386" }).contact.ID, 5167);

  const contact = mapContact(raw.result[0]);
  assert.equal(contact.fullName, "Сенчук Екатерина");
  assert.equal(contact.email, "krons167@gmail.com");
  assert.equal(contact.phone, "+7 917 546-76-36");
  assert.deepEqual(contact.emails, ["krons167@gmail.com", "18102204@mail.ru"]);
  assert.deepEqual(contact.phones, ["+7 917 546-76-36", "+7 989 266-23-86"]);
});

test("returns all exact contacts sorted by newest id first", () => {
  const raw = {
    items: [
      { id: 10, email: [{ value: "client@mail.ru" }] },
      { id: 25, email: [{ value: "client@mail.ru" }] },
      { id: 17, email: [{ value: "other@mail.ru" }] },
    ],
  };

  const contacts = selectMatchingContacts(raw, { type: "email", value: "client@mail.ru" });

  assert.deepEqual(contacts.map((contact) => contact.id), [25, 10]);
  assert.equal(selectBestContact(raw, { type: "email", value: "client@mail.ru" }).contact.id, 25);
});

test("welcome bonus is available only before the first order", () => {
  assert.deepEqual(buildWelcomeBonusState({
    accrued: 300,
    used: null,
    expired: null,
    registeredAt: "2026-07-30T10:00:00+03:00",
    ordersCount: 0,
  }), {
    accrued: 300,
    used: 0,
    expired: 0,
    available: 300,
    eligible: true,
    shouldAccrue: false,
    shouldExpire: false,
    reason: "first_order",
  });
});

test("welcome bonus is unavailable when used or expired", () => {
  assert.equal(buildWelcomeBonusState({ accrued: 300, used: 300, ordersCount: 0 }).available, 0);
  assert.equal(buildWelcomeBonusState({ accrued: 300, expired: 300, ordersCount: 0 }).available, 0);
});

test("welcome bonus should expire when orders already exist", () => {
  const state = buildWelcomeBonusState({
    accrued: 300,
    used: null,
    expired: null,
    registeredAt: "2026-07-30T10:00:00+03:00",
    ordersCount: 12,
  });
  assert.equal(state.available, 0);
  assert.equal(state.eligible, false);
  assert.equal(state.shouldExpire, true);
  assert.equal(state.reason, "orders_exist");
});

test("registered contact without accrual can be repaired", () => {
  assert.deepEqual(buildWelcomeBonusState({
    accrued: null,
    used: null,
    expired: null,
    registeredAt: "2026-07-30T10:00:00+03:00",
    ordersCount: 0,
  }), {
    accrued: 0,
    used: 0,
    expired: 0,
    available: 300,
    eligible: true,
    shouldAccrue: true,
    shouldExpire: false,
    reason: "registered_missing_accrual",
  });
});

test("birthday bonus is available until the expire date", () => {
  assert.deepEqual(buildBirthdayBonusState({
    accrued: 500,
    used: null,
    expired: null,
    accruedAt: "2026-07-23",
    expiresAt: "2026-08-06",
    lastYear: 2026,
    today: new Date("2026-07-30T12:00:00+03:00"),
  }), {
    accrued: 500,
    used: 0,
    expired: 0,
    accruedAt: "2026-07-23",
    expiresAt: "2026-08-06",
    lastYear: 2026,
    available: 500,
    eligible: true,
    shouldExpire: false,
    reason: "active",
  });
});

test("birthday bonus expires after the expire date", () => {
  const state = buildBirthdayBonusState({
    accrued: 500,
    used: 100,
    expired: null,
    expiresAt: "2026-08-06",
    today: new Date("2026-08-07T12:00:00+03:00"),
  });
  assert.equal(state.available, 0);
  assert.equal(state.shouldExpire, true);
  assert.equal(state.reason, "expired_by_date");
});
