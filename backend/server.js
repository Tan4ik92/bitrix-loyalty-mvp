import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildContactSearch, loyaltyFields, mapContact, normalizeSearchQuery, selectBestContact } from "./contact.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const frontend = path.join(root, "frontend");
loadEnv(path.join(root, ".env"));

const fallbackEnv = process.env.LEGACY_ENV_FILE ||
  path.resolve(root, "..", "api-vibecode-vibe-api-76zodj3ui3hx42zrvd1qrk8lqvszr6u4-8945d5-2", ".env");
loadEnv(fallbackEnv, new Set(["VIBECODE_API_BASE", "VIBECODE_API_KEY"]));

const port = Number(process.env.PORT || 3100);
const bitrixBaseUrl = String(process.env.VIBECODE_API_BASE || "https://vibecode.bitrix24.tech").replace(/\/$/, "");
const bitrixApiKey = process.env.VIBECODE_API_KEY || "";
const catalogYmlUrl = process.env.CATALOG_YML_URL || "https://v2sportdress.ru/tstore/yml/1c781fefd7ce0002bb2833762b25baf7.yml";
const catalogCacheFile = path.join(root, "backend", "catalog-cache.json");
const catalogSyncIntervalMs = Number(process.env.BITRIX_CATALOG_SYNC_INTERVAL_MS || 5 * 60 * 1000);
const tildaSignupUrl = process.env.TILDA_SIGNUP_URL || "https://v2sportdress.ru/members/signup";
const tildaFormsEndpoint = process.env.TILDA_FORMS_ENDPOINT || "https://forms.tildacdn.com/procces/";
const tildaSignupEnabled = process.env.TILDA_SIGNUP_ENABLED !== "0";
let catalogPriceCache = null;
let catalogPriceCacheExpiresAt = 0;
let catalogProductsCache = [];
let catalogProductsCacheUpdatedAt = null;
let catalogSyncInFlight = null;
let tildaSignupFormCache = null;
let tildaSignupFormCacheExpiresAt = 0;
const pendingTildaSignups = new Map();

