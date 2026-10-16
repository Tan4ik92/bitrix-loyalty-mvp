import test from "node:test";
import assert from "node:assert/strict";
import { quoteDiscountedCart } from "../frontend/v2sd-discount-allocation.mjs";

test("five percent reconciles across products at kopeck precision", () => {
  const quote = quoteDiscountedCart({ products: [{ price: 199.99, quantity: 2 }], loyaltyPercent: 5, loyaltyEnabled: true });
  assert.equal(quote.primaryDiscount, 20);
  assert.deepEqual(quote.items.map((item) => item.payable), [189.99, 189.99]);
  assert.equal(quote.paymentAmount, 379.98);
});

test("fixed certificate plus bonus is allocated without changing certificate nominal", () => {
  const quote = quoteDiscountedCart({
    products: [{ price: 3333, quantity: 1 }, { price: 2467, quantity: 1 }],
    promoFixed: 5000,
    bonus: 300,
  });
  assert.equal(quote.primaryDiscount, 5000);
  assert.equal(quote.bonus, 300);
  assert.equal(quote.paymentAmount, 500);
  assert.equal(quote.items.reduce((sum, item) => sum + item.payable, 0), 500);
});

test("bonus crossing the free-delivery threshold adds delivery back", () => {
  const quote = quoteDiscountedCart({
    products: [{ price: 6000, quantity: 1 }], bonus: 800, delivery: 500, freeDeliveryThreshold: 5500,
  });
  assert.equal(quote.productsPayable, 5200);
  assert.equal(quote.delivery, 500);
  assert.equal(quote.paymentAmount, 5700);
});

test("stronger loyalty wins while promo and certificate remain separate", () => {
  const quote = quoteDiscountedCart({
    products: [{ price: 5800, quantity: 1 }], loyaltyPercent: 10, loyaltyEnabled: true, promoFixed: 300, bonus: 300,
  });
  assert.equal(quote.source, "loyalty");
  assert.equal(quote.primaryDiscount, 580);
  assert.equal(quote.bonus, 300);
  assert.equal(quote.paymentAmount, 4920);
});

test("per-unit allocation can split a multiple-quantity line", () => {
  const quote = quoteDiscountedCart({ products: [{ price: 0.01, quantity: 3 }], promoFixed: 0.01 });
  assert.deepEqual(quote.items.map((item) => item.payable), [0, 0.01, 0.01]);
  assert.equal(quote.paymentAmount, 0.02);
  assert.equal(quote.needsZeroValueHandling, true);
  assert.deepEqual(quote.paymentLines.map((line) => [line.unitPrice, line.quantity]), [[0.01, 2]]);
});

test("rejects invalid amounts and fractional quantities", () => {
  assert.throws(() => quoteDiscountedCart({ products: [{ price: -1, quantity: 1 }] }), RangeError);
  assert.throws(() => quoteDiscountedCart({ products: [{ price: 100, quantity: 1.5 }] }), RangeError);
});

test("receipt lines reconcile across varied prices, quantities, discounts and delivery", () => {
  for (let seed = 1; seed <= 500; seed += 1) {
    const a = (seed * 937) % 7000 + 1;
    const b = (seed * 1667) % 9000 + 1;
    const subtotalCents = a * (seed % 3 + 1) + b * (seed % 4 + 1);
    const quote = quoteDiscountedCart({
      products: [{ name: "A", price: a / 100, quantity: seed % 3 + 1 }, { name: "B", price: b / 100, quantity: seed % 4 + 1 }],
      promoPercent: seed % 11,
      promoFixed: seed % 2 ? 0 : Math.floor(subtotalCents / 4) / 100,
      loyaltyPercent: 5,
      loyaltyEnabled: seed % 3 === 0,
      bonus: Math.min(3, subtotalCents / 100),
      delivery: 4.99,
      freeDeliveryThreshold: 100,
    });
    const itemCents = quote.paymentLines.reduce((sum, line) => sum + Math.round(line.unitPrice * 100) * line.quantity, 0);
    assert.equal(itemCents, Math.round(quote.paymentAmount * 100), `seed ${seed}`);
    assert.equal(
      Math.round((quote.subtotal - quote.primaryDiscount - quote.bonus + quote.delivery) * 100),
      Math.round(quote.paymentAmount * 100),
      `seed ${seed}`,
    );
  }
});
