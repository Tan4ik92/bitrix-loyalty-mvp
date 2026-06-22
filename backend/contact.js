export const loyaltyFields = {
  balance: "ufCrm_V2SD_LOYALTY_BALANCE",
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
  const contacts = asArray(raw);
  const exact = contacts.filter((contact) => contactMatches(contact, search));
  return {
    contact: exact.sort((a, b) => Number(b.id || b.ID || 0) - Number(a.id || a.ID || 0))[0] || null,
    matches: exact.length,
  };
}

export function mapContact(contact) {
  if (!contact) return null;
  const id = contact.id || contact.ID;
  return {
    id,
    fullName: [contact.lastName, contact.name, contact.secondName].filter(Boolean).join(" ").trim(),
    phone: firstCommunication(contact.phone),
    email: firstCommunication(contact.email),
    birthdate: contact.birthdate || null,
    createdAt: contact.createdAt || null,
    loyalty: {
      balance: numberOrZero(contact[loyaltyFields.balance]),
      purchaseSum: numberOrZero(contact[loyaltyFields.purchaseSum]),
      discountPercent: numberOrZero(contact[loyaltyFields.discountPercent]),
      ordersCount: numberOrNull(contact[loyaltyFields.ordersCount]),
      lastOrderNumber: contact[loyaltyFields.lastOrderNumber] || "",
      lastOrderDate: contact[loyaltyFields.lastOrderDate] || null,
      lastOrderSum: numberOrNull(contact[loyaltyFields.lastOrderSum]),
      accruedTotal: numberOrNull(contact[loyaltyFields.accruedTotal]),
      spentTotal: numberOrNull(contact[loyaltyFields.spentTotal]),
      syncedAt: contact[loyaltyFields.syncedAt] || null,
      registeredAt: contact[loyaltyFields.registeredAt] || null,
      nocodbUserId: contact[loyaltyFields.nocodbUserId] || null,
    },
  };
}

function contactMatches(contact, search) {
  if (search.type === "email") {
    return communicationValues(contact.email).some((value) => value.toLowerCase() === search.value);
  }
  return communicationValues(contact.phone).some((value) => {
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
