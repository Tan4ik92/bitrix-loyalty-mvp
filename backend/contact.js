export const loyaltyFields = {
  balance: "ufCrm_V2SD_LOYALTY_BALANCE",
  welcomeBonusUsed: "ufCrm_1785404715609",
  welcomeBonusExpired: "ufCrm_1785404729711",
  birthdayBonusAccrued: "ufCrm_V2SD_BIRTHDAY_BONUS_ACCRUED",
  birthdayBonusUsed: "ufCrm_V2SD_BIRTHDAY_BONUS_USED",
  birthdayBonusExpired: "ufCrm_V2SD_BIRTHDAY_BONUS_EXPIRED",
  birthdayBonusAccruedAt: "ufCrm_V2SD_BIRTHDAY_BONUS_ACCRUED_AT",
  birthdayBonusExpiresAt: "ufCrm_V2SD_BIRTHDAY_BONUS_EXPIRES_AT",
  birthdayBonusLastYear: "ufCrm_V2SD_BIRTHDAY_BONUS_LAST_YEAR",
  purchaseSum: "ufCrm_V2SD_PURCHASE_SUM",
  nocodbUserId: "ufCrm_V2SD_NOCODB_USER_ID",
  discountPercent: "ufCrm_V2SD_BONUS_PERCENT",
  ordersCount: "ufCrm_V2SD_ORDERS_COUNT",
  lastOrderNumber: "ufCrm_V2SD_LAST_ORDER_NUMBER",
  lastOrderDate: "ufCrm_V2SD_LAST_ORDER_DATE",
  lastOrderSum: "ufCrm_V2SD_LAST_ORDER_SUM",
  accruedTotal: "ufCrm_V2SD_BONUS_ACCRUED_TOTAL",
  spentTotal: "ufCrm_V2SD_BONUS_SPENT_TOTAL",
  syncedAt: "ufCrm_V2SD_LOYALTY_SYNCED_AT",
  registeredAt: "ufCrm_V2SD_REGISTERED_AT",
};

export function normalizeSearchQuery(value) {
  const query = String(value || "").trim();
  if (!query) return null;
  if (query.includes("@")) return { type: "email", value: query.toLowerCase() };

  const digits = query.replace(/\D/g, "");
  if (digits.length < 7) return null;
  const normalized = digits.length === 11 && digits.startsWith("8") ? `7${digits.slice(1)}` : digits;
  return { type: "phone", value: normalized };
}

export function buildContactSearch(search) {
  const select = [
    "id", "name", "lastName", "secondName", "phone", "email", "birthdate", "createdAt",
    ...Object.values(loyaltyFields),
  ];
  return {
    filter: { [search.type]: { $contains: search.value } },
    select,
    sort: { id: "DESC" },
    limit: 50,
  };
}

export function selectBestContact(raw, search) {
  const exact = selectMatchingContacts(raw, search);
  return {
    contact: exact[0] || null,
    matches: exact.length,
  };
}

export function selectMatchingContacts(raw, search) {
  return asArray(raw)
    .filter((contact) => contactMatches(contact, search))
    .sort((a, b) => Number(b.id || b.ID || 0) - Number(a.id || a.ID || 0));
}

export function mapContact(contact) {
  if (!contact) return null;
  const id = contact.id || contact.ID;
  const name = contact.name || contact.NAME;
  const lastName = contact.lastName || contact.LAST_NAME;
  const secondName = contact.secondName || contact.SECOND_NAME;
  const phone = contact.phone || contact.PHONE;
  const email = contact.email || contact.EMAIL;
  const phones = communicationValues(phone);
  const emails = communicationValues(email);
  const welcomeBonusAccrued = numberOrNull(contact[loyaltyFields.balance]);
  const welcomeBonusUsed = numberOrNull(contact[loyaltyFields.welcomeBonusUsed]);
  const welcomeBonusExpired = numberOrNull(contact[loyaltyFields.welcomeBonusExpired]);
  const birthdayBonus = buildBirthdayBonusState({
    accrued: contact[loyaltyFields.birthdayBonusAccrued],
    used: contact[loyaltyFields.birthdayBonusUsed],
    expired: contact[loyaltyFields.birthdayBonusExpired],
    accruedAt: contact[loyaltyFields.birthdayBonusAccruedAt],
    expiresAt: contact[loyaltyFields.birthdayBonusExpiresAt],
    lastYear: contact[loyaltyFields.birthdayBonusLastYear],
  });
  const accruedTotal = numberOrNull(contact[loyaltyFields.accruedTotal]);
  const spentTotal = numberOrNull(contact[loyaltyFields.spentTotal]);
  const ordersCount = numberOrNull(contact[loyaltyFields.ordersCount]);
  const registeredAt = contact[loyaltyFields.registeredAt] || null;
  const welcomeBonus = buildWelcomeBonusState({
    accrued: welcomeBonusAccrued,
    used: welcomeBonusUsed,
    expired: welcomeBonusExpired,
    registeredAt,
    ordersCount,
  });
  return {
    id,
    name: name || "",
    lastName: lastName || "",
    secondName: secondName || "",
    fullName: [lastName, name, secondName].filter(Boolean).join(" ").trim(),
    phone: phones[0] || "",
    email: emails[0] || "",
    phones,
    emails,
    birthdate: contact.birthdate || contact.BIRTHDATE || null,
    createdAt: contact.createdAt || contact.DATE_CREATE || null,
    loyalty: {
      balance: welcomeBonus.available + birthdayBonus.available,
      purchaseSum: numberOrZero(contact[loyaltyFields.purchaseSum]),
      discountPercent: numberOrZero(contact[loyaltyFields.discountPercent]),
      ordersCount,
      lastOrderNumber: contact[loyaltyFields.lastOrderNumber] || "",
      lastOrderDate: contact[loyaltyFields.lastOrderDate] || null,
      lastOrderSum: numberOrNull(contact[loyaltyFields.lastOrderSum]),
      accruedTotal,
      spentTotal,
      syncedAt: contact[loyaltyFields.syncedAt] || null,
      registeredAt,
      nocodbUserId: contact[loyaltyFields.nocodbUserId] || null,
      welcomeBonus,
      birthdayBonus,
    },
  };
}

