import assert from "node:assert/strict";
import test from "node:test";
import { applyOrderDiscountToProductRows, buildDealProductRows, chooseBestDiscountPercents } from "../backend/server.js";

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
