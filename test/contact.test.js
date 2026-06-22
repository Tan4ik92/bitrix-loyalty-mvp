import assert from "node:assert/strict";
import test from "node:test";
import { loyaltyFields, mapContact, normalizeSearchQuery, selectBestContact } from "../backend/contact.js";

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
      [loyaltyFields.balance]: "3500",
      [loyaltyFields.purchaseSum]: "126000",
      [loyaltyFields.discountPercent]: "10",
      [loyaltyFields.accruedTotal]: "300",
      [loyaltyFields.spentTotal]: "300",
    }],
  };

  const selected = selectBestContact(raw, { type: "phone", value: "79991234567" });
  const contact = mapContact(selected.contact);
  assert.equal(selected.matches, 1);
  assert.equal(contact.fullName, "Иванов Иван");
  assert.equal(contact.loyalty.balance, 3500);
  assert.equal(contact.loyalty.accruedTotal, 300);
  assert.equal(contact.loyalty.spentTotal, 300);
});