loadCatalogCacheFromDisk();

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

    if (req.method === "OPTIONS") {
      res.writeHead(204, corsHeaders());
      return res.end();
    }

    if (req.method === "GET" && url.pathname === "/api/health") {
      return json(res, bitrixApiKey ? 200 : 503, {
        ok: Boolean(bitrixApiKey),
        bitrixConfigured: Boolean(bitrixApiKey),
      });
    }

    if (req.method === "GET" && url.pathname === "/api/contacts/search") {
      if (!bitrixApiKey) return json(res, 503, { error: "Не настроен VIBECODE_API_KEY." });
      const search = normalizeSearchQuery(url.searchParams.get("q"));
      if (!search) return json(res, 400, { error: "Введите корректный email или телефон." });

      const raw = await bitrixRequest("/v1/contacts/search", {
        method: "POST",
        body: JSON.stringify(buildContactSearch(search)),
      });
      const result = selectBestContact(raw, search);
      return json(res, 200, {
        contact: mapContact(result.contact),
        matches: result.matches,
      });
    }

    if (req.method === "POST" && url.pathname === "/api/contacts") {
      if (!bitrixApiKey) return json(res, 503, { error: "VIBECODE_API_KEY is not configured." });
      const payload = await readJson(req);
      const registration = normalizeRegistration(payload);
      if (registration.email && !isValidEmail(registration.email)) {
        return json(res, 400, { error: "Введите корректный email, например client@mail.ru." });
      }
      if (!registration.phone && !registration.email) {
        return json(res, 400, { error: "Введите телефон или email." });
      }

      const existing = await findExistingRegistrationContact(registration);
      if (existing) {
        const fields = buildRegistrationUpdateFields(registration, existing);
        if (Object.keys(fields).length) {
          await bitrixRequest(`/v1/contacts/${existing.id || existing.ID}`, {
            method: "PATCH",
            body: JSON.stringify(fields),
          });
        }
        const updated = await bitrixRequest(`/v1/contacts/${existing.id || existing.ID}`);
        const siteRegistration = await registerTildaMemberSafe(registration);
        return json(res, 200, {
          action: Object.keys(fields).length ? "updated_existing_contact" : "existing_contact",
          contact: mapContact(updated),
          siteRegistration,
        });
      }

      const created = await bitrixRequest("/v1/contacts", {
        method: "POST",
        body: JSON.stringify(buildRegistrationCreateFields(registration)),
      });
      const createdId = created?.id || created?.ID || created?.contact?.id || created?.contact?.ID;
      const contact = createdId ? await bitrixRequest(`/v1/contacts/${createdId}`) : created;
      const siteRegistration = await registerTildaMemberSafe(registration);
      return json(res, 201, {
        action: "created_contact",
        contact: mapContact(contact),
        siteRegistration,
      });
    }

    if (req.method === "GET" && url.pathname === "/api/account/profile") {
      if (!bitrixApiKey) return json(res, 503, { error: "VIBECODE_API_KEY is not configured." });
      const account = await loadAccountProfile({
        contactId: clean(url.searchParams.get("contactId") || url.searchParams.get("id")),
        email: normalizeEmail(url.searchParams.get("email")),
        limit: Number(url.searchParams.get("limit") || 50),
        offset: Number(url.searchParams.get("offset") || 0),
        includeOrders: url.searchParams.get("includeOrders") !== "false",
      });
      return json(res, 200, account);
    }

    if (req.method === "POST" && url.pathname === "/api/account/profile/birthdate") {
      if (!bitrixApiKey) return json(res, 503, { error: "VIBECODE_API_KEY is not configured." });
      const payload = await readJson(req);
      const email = normalizeEmail(payload.email);
      const birthdate = normalizeBirthdate(payload.birthdate);
      if (!birthdate) return json(res, 400, { error: "Укажите дату рождения в формате ГГГГ-ММ-ДД." });

      const contact = await findAccountContact({
        contactId: clean(payload.contactId || payload.id),
        email,
      });
      if (!contact) return json(res, 404, { error: "Контакт не найден в Bitrix." });

      const contactId = contact.id || contact.ID;
      await bitrixRequest(`/v1/contacts/${encodeURIComponent(contactId)}`, {
        method: "PATCH",
        body: JSON.stringify({ birthdate }),
      });
      const updated = await bitrixRequest(`/v1/contacts/${encodeURIComponent(contactId)}`);
      return json(res, 200, { contact: mapContact(updated) });
    }

    if (req.method === "GET" && url.pathname === "/api/products") {
      if (!bitrixApiKey) return json(res, 503, { error: "VIBECODE_API_KEY is not configured." });
      const query = String(url.searchParams.get("q") || "").trim();
      const products = await getCachedCatalogProducts(query);
      return json(res, 200, {
        products,
        meta: {
          cached: true,
          total: catalogProductsCache.length,
          syncedAt: catalogProductsCacheUpdatedAt,
        },
      });
    }

    if (req.method === "GET" && url.pathname === "/api/tilda/signup/captcha") {
      const draftId = clean(url.searchParams.get("draft"));
      const draft = getPendingTildaSignup(draftId);
      if (!draft) return json(res, 404, { error: "Регистрация на сайте устарела, создайте клиента заново." });
      return json(res, 200, {
        draftId,
        captchaUrl: buildTildaCaptchaUrl(draft.form),
        contact: {
          name: [draft.registration.firstName, draft.registration.lastName].filter(Boolean).join(" "),
          email: draft.registration.email,
          phone: draft.registration.phone,
        },
      });
    }

    if (req.method === "POST" && url.pathname === "/api/tilda/signup/complete") {
      const payload = await readJson(req);
      const draftId = clean(payload.draftId);
      const captchaToken = clean(payload.captchaToken);
      const draft = getPendingTildaSignup(draftId);
      if (!draft) return json(res, 404, { error: "Регистрация на сайте устарела, создайте клиента заново." });
      if (!captchaToken) return json(res, 400, { error: "Tilda не вернула captcha-токен." });
      const result = await registerTildaMember(draft.registration, captchaToken, draft.form);
      pendingTildaSignups.delete(draftId);
      return json(res, 200, result);
    }

    if (req.method !== "GET" && req.method !== "HEAD") return json(res, 405, { error: "Метод не поддерживается." });
    return serveStatic(res, url.pathname);
  } catch (error) {
    console.error(error);
    return json(res, 502, { error: friendlyError(error) });
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Bitrix loyalty MVP: http://127.0.0.1:${port}`);
  console.log(`Bitrix API configured: ${bitrixApiKey ? "yes" : "no"}`);
  startCatalogSyncLoop();
});