export function buildBirthdayBonusState({
  accrued,
  used,
  expired,
  accruedAt,
  expiresAt,
  lastYear,
  today = new Date(),
} = {}) {
  const accruedAmount = numberOrZero(accrued);
  const usedAmount = Math.min(numberOrZero(used), accruedAmount);
  const expiredAmount = Math.min(numberOrZero(expired), Math.max(0, accruedAmount - usedAmount));
  const remaining = Math.max(0, roundMoney(accruedAmount - usedAmount - expiredAmount));
  const expiredByDate = Boolean(expiresAt) && compareDateOnly(expiresAt, today) < 0;
  const available = expiredByDate ? 0 : remaining;

  return {
    accrued: accruedAmount,
    used: usedAmount,
    expired: expiredAmount,
    accruedAt: accruedAt || null,
    expiresAt: expiresAt || null,
    lastYear: numberOrNull(lastYear),
    available,
    eligible: available > 0,
    shouldExpire: remaining > 0 && expiredByDate,
    reason: accruedAmount <= 0 ? "not_accrued" : expiredByDate ? "expired_by_date" : available > 0 ? "active" : "spent_or_expired",
  };
}

export function buildWelcomeBonusState({
  accrued,
  used,
  expired,
  registeredAt,
  ordersCount,
  defaultAmount = 300,
} = {}) {
  const accruedAmount = numberOrZero(accrued);
  const usedAmount = numberOrZero(used);
  const expiredAmount = numberOrZero(expired);
  const hasRegistration = Boolean(registeredAt);
  const knownOrdersCount = numberOrNull(ordersCount);
  const hasOrders = knownOrdersCount !== null && knownOrdersCount > 0;

  if (usedAmount > 0) {
    return {
      accrued: accruedAmount,
      used: usedAmount,
      expired: expiredAmount,
      available: 0,
      eligible: false,
      shouldAccrue: false,
      shouldExpire: false,
      reason: "used",
    };
  }

  if (expiredAmount > 0) {
    return {
      accrued: accruedAmount,
      used: usedAmount,
      expired: expiredAmount,
      available: 0,
      eligible: false,
      shouldAccrue: false,
      shouldExpire: false,
      reason: "expired",
    };
  }

  if (accruedAmount > 0) {
    return {
      accrued: accruedAmount,
      used: usedAmount,
      expired: expiredAmount,
      available: hasOrders ? 0 : accruedAmount,
      eligible: !hasOrders,
      shouldAccrue: false,
      shouldExpire: hasOrders,
      reason: hasOrders ? "orders_exist" : "first_order",
    };
  }

  if (hasRegistration) {
    return {
      accrued: accruedAmount,
      used: usedAmount,
      expired: expiredAmount,
      available: hasOrders ? 0 : defaultAmount,
      eligible: !hasOrders,
      shouldAccrue: !hasOrders,
      shouldExpire: hasOrders,
      reason: hasOrders ? "registered_after_first_order" : "registered_missing_accrual",
    };
  }

  return {
    accrued: accruedAmount,
    used: usedAmount,
    expired: expiredAmount,
    available: 0,
    eligible: false,
    shouldAccrue: false,
    shouldExpire: false,
    reason: "not_registered",
  };
}

function contactMatches(contact, search) {
  if (search.type === "email") {
    return communicationValues(contact.email || contact.EMAIL).some((value) => value.toLowerCase() === search.value);
  }
  return communicationValues(contact.phone || contact.PHONE).some((value) => {
    const digits = value.replace(/\D/g, "");
    const normalized = digits.length === 11 && digits.startsWith("8") ? `7${digits.slice(1)}` : digits;
    return normalized === search.value || normalized.endsWith(search.value) || search.value.endsWith(normalized);
  });
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.items)) return value.items;
  if (Array.isArray(value?.contacts)) return value.contacts;
  if (Array.isArray(value?.result)) return value.result;
  return [];
}

function communicationValues(value) {
  if (!value) return [];
  const values = Array.isArray(value) ? value : [value];
  return values.map((item) => String(item?.value ?? item?.VALUE ?? item ?? "").trim()).filter(Boolean);
}

function firstCommunication(value) {
  return communicationValues(value)[0] || "";
}

function numberOrZero(value) {
  return numberOrNull(value) ?? 0;
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(String(value).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(number) ? number : null;
}

function compareDateOnly(value, today) {
  const left = dateOnly(value);
  const right = dateOnly(today);
  if (!left || !right) return 0;
  return left < right ? -1 : left > right ? 1 : 0;
}

function dateOnly(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  const match = String(value || "").match(/^\d{4}-\d{2}-\d{2}/);
  if (match) return match[0];
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function roundMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}
