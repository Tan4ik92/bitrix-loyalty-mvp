// Pure checkout quote. All amounts are integer kopecks until the final output.
const toCents = (value) => {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new RangeError("Invalid money amount");
  const cents = Math.round((number + Number.EPSILON) * 100);
  if (!Number.isSafeInteger(cents)) throw new RangeError("Money amount is too large");
  return cents;
};
const toRubles = (cents) => cents / 100;

function allocateCents(units, amount, capacityKey) {
  const capacity = units.reduce((sum, unit) => sum + unit[capacityKey], 0);
  if (!Number.isSafeInteger(amount) || amount < 0 || amount > capacity) {
    throw new RangeError("Discount exceeds eligible products");
  }
  if (!amount) return units.map(() => 0);
  const shares = units.map((unit, index) => {
    const numerator = unit[capacityKey] * amount;
    return { index, whole: Math.floor(numerator / capacity), remainder: numerator % capacity };
  });
  let left = amount - shares.reduce((sum, share) => sum + share.whole, 0);
  shares.sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  for (const share of shares) {
    if (!left) break;
    if (share.whole < units[share.index][capacityKey]) {
      share.whole += 1;
      left -= 1;
    }
  }
  if (left) throw new Error("Discount allocation did not reconcile");
  return shares.sort((a, b) => a.index - b.index).map((share) => share.whole);
}

export function quoteDiscountedCart({
  products,
  loyaltyPercent = 0,
  loyaltyEnabled = false,
  promoPercent = 0,
  promoFixed = 0,
  bonus = 0,
  delivery = 0,
  freeDeliveryThreshold = null,
} = {}) {
  if (!Array.isArray(products) || !products.length) throw new RangeError("Products are required");
  const units = [];
  products.forEach((product, sourceIndex) => {
    const quantity = Number(product.quantity);
    if (!Number.isSafeInteger(quantity) || quantity < 1 || units.length + quantity > 1000) {
      throw new RangeError("Unsupported product quantity");
    }
    const original = toCents(product.price);
    for (let unitIndex = 0; unitIndex < quantity; unitIndex += 1) {
      units.push({ sourceIndex, unitIndex, original, afterPrimary: original });
    }
  });
  const subtotal = units.reduce((sum, unit) => sum + unit.original, 0);
  const loyaltyRate = Number(loyaltyPercent);
  const promoRate = Number(promoPercent);
  if (![loyaltyRate, promoRate].every((rate) => Number.isFinite(rate) && rate >= 0 && rate <= 100)) {
    throw new RangeError("Invalid discount percentage");
  }
  const loyaltyAmount = loyaltyEnabled ? Math.round(subtotal * loyaltyRate / 100) : 0;
  const promoAmount = promoFixed > 0
    ? Math.min(subtotal, toCents(promoFixed))
    : Math.round(subtotal * promoRate / 100);
  const source = loyaltyAmount > promoAmount ? "loyalty" : promoAmount > 0 ? "promo" : "none";
  const primaryAmount = source === "loyalty" ? loyaltyAmount : promoAmount;
  const primaryShares = allocateCents(units, primaryAmount, "original");
  units.forEach((unit, index) => { unit.afterPrimary -= primaryShares[index]; });
  const afterPrimary = subtotal - primaryAmount;
  const requestedBonus = toCents(bonus);
  const bonusAmount = Math.min(afterPrimary, requestedBonus);
  const bonusShares = allocateCents(units, bonusAmount, "afterPrimary");
  const items = units.map((unit, index) => ({
    sourceIndex: unit.sourceIndex,
    unitIndex: unit.unitIndex,
    name: String(products[unit.sourceIndex].name || ""),
    sku: String(products[unit.sourceIndex].sku || ""),
    original: toRubles(unit.original),
    primaryDiscount: toRubles(primaryShares[index]),
    bonusDiscount: toRubles(bonusShares[index]),
    payable: toRubles(unit.afterPrimary - bonusShares[index]),
  }));
  const productsPayable = afterPrimary - bonusAmount;
  const deliveryCents = toCents(delivery);
  const threshold = freeDeliveryThreshold === null ? null : toCents(freeDeliveryThreshold);
  const chargedDelivery = threshold !== null && productsPayable >= threshold ? 0 : deliveryCents;
  const paymentAmount = productsPayable + chargedDelivery;
  const paymentLines = [];
  for (const item of items) {
    if (item.payable === 0) continue;
    const previous = paymentLines.at(-1);
    if (previous && previous.sourceIndex === item.sourceIndex && previous.unitPrice === item.payable) {
      previous.quantity += 1;
    } else {
      paymentLines.push({ sourceIndex: item.sourceIndex, name: item.name, sku: item.sku, unitPrice: item.payable, quantity: 1 });
    }
  }
  if (chargedDelivery > 0) {
    paymentLines.push({ sourceIndex: null, name: "Доставка", sku: "", unitPrice: toRubles(chargedDelivery), quantity: 1 });
  }
  if (items.reduce((sum, item) => sum + toCents(item.payable), 0) !== productsPayable) {
    throw new Error("Payment item totals do not reconcile");
  }
  if (paymentLines.reduce((sum, line) => sum + toCents(line.unitPrice) * line.quantity, 0) !== paymentAmount) {
    throw new Error("Payment receipt total does not reconcile");
  }
  return {
    source,
    subtotal: toRubles(subtotal),
    primaryDiscount: toRubles(primaryAmount),
    bonus: toRubles(bonusAmount),
    productsPayable: toRubles(productsPayable),
    delivery: toRubles(chargedDelivery),
    paymentAmount: toRubles(paymentAmount),
    needsNonstandardCheckout: bonusAmount > 0 || (source === "loyalty" && promoAmount > 0),
    needsZeroValueHandling: productsPayable === 0 || items.some((item) => item.payable === 0),
    items,
    paymentLines,
  };
}