async function bitrixRequest(apiPath, options = {}) {
  const response = await fetch(`${bitrixBaseUrl}${apiPath}`, {
    ...options,
    signal: AbortSignal.timeout(30000),
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${bitrixApiKey}`,
      "X-Api-Key": bitrixApiKey,
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = text; }
  if (!response.ok || payload?.success === false) {
    throw new Error(`Bitrix API ${response.status}: ${JSON.stringify(payload)}`);
  }
  return payload?.data ?? payload;
}

async function loadAccountProfile({ contactId, email, limit = 50, offset = 0, includeOrders = true }) {
  const contact = await findAccountContact({ contactId, email });
  if (!contact) {
    return {
      contact: null,
      orders: [],
      promo: null,
      meta: { found: false, limit, offset },
    };
  }

  const mapped = mapContact(contact);
  const orders = includeOrders ? await loadContactDeals(mapped.id, { limit, offset }) : [];
  const promo = buildAccountPromo(mapped);
  return {
    contact: mapped,
    orders,
    promo,
    meta: {
      found: true,
      limit,
      offset,
      generatedAt: new Date().toISOString(),
    },
  };
}

async function findAccountContact({ contactId, email }) {
  if (contactId) {
    try {
      const byId = await bitrixRequest(`/v1/contacts/${encodeURIComponent(contactId)}`);
      const contactEmail = normalizeEmail(mapContact(byId)?.email);
      if (!email || contactEmail === email) return byId;
    } catch (error) {
      if (!email) throw error;
    }
  }
  const search = normalizeSearchQuery(email);
  if (!search) throw new Error("Для личного кабинета нужен email или Bitrix contactId.");
  const raw = await bitrixRequest("/v1/contacts/search", {
    method: "POST",
    body: JSON.stringify(buildContactSearch(search)),
  });
  return selectBestContact(raw, search).contact;
}

async function loadContactDeals(contactId, { limit = 50, offset = 0 } = {}) {
  const raw = await bitrixRequest("/v1/deals/search", {
    method: "POST",
    body: JSON.stringify({
      filter: { contactId: Number(contactId) || contactId },
      select: [
        "id", "title", "amount", "opportunity", "currency", "createdAt", "updatedAt",
        "begindate", "closedAt", "stageId", "closed", "contactId", "ufCrm_V2SD_ORDER_BONUS_ADDED",
        "ufCrm_V2SD_ORDER_BONUS_USED", "ufCrm_V2SD_ORDER_DISCOUNT_PERCENT",
      ],
      sort: { id: "DESC" },
      limit: Math.min(Math.max(Number(limit) || 50, 1), 100),
      offset: Math.max(Number(offset) || 0, 0),
    }),
  });
  const deals = asArray(raw);
  return Promise.all(deals.map(mapAccountDeal));
}

async function mapAccountDeal(deal) {
  const id = deal.id || deal.ID;
  let products = [];
  try {
    products = asArray(await bitrixRequest(`/v1/deals/${encodeURIComponent(id)}/products`))
      .map(mapDealProduct)
      .filter((product) => product.name);
  } catch (error) {
    console.warn(`Deal products load failed for ${id}: ${error.message}`);
  }
  const amount = numberOrZero(deal.amount ?? deal.opportunity ?? deal.OPPORTUNITY);
  return {
    id,
    title: deal.title || deal.TITLE || `Заказ ${id}`,
    date: deal.createdAt || deal.DATE_CREATE || deal.begindate || deal.BEGINDATE || null,
    sum: amount,
    currency: deal.currency || deal.CURRENCY || "RUB",
    stageId: deal.stageId || deal.STAGE_ID || "",
    closed: Boolean(deal.closed || deal.CLOSED === "Y"),
    products,
    composition: products.length ? products.map((product) => product.name).join(", ") : (deal.title || `Заказ ${id}`),
    bonusAdded: numberOrNull(deal.ufCrm_V2SD_ORDER_BONUS_ADDED),
    bonusUsed: numberOrNull(deal.ufCrm_V2SD_ORDER_BONUS_USED),
    discountPercent: numberOrNull(deal.ufCrm_V2SD_ORDER_DISCOUNT_PERCENT),
  };
}

function mapDealProduct(row) {
  return {
    id: row.id || row.ID,
    productId: row.productId || row.PRODUCT_ID,
    name: row.productName || row.PRODUCT_NAME || row.name || row.NAME || "",
    quantity: numberOrZero(row.quantity || row.QUANTITY || 1),
    price: numberOrZero(row.price || row.PRICE),
    sum: numberOrZero(row.price || row.PRICE) * numberOrZero(row.quantity || row.QUANTITY || 1),
  };
}

function buildAccountPromo(contact) {
  const discountPercent = numberOrZero(contact?.loyalty?.discountPercent);
  if (!discountPercent) return null;
  return {
    code: `V2SD${contact.id}`,
    discountPercent,
    text: `Ваша скидка ${discountPercent}%`,
  };
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf8").trim();
  if (!text) return {};
  return JSON.parse(text);
}

function normalizeRegistration(payload = {}) {
  const firstName = clean(payload.firstName || payload.name);
  const lastName = clean(payload.lastName);
  const phone = normalizePhone(payload.phone);
  const email = normalizeEmail(payload.email);
  return {
    firstName,
    lastName,
    phone,
    email,
  };
}

async function findExistingRegistrationContact(registration) {
  const searches = [];
  if (registration.email) searches.push(normalizeSearchQuery(registration.email));
  if (registration.phone) searches.push(normalizeSearchQuery(registration.phone));

  const matches = [];
  for (const search of searches.filter(Boolean)) {
    const raw = await bitrixRequest("/v1/contacts/search", {
      method: "POST",
      body: JSON.stringify(buildContactSearch(search)),
    });
    const result = selectBestContact(raw, search);
    if (result.contact) matches.push(result.contact);
  }

  return matches
    .sort((a, b) => Number(b.id || b.ID || 0) - Number(a.id || a.ID || 0))[0] || null;
}

function buildRegistrationCreateFields(registration) {
  const now = new Date().toISOString();
  const fields = {
    name: registration.firstName || "Клиент",
    lastName: registration.lastName || "",
    [loyaltyFields.balance]: 300,
    [loyaltyFields.purchaseSum]: 0,
    [loyaltyFields.ordersCount]: 0,
    [loyaltyFields.discountPercent]: 0,
    [loyaltyFields.accruedTotal]: 300,
    [loyaltyFields.spentTotal]: 0,
    [loyaltyFields.registeredAt]: now,
    [loyaltyFields.syncedAt]: now,
  };
  if (registration.phone) fields.phone = [{ value: registration.phone, valueType: "WORK" }];
  if (registration.email) fields.email = [{ value: registration.email, valueType: "WORK" }];
  return fields;
}

function buildRegistrationUpdateFields(registration, current) {
  const fields = {};
  if (registration.firstName && !clean(current.name || current.NAME)) fields.name = registration.firstName;
  if (registration.lastName && !clean(current.lastName || current.LAST_NAME)) fields.lastName = registration.lastName;
  if (registration.phone && !communicationValues(current.phone || current.PHONE).map(normalizePhone).includes(registration.phone)) {
    fields.phone = [{ value: registration.phone, valueType: "WORK" }];
  }
  if (registration.email && !communicationValues(current.email || current.EMAIL).map(normalizeEmail).includes(registration.email)) {
    fields.email = [{ value: registration.email, valueType: "WORK" }];
  }
  if (!current[loyaltyFields.registeredAt]) fields[loyaltyFields.registeredAt] = new Date().toISOString();
  return fields;
}

async function registerTildaMemberSafe(registration) {
  if (!tildaSignupEnabled) return { ok: false, skipped: true, error: "Tilda signup is disabled." };
  if (!registration.email) return { ok: false, skipped: true, error: "Для регистрации на сайте нужен email." };

  try {
    return await registerTildaMember(registration);
  } catch (error) {
    console.warn(`Tilda signup failed: ${error.message}`);
    return { ok: false, error: error.message };
  }
}

async function registerTildaMember(registration, captchaToken = "", formOverride = null) {
  const form = formOverride || await loadTildaSignupForm();
  const phoneDigits = digitsOnly(registration.phone);
  const fullName = [registration.firstName, registration.lastName].filter(Boolean).join(" ").trim();
  const payload = new URLSearchParams();

  for (const service of form.services) payload.append("formservices[]", service);
  payload.set("Email", registration.email);
  payload.set("Name", fullName || registration.email);
  if (phoneDigits) payload.set("Phone", phoneDigits);
  payload.set("form-spec-comments", "");
  payload.set("tildaspec-cookie", "");
  payload.set("tildaspec-referer", tildaSignupUrl);
  payload.set("tildaspec-formid", form.formId);
  payload.set("tildaspec-formskey", form.formsKey);
  payload.set("tildaspec-version-lib", "02.001");
  payload.set("tildaspec-pageid", form.pageId);
  payload.set("tildaspec-projectid", form.projectId);
  payload.set("tildaspec-lang", form.lang || "RU");
  payload.set("tildaspec-fp", `server-${Date.now()}`);
  if (captchaToken) payload.set("tildaspec-tildacaptcha", captchaToken);

  const response = await fetch(tildaFormsEndpoint, {
    method: "POST",
    signal: AbortSignal.timeout(30000),
    headers: {
      Accept: "application/json, text/javascript, */*; q=0.01",
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      Referer: tildaSignupUrl,
      Origin: new URL(tildaSignupUrl).origin,
    },
    body: payload.toString(),
  });

  const text = await response.text();
  let result = null;
  try { result = text ? JSON.parse(text) : null; } catch { result = text; }
  if (!response.ok) throw new Error(`Tilda forms ${response.status}: ${shortenText(text)}`);
  if (result?.needcaptcha) return createPendingTildaSignup(registration, form);
  if (result?.error) throw new Error(`Tilda: ${stripHtml(result.error)}`);

  return {
    ok: true,
    endpoint: tildaFormsEndpoint,
    formId: form.formId,
    response: summarizeTildaResponse(result),
  };
}

function createPendingTildaSignup(registration, form) {
  const draftId = randomId();
  cleanupPendingTildaSignups();
  pendingTildaSignups.set(draftId, {
    registration,
    form,
    expiresAt: Date.now() + 15 * 60 * 1000,
  });
  return {
    ok: false,
    needCaptcha: true,
    error: "Tilda запросила капчу. Нажмите кнопку завершения регистрации на сайте.",
    completeUrl: `/tilda-captcha.html?draft=${encodeURIComponent(draftId)}`,
  };
}

function getPendingTildaSignup(draftId) {
  cleanupPendingTildaSignups();
  return pendingTildaSignups.get(draftId) || null;
}

function cleanupPendingTildaSignups() {
  const now = Date.now();
  for (const [id, draft] of pendingTildaSignups) {
    if (!draft || draft.expiresAt <= now) pendingTildaSignups.delete(id);
  }
}

function buildTildaCaptchaUrl(form) {
  const nonce = `${Date.now()}=${Math.floor(Math.random() * 8)}`;
  const url = new URL(`${new URL(tildaFormsEndpoint).origin}/procces/captcha/`);
  url.searchParams.set("tildaspec-formid", form.formId);
  url.searchParams.set("tildaspec-formskey", form.formsKey);
  url.searchParams.set("rnd", nonce);
  return url.toString();
}

async function loadTildaSignupForm() {
  if (tildaSignupFormCache && Date.now() < tildaSignupFormCacheExpiresAt) return tildaSignupFormCache;

  const response = await fetch(tildaSignupUrl, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`Tilda signup page ${response.status}`);
  const html = await response.text();
  const allRecords = /<div[^>]+id=["']allrecords["'][^>]*>/i.exec(html)?.[0] || "";
  const formMatch = /<form\b[^>]*id=["'](form\d+)["'][^>]*data-formactiontype=["']2["'][\s\S]*?<\/form>/i.exec(html);
  if (!formMatch) throw new Error("Не найдена форма регистрации Tilda.");

  const formHtml = formMatch[0];
  const services = [...formHtml.matchAll(/name=["']formservices\[\]["'][^>]*value=["']([^"']+)["']/gi)]
    .map((match) => decodeHtmlAttribute(match[1]))
    .filter(Boolean);
  if (!services.length) throw new Error("Не найдены сервисы-получатели формы Tilda.");

  tildaSignupFormCache = {
    formId: formMatch[1],
    services,
    pageId: htmlAttribute(allRecords, "data-tilda-page-id"),
    projectId: htmlAttribute(allRecords, "data-tilda-project-id"),
    formsKey: htmlAttribute(allRecords, "data-tilda-formskey"),
    lang: htmlAttribute(allRecords, "data-tilda-project-lang") || "RU",
  };
  if (!tildaSignupFormCache.pageId || !tildaSignupFormCache.projectId || !tildaSignupFormCache.formsKey) {
    throw new Error("Не найдены служебные параметры страницы Tilda.");
  }
  tildaSignupFormCacheExpiresAt = Date.now() + 10 * 60 * 1000;
  return tildaSignupFormCache;
}

function clean(value) {
  return String(value || "").trim();
}

function normalizeEmail(value) {
  return clean(value).toLowerCase();
}

function normalizeBirthdate(value) {
  const date = clean(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return "";
  const [year, month, day] = date.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day ||
    year < 1900 ||
    year > new Date().getUTCFullYear()
  ) return "";
  return date;
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || ""));
}

function normalizePhone(value) {
  const raw = clean(value);
  if (!raw) return "";
  const digits = raw.replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 11 && digits.startsWith("8")) return `+7${digits.slice(1)}`;
  if (digits.length === 11 && digits.startsWith("7")) return `+${digits}`;
  if (digits.length === 10) return `+7${digits}`;
  return raw;
}

function digitsOnly(value) {
  return clean(value).replace(/\D/g, "");
}

function randomId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function communicationValues(value) {
  const items = Array.isArray(value) ? value : value ? [value] : [];
  return items.map((item) => clean(item?.value ?? item?.VALUE ?? item)).filter(Boolean);
}

function buildProductSearch(query) {
  const filter = { iblockId: Number(process.env.BITRIX_CATALOG_IBLOCK_ID || 15) };
  if (query) filter.name = { $contains: query };
  return {
    filter,
    select: ["id", "name", "active", "iblockId", "type", "price", "purchasingPrice"],
    sort: { id: "ASC" },
    limit: 5000,
  };
}

function loadCatalogCacheFromDisk() {
  try {
    if (!fs.existsSync(catalogCacheFile)) return;
    const payload = JSON.parse(fs.readFileSync(catalogCacheFile, "utf8"));
    catalogProductsCache = Array.isArray(payload.products) ? payload.products : [];
    catalogProductsCacheUpdatedAt = payload.syncedAt || null;
    console.log(`Catalog cache loaded: ${catalogProductsCache.length} products`);
  } catch (error) {
    console.warn(`Catalog cache load failed: ${error.message}`);
  }
}

function saveCatalogCacheToDisk() {
  fs.writeFileSync(catalogCacheFile, JSON.stringify({
    syncedAt: catalogProductsCacheUpdatedAt,
    products: catalogProductsCache,
  }));
}

function startCatalogSyncLoop() {
  if (!bitrixApiKey) return;
  syncCatalogProducts("startup").catch((error) => console.error(`Catalog sync startup failed: ${error.message}`));
  const timer = setInterval(() => {
    syncCatalogProducts("interval").catch((error) => console.error(`Catalog sync interval failed: ${error.message}`));
  }, catalogSyncIntervalMs);
  timer.unref?.();
}

async function getCachedCatalogProducts(query) {
  if (!catalogProductsCache.length) await syncCatalogProducts("request");
  const normalized = normalizeCatalogText(query);
  const source = normalized
    ? catalogProductsCache.filter((product) => normalizeCatalogText(product.name).includes(normalized))
    : catalogProductsCache;
  return source.slice(0, normalized ? 500 : 5000);
}

async function syncCatalogProducts(reason = "manual") {
  if (catalogSyncInFlight) return catalogSyncInFlight;
  catalogSyncInFlight = (async () => {
    catalogProductsCache = await loadCatalogProductsFromSource();
    catalogProductsCacheUpdatedAt = new Date().toISOString();
    saveCatalogCacheToDisk();
    console.log(`Catalog sync ${reason}: ${catalogProductsCache.length} products`);
    return catalogProductsCache;
  })();
  try {
    return await catalogSyncInFlight;
  } finally {
    catalogSyncInFlight = null;
  }
}

async function loadCatalogProductsFromSource() {
  if (catalogYmlUrl) {
    try {
      return await loadCatalogProductsFromYml(catalogYmlUrl);
    } catch (error) {
      console.error(`YML catalog sync failed: ${error.message}`);
      if (!bitrixApiKey) throw error;
    }
  }
  const raw = await bitrixRequest("/v1/catalog-products/search", {
    method: "POST",
    body: JSON.stringify(buildProductSearch("")),
  });
  const prices = await loadCatalogPrices(true);
  return mapProducts(raw, prices);
}

async function loadCatalogProductsFromYml(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`YML ${response.status}`);
  const xml = await response.text();
  return parseYmlProducts(xml);
}

function parseYmlProducts(xml) {
  const products = [];
  const offerPattern = /<offer\b([^>]*)>([\s\S]*?)<\/offer>/g;
  let match;
  while ((match = offerPattern.exec(xml))) {
    const attrs = parseXmlAttributes(match[1]);
    const body = match[2];
    const id = attrs.id || xmlTag(body, "id");
    const name = xmlTag(body, "name");
    if (!id || !name) continue;
    products.push({
      id,
      name,
      price: numberOrZero(xmlTag(body, "price")),
      currency: normalizeCurrency(xmlTag(body, "currencyId")),
      count: numberOrZero(xmlTag(body, "count")),
      groupId: attrs.group_id || "",
      url: xmlTag(body, "url"),
      picture: xmlTag(body, "picture"),
      source: "tilda-yml",
    });
  }
  return products;
}

function parseXmlAttributes(value) {
  const attrs = {};
  const pattern = /([\w:-]+)="([^"]*)"/g;
  let match;
  while ((match = pattern.exec(value || ""))) attrs[match[1]] = decodeXml(match[2]);
  return attrs;
}

function xmlTag(xml, tag) {
  const match = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`).exec(xml);
  return match ? decodeXml(match[1].trim()) : "";
}

function decodeXml(value) {
  return String(value || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function normalizeCurrency(value) {
  const currency = String(value || "RUB").trim().toUpperCase();
  return currency === "RUR" ? "RUB" : currency;
}

async function loadCatalogPrices(force = false) {
  if (!force && catalogPriceCache && Date.now() < catalogPriceCacheExpiresAt) return catalogPriceCache;
  const raw = await bitrixRequest("/v1/catalog-prices/search", {
    method: "POST",
    body: JSON.stringify({
      filter: { catalogGroupId: Number(process.env.BITRIX_CATALOG_PRICE_GROUP_ID || 1) },
      select: ["id", "productId", "price", "currency", "catalogGroupId"],
      sort: { productId: "ASC" },
      limit: 5000,
    }),
  });
  const prices = new Map();
  for (const row of asArray(raw)) {
    const productId = String(row.productId ?? row.PRODUCT_ID ?? "");
    if (!productId) continue;
    prices.set(productId, {
      price: numberOrZero(row.price ?? row.PRICE),
      currency: String(row.currency ?? row.CURRENCY ?? "RUB"),
    });
  }
  catalogPriceCache = prices;
  catalogPriceCacheExpiresAt = Date.now() + 5 * 60 * 1000;
  return prices;
}

function normalizeCatalogText(value) {
  return String(value || "").trim().toLowerCase();
}

function mapProducts(raw, prices = new Map()) {
  return asArray(raw)
    .filter((product) => product && product.active !== false)
    .map((product) => {
      const id = String(product.id ?? product.ID);
      const price = prices.get(id);
      return {
        id,
        name: String(product.name ?? product.NAME ?? `Product #${id}`),
        price: price?.price ?? numberOrZero(product.price ?? product.PRICE ?? product.purchasingPrice ?? product.PURCHASING_PRICE),
        currency: price?.currency ?? String(product.currency ?? product.CURRENCY ?? "RUB"),
      };
    })
    .filter((product) => product.id && product.name);
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.items)) return value.items;
  if (Array.isArray(value?.products)) return value.products;
  if (Array.isArray(value?.result)) return value.result;
  return [];
}

function numberOrZero(value) {
  return numberOrNull(value) ?? 0;
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(String(value).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(number) ? number : null;
}

function htmlAttribute(html, name) {
  const match = new RegExp(`${name}=["']([^"']*)["']`, "i").exec(html || "");
  return match ? decodeHtmlAttribute(match[1]) : "";
}

function decodeHtmlAttribute(value) {
  return String(value || "")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function stripHtml(value) {
  return decodeHtmlAttribute(String(value || "").replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

function shortenText(value, maxLength = 400) {
  const text = stripHtml(value);
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function summarizeTildaResponse(value) {
  if (!value || typeof value !== "object") return value ? shortenText(value) : null;
  return {
    result: value.result,
    results: Array.isArray(value.results) ? value.results.slice(0, 3) : undefined,
    member: value.member ? true : undefined,
  };
}

function serveStatic(res, pathname) {
  const requested = pathname === "/" ? "/index.html" : pathname;
  const relative = requested.replace(/^\/+/, "");
  const filePath = path.resolve(frontend, relative);
  if (!filePath.startsWith(`${frontend}${path.sep}`) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    return json(res, 404, { error: "Файл не найден." });
  }
  const extension = path.extname(filePath).toLowerCase();
  const types = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8" };
  res.writeHead(200, { "Content-Type": types[extension] || "application/octet-stream", "Cache-Control": "no-store" });
  fs.createReadStream(filePath).pipe(res);
}

function json(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    ...corsHeaders(),
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": process.env.ACCOUNT_CORS_ORIGIN || "https://v2sportdress.ru",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Accept",
    "Vary": "Origin",
  };
}

function loadEnv(filePath, allowedKeys = null) {
  if (!fs.existsSync(filePath)) return;
  for (const rawLine of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index < 1) continue;
    const key = line.slice(0, index).trim();
    if (allowedKeys && !allowedKeys.has(key)) continue;
    const value = line.slice(index + 1).trim().replace(/^["']|["']$/g, "");
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function friendlyError(error) {
  const message = String(error?.message || error);
  if (message.includes("fetch failed")) return "Нет соединения с API Bitrix24.";
  if (message.includes("401") || message.includes("403")) return "Bitrix24 отклонил API-ключ.";
  return "Не удалось получить данные контакта из Bitrix24.";
}
