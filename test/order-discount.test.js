import assert from "node:assert/strict";
import test from "node:test";
import { applyOrderDiscountToProductRows, buildDealProductRows, chooseBestDiscountPercents, normalizeOrderPayload } from "../backend/server.js";

test("offline order product rows are sent without VAT", async () => {
  const rows = await buildDealProductRows([
    { name: "Черные голеностопы V2SD", price: 2000, quantity: 1 },
    { name: "Носки для интенсивных тренировок", price: 900, quantity: 1 },
  ], 145);

  assert.deepEqual(rows.map((row) => ({
    name: row.productName,
    taxRate: row.taxRate,
    taxIncluded: row.taxIncluded,
  })), [
    { name: "Черные голеностопы V2SD", taxRate: 0, taxIncluded: "N" },
    { name: "Носки для интенсивных тренировок", taxRate: 0, taxIncluded: "N" },
  ]);
});

test("sends product row price after discount for Bitrix interface display", () => {
  const rows = [
    { productId: 101, price: 4200, quantity: 1 },
    { productId: 102, price: 5500, quantity: 1 },
  ];

  applyOrderDiscountToProductRows(rows, 1274);

  assert.deepEqual(rows, [
    { productId: 101, price: 4200, quantity: 1 },
    { productId: 102, price: 4226, quantity: 1, discount: 1274, discountTypeId: 1 },
  ]);
});

test("splits row discount by quantity because Bitrix stores unit price and unit discount", () => {
  const rows = [
    { productId: 101, price: 3500, quantity: 1 },
    { productId: 102, price: 3590, quantity: 2 },
  ];

  applyOrderDiscountToProductRows(rows, 1560);

  assert.deepEqual(rows, [
    { productId: 101, price: 3500, quantity: 1 },
    { productId: 102, price: 2810, quantity: 2, discount: 780, discountTypeId: 1 },
  ]);
});

test("uses loyalty discount when it is greater than promocode discount", () => {
  assert.deepEqual(chooseBestDiscountPercents(7, 5), {
    loyaltyDiscountPercent: 7,
    promoDiscountPercent: 0,
    discountPercent: 7,
  });
});

test("uses promocode discount when it is greater than loyalty discount", () => {
  assert.deepEqual(chooseBestDiscountPercents(5, 10), {
    loyaltyDiscountPercent: 0,
    promoDiscountPercent: 10,
    discountPercent: 10,
  });
});

test("keeps only one discount when loyalty and promocode discounts are equal", () => {
  assert.deepEqual(chooseBestDiscountPercents(5, 5), {
    loyaltyDiscountPercent: 5,
    promoDiscountPercent: 0,
    discountPercent: 5,
  });
});

test("keeps packaging at full price when allocating deal row discount", () => {
  const rows = [
    { productId: 101, price: 1000, quantity: 1 },
    { productId: 7509, price: 100, quantity: 1, discountEligible: false },
  ];

  applyOrderDiscountToProductRows(rows, 100);

  assert.equal(rows[0].price, 900);
  assert.equal(rows[0].discount, 100);
  assert.equal(rows[1].price, 100);
  assert.equal(rows[1].discount, undefined);
});

test("calculates payment with packaging included but outside discounts and bonuses", () => {
  const order = normalizeOrderPayload({
    items: [
      { name: "Товар", price: 4000, quantity: 1 },
      { name: "Пакет большой крафтовый", price: 100, quantity: 1, externalId: "jjBIe389hY-R62VLIA4nw0" },
    ],
    promo: { code: "AUTUMN10", discountPercent: 10 },
    bonusUsed: 300,
  });

  assert.equal(order.totals.subtotal, 4100);
  assert.equal(order.totals.discountEligibleSubtotal, 4000);
  assert.equal(order.totals.nonDiscountableSubtotal, 100);
  assert.equal(order.totals.discountAmount, 400);
  assert.equal(order.totals.payTotal, 3400);
});

test("applies two different certificates to one offline order", () => {
  const order = normalizeOrderPayload({
    items: [{ name: "Футболка", price: 5000, quantity: 1 }],
    certificate: { id: "101", code: "CERT-A", amount: 1200 },
    certificate2: { id: "102", code: "CERT-B", amount: 800 },
  });

  assert.equal(order.certificates.length, 2);
  assert.equal(order.totals.certificateUsed, 2000);
  assert.equal(order.totals.certificate2Used, 800);
  assert.equal(order.totals.payTotal, 3000);
});

test("rejects the same certificate in both certificate rows", () => {
  assert.throws(() => normalizeOrderPayload({
    items: [{ name: "Футболка", price: 5000, quantity: 1 }],
    certificate: { id: "101", code: "CERT-A", amount: 1200 },
    certificate2: { id: "101", code: " cert-a ", amount: 800 },
  }), /нельзя использовать дважды/i);
});

test("stores Bitrix source and paid status on messenger order", () => {
  const order = normalizeOrderPayload({
    kind: "messenger",
    sourceId: "UC_9XUL9I",
    paymentStatus: "paid",
    items: [{ name: "Футболка", price: 3000, quantity: 1 }],
  });
  assert.equal(order.kind, "messenger");
  assert.equal(order.sourceId, "UC_9XUL9I");
  assert.equal(order.paymentStatus, "paid");
});

test("rejects a messenger source that is absent from the Bitrix source list", () => {
  assert.throws(() => normalizeOrderPayload({
    kind: "messenger",
    sourceId: "UNKNOWN",
    items: [{ name: "Футболка", price: 3000, quantity: 1 }],
  }), /выберите источник/i);
});

