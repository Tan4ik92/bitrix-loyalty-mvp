import { accountOrderDate, accountOrderNumber, isAccountHistoryLead } from "./order-history.js";
import { createDigiftApi, startDigiftMailImportLoop } from "./digift-mail-import.js";
import fs from "node:fs";
import http from "node:http";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildBirthdayBonusState, buildContactSearch, buildWelcomeBonusState, loyaltyFields, mapContact, normalizeSearchQuery, selectBestContact, selectMatchingContacts } from "./contact.js";

const moduleFile = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(moduleFile), "..");
const frontend = path.join(root, "frontend");
const siteVideoDir = path.join(root, "site-video");
const siteVideoTrafficLog = path.join(root, "data", "site-video-traffic.jsonl");
loadEnv(path.join(root, ".env"));

if (process.env.LEGACY_ENV_FILE) {
  loadEnv(process.env.LEGACY_ENV_FILE, new Set(["VIBECODE_API_BASE", "VIBECODE_API_KEY"]));
}

const port = Number(process.env.PORT || 3100);
const bitrixBaseUrl = String(process.env.VIBECODE_API_BASE || "https://vibecode.bitrix24.tech").replace(/\/$/, "");
const bitrixApiKey = process.env.VIBECODE_API_KEY || "";
const bitrixRestWebhookUrl = String(process.env.BITRIX_REST_WEBHOOK_URL || "").replace(/\/$/, "");
const bitrixPortalUrl = String(process.env.BITRIX_PORTAL_URL || "https://v2sportdress.bitrix24.ru").replace(/\/$/, "");
const bitrixRequestTimeoutMs = Number(process.env.BITRIX_REQUEST_TIMEOUT_MS || 12000);
const managerFormPath = normalizeManagerPath(process.env.MANAGER_FORM_PATH || "/managers");
const managerFormUser = process.env.MANAGER_FORM_USER || "";
const managerFormPassword = process.env.MANAGER_FORM_PASSWORD || "";
const catalogYmlUrl = process.env.CATALOG_YML_URL || "https://v2sportdress.ru/tstore/yml/1c781fefd7ce0002bb2833762b25baf7.yml";
const catalogCacheFile = path.join(root, "backend", "catalog-cache.json");
const preorderProductsFile = process.env.PREORDER_PRODUCTS_FILE || path.join(root, "backend", "preorder-products.json");
const birthdateUpdateLogFile = process.env.BIRTHDATE_UPDATE_LOG_FILE ||
  path.join(root, "backend", "birthdate-updates.ndjson");
const offlineOrderSequenceFile = process.env.OFFLINE_ORDER_SEQUENCE_FILE ||
  path.join(root, "backend", "offline-order-sequence.json");
const offlineOrderSequenceStart = Number(process.env.OFFLINE_ORDER_SEQUENCE_START || 23);
const catalogSyncIntervalMs = Number(process.env.BITRIX_CATALOG_SYNC_INTERVAL_MS || 5 * 60 * 1000);
const tildaSignupUrl = process.env.TILDA_SIGNUP_URL || "https://v2sportdress.ru/members/signup";
const tildaFormsEndpoint = process.env.TILDA_FORMS_ENDPOINT || "https://forms.tildacdn.com/procces/";
const tildaSignupEnabled = process.env.TILDA_SIGNUP_ENABLED !== "0";
const tildaMembersApiBase = String(process.env.TILDA_MEMBERS_API_BASE || "https://members.tildaapi.com").replace(/\/$/, "");
const tildaMembersProjectId = String(process.env.TILDA_MEMBERS_PROJECT_ID || "9846585").trim();
const dealLoyaltyFields = {
  discountAmount: process.env.BITRIX_DEAL_LOYALTY_DISCOUNT_AMOUNT_FIELD || "ufCrm_1781782778814",
  discountPercent: process.env.BITRIX_DEAL_LOYALTY_DISCOUNT_PERCENT_FIELD || "ufCrm_V2SD_ORDER_DISCOUNT_PERCENT",
  bonusAdded: process.env.BITRIX_DEAL_ORDER_BONUS_ADDED_FIELD || "ufCrm_V2SD_ORDER_BONUS_ADDED",
  bonusUsed: process.env.BITRIX_DEAL_ORDER_BONUS_USED_FIELD || "ufCrm_V2SD_ORDER_BONUS_USED",
};
const dealPromoFields = {
  code: process.env.BITRIX_DEAL_PROMOCODE_FIELD || "ufCrm_692EB9B815AE9",
  discountPercent: process.env.BITRIX_DEAL_PROMOCODE_PERCENT_FIELD || "ufCrm_1781080848101",
  discountAmount: process.env.BITRIX_DEAL_PROMOCODE_DISCOUNT_AMOUNT_FIELD || "ufCrm_1781080861960",
};
const secondaryCertificateDealFields = {
  code: process.env.BITRIX_DEAL_SECOND_CERTIFICATE_CODE_FIELD || "ufCrm_V2SD_PROMOCODE_2",
  amount: process.env.BITRIX_DEAL_SECOND_CERTIFICATE_AMOUNT_FIELD || "ufCrm_V2SD_PROMOCODE_2_AMOUNT",
};
const certificates = {
  entityTypeId: 1052,
  codeField: "ufCrm13_1790841151894",
  nominalField: "ufCrm13_1790843078590",
  usedAmountField: "ufCrm13_1790844939861",
  balanceField: "ufCrm13_1790844956658",
  usedDatesField: "ufCrm13_1790845080879",
  ordersField: "ufCrm13_1790845143",
};
const certificateLocks = new Map();
const dealOrderFields = {
  orderId: process.env.BITRIX_DEAL_ORDER_ID_FIELD || "ufCrm_692EB51A171A6",
  tildaOrderId: process.env.BITRIX_DEAL_TILDA_ORDER_ID_FIELD || "ufCrm_692EB518817D6",
  operation: process.env.BITRIX_DEAL_OPERATION_FIELD || "ufCrm_692EB5195A5CE",
  paymentStatus: process.env.BITRIX_DEAL_PAYMENT_STATUS_FIELD || "ufCrm_692EB51A23F58",
  track: process.env.BITRIX_DEAL_TRACK_FIELD || "ufCrm_6A0323D4E9218",
  deliveryMethod: process.env.BITRIX_DEAL_DELIVERY_METHOD_FIELD || "ufCrm_692EB518ADC14",
  deliveryCity: process.env.BITRIX_DEAL_DELIVERY_CITY_FIELD || "ufCrm_692EB518D7FD7",
  deliveryAddress: process.env.BITRIX_DEAL_DELIVERY_ADDRESS_FIELD || "ufCrm_692EB518E5EE0",
  deliveryPoint: process.env.BITRIX_DEAL_DELIVERY_POINT_FIELD || "ufCrm_1781020232256",
  warehouse: process.env.BITRIX_DEAL_WAREHOUSE_FIELD || "ufCrm_1782488544",
};
const dealDefaults = {
  categoryId: Number(process.env.BITRIX_DEAL_CATEGORY_ID || 0),
  stageId: process.env.BITRIX_DEAL_STAGE_ID || "NEW",
};
const preorderDealDefaults = {
  categoryId: Number(process.env.BITRIX_PREORDER_DEAL_CATEGORY_ID || 1),
  stageId: process.env.BITRIX_PREORDER_DEAL_STAGE_ID || "C1:PREPAYMENT_INVOICE",
};
const offlineDuplicateCheck = {
  enabled: process.env.OFFLINE_ORDER_DUPLICATE_CHECK_ENABLED !== "0",
  categoryId: Number(process.env.BITRIX_OFFLINE_DUPLICATE_CATEGORY_ID || process.env.BITRIX_DEAL_CATEGORY_ID || 0),
  stageId: String(process.env.BITRIX_OFFLINE_DUPLICATE_STAGE_ID || "").trim(),
  limit: Number(process.env.OFFLINE_ORDER_DUPLICATE_CHECK_LIMIT || 30),
};
const canceledDealStageIds = new Set(
  String(process.env.BITRIX_CANCELED_DEAL_STAGE_IDS || "LOSE,CANCEL,CANCELED,CANCELLED")
    .split(",")
    .map((value) => value.trim().toUpperCase())
    .filter(Boolean),
);
const dealOrderValues = {
  operation: "\u041e\u0444\u043b\u0430\u0439\u043d \u043e\u043f\u043b\u0430\u0442\u0430",
  preorderOperation: "\u041f\u0440\u0435\u0434\u0437\u0430\u043a\u0430\u0437",
  paymentStatus: "\u041e\u043f\u043b\u0430\u0447\u0435\u043d\u043e",
  deliveryMethod: "\u0421\u0430\u043c\u043e\u0432\u044b\u0432\u043e\u0437 \u0438\u0437 \u043c\u0430\u0433\u0430\u0437\u0438\u043d\u0430",
  offlineOrderTitle: "\u041e\u0444\u043b\u0430\u0439\u043d \u0437\u0430\u043a\u0430\u0437",
  preorderTitle: "\u041f\u0440\u0435\u0434\u0437\u0430\u043a\u0430\u0437",
};
const messengerOrderSources = {
  "5|VK": "ВКонтакте - Группа ВК",
  "1|ANK_CHATS_APP24_MAX": "ChatApp - Max - V2SD Сокол",
  UC_9XUL9I: "ChatApp - Max - V2SD Белка",
  UC_T7RCF2: "ChatApp - Телеграм - V2SD Сокол",
  UC_NLOT68: "ChatApp - Телеграм - V2SD Белка",
};
const messengerOrderDefaults = { categoryId: 1, unpaidStageId: "C1:NEW", paidStageId: "C1:PREPARATION" };
const partnerPromo = {
  entityTypeId: Number(process.env.BITRIX_PARTNER_PROMO_ENTITY_TYPE_ID || 1046),
  codeField: process.env.BITRIX_PARTNER_PROMO_CODE_FIELD || "ufCrm11_1777551423508",
  discountField: process.env.BITRIX_PARTNER_PROMO_DISCOUNT_FIELD || "ufCrm11_1777901069672",
  rewardPercentField: process.env.BITRIX_PARTNER_PROMO_REWARD_PERCENT_FIELD || "ufCrm11_1777556016148",
  partnershipTypeField: process.env.BITRIX_PARTNER_PROMO_PARTNERSHIP_TYPE_FIELD || "ufCrm11_1777547003402",
  statusField: process.env.BITRIX_PARTNER_PROMO_STATUS_FIELD || "ufCrm11_1777546968348",
};
const partnerPayoutFields = {
  orderAmount: process.env.BITRIX_PARTNER_PAYOUT_ORDER_AMOUNT_FIELD || "ufCrm9_1777549836072",
  rewardPercent: process.env.BITRIX_PARTNER_PAYOUT_REWARD_PERCENT_FIELD || "ufCrm9_1777549859828",
  code: process.env.BITRIX_PARTNER_PAYOUT_PROMO_CODE_FIELD || "ufCrm9_1777628079640",
  paid: process.env.BITRIX_PARTNER_PAYOUT_PAID_FIELD || "ufCrm9_1777630121769",
  cancelReason: process.env.BITRIX_PARTNER_PAYOUT_CANCEL_REASON_FIELD || "ufCrm9_1777630242967",
  partnershipType: process.env.BITRIX_PARTNER_PAYOUT_PARTNERSHIP_TYPE_FIELD || "ufCrm9_1783326446309",
  partnerParent: process.env.BITRIX_PARTNER_PAYOUT_PARTNER_PARENT_FIELD || "parentId1046",
  dealParent: process.env.BITRIX_PARTNER_PAYOUT_DEAL_PARENT_FIELD || "parentId2",
  comment: process.env.BITRIX_PARTNER_PAYOUT_COMMENT_FIELD || "ufCrm9_1783967051",
  branch: process.env.BITRIX_PARTNER_PAYOUT_BRANCH_FIELD || "ufCrm_9_V2SD_BRANCH",
  managerRemainder: process.env.BITRIX_PARTNER_PAYOUT_MANAGER_REMAINDER_FIELD || "ufCrm9_1791286316223",
};
const partnerPayoutPartnershipTypes = {
  "97": Number(process.env.BITRIX_PARTNER_PAYOUT_TYPE_EXPERT_ID || 151),
  "99": Number(process.env.BITRIX_PARTNER_PAYOUT_TYPE_AMBASSADOR_ID || 153),
  "109": Number(process.env.BITRIX_PARTNER_PAYOUT_TYPE_OTHER_ID || 155),
};
const partnerPayoutTypeMetadataCache = {
  expiresAt: 0,
  value: null,
};
const partnerPayoutDuplicateCheck = {
  windowMs: Number(process.env.PARTNER_PAYOUT_DUPLICATE_WINDOW_MS || 60 * 1000),
  limit: Number(process.env.PARTNER_PAYOUT_DUPLICATE_CHECK_LIMIT || 100),
};
const partnerPayoutAutomation = {
  enabled: process.env.PARTNER_PAYOUT_AUTOMATION_ENABLED !== "0",
  entityTypeId: Number(process.env.BITRIX_PARTNER_PAYOUT_ENTITY_TYPE_ID || 1042),
  newStageId: String(process.env.BITRIX_PARTNER_PAYOUT_NEW_STAGE_ID || "DT1042_17:NEW").trim(),
  paymentStageId: String(process.env.BITRIX_PARTNER_PAYOUT_PAYMENT_STAGE_ID || "DT1042_17:PREPARATION").trim(),
  paidStageId: String(process.env.BITRIX_PARTNER_PAYOUT_PAID_STAGE_ID || "DT1042_17:SUCCESS").trim(),
  intervalMs: Number(process.env.PARTNER_PAYOUT_AUTOMATION_INTERVAL_MS || 60 * 60 * 1000),
  listLimit: Number(process.env.PARTNER_PAYOUT_AUTOMATION_LIST_LIMIT || 500),
  batchDelayMs: Number(process.env.PARTNER_PAYOUT_AUTOMATION_BATCH_DELAY_MS || 250),
  stateFile: process.env.PARTNER_PAYOUT_AUTOMATION_STATE_FILE ||
    path.join(root, "backend", "partner-payout-automation-state.json"),
  manualToken: process.env.PARTNER_PAYOUT_JOB_TOKEN || "",
};
const birthdayBonusAutomation = {
  enabled: process.env.BIRTHDAY_BONUS_AUTOMATION_ENABLED !== "0",
  amount: Math.max(Number(process.env.BIRTHDAY_BONUS_AMOUNT || 500), 0),
  windowDays: Math.max(Number(process.env.BIRTHDAY_BONUS_WINDOW_DAYS || 14), 0),
  lifetimeDays: Math.max(Number(process.env.BIRTHDAY_BONUS_LIFETIME_DAYS || 7), 0),
  scheduleHourMsk: Math.min(Math.max(Number(process.env.BIRTHDAY_BONUS_SCHEDULE_HOUR_MSK || 5), 0), 23),
  scheduleMinuteMsk: Math.min(Math.max(Number(process.env.BIRTHDAY_BONUS_SCHEDULE_MINUTE_MSK || 0), 0), 59),
  listLimit: Math.min(Math.max(Number(process.env.BIRTHDAY_BONUS_AUTOMATION_LIST_LIMIT || 50), 1), 100),
  batchDelayMs: Math.max(Number(process.env.BIRTHDAY_BONUS_AUTOMATION_BATCH_DELAY_MS || 100), 0),
  stateFile: process.env.BIRTHDAY_BONUS_AUTOMATION_STATE_FILE ||
    path.join(root, "backend", "birthday-bonus-automation-state.json"),
  logFile: process.env.BIRTHDAY_BONUS_AUTOMATION_LOG_FILE ||
    path.join(root, "backend", "birthday-bonus-automation.ndjson"),
  manualToken: process.env.BIRTHDAY_BONUS_JOB_TOKEN || process.env.PARTNER_PAYOUT_JOB_TOKEN || "",
};
const pickupBranches = {
  sokol: {
    code: "sokol",
    name: "Ð¡Ð¾ÐºÐ¾Ð»",
    city: "ÐœÐ¾ÑÐºÐ²Ð°",
    point: "RU: Point: ÐœÐ¾ÑÐºÐ²Ð°, Ð¡Ð¾ÐºÐ¾Ð»Ð¾Ð²Ð¾-ÐœÐµÑ‰ÐµÑ€ÑÐºÐ°Ñ ÑƒÐ»Ð¸Ñ†Ð°, 14, Ð¾Ñ„. 10 (Ð¡Ð¾ÐºÐ¾Ð»Ð¾Ð²Ð¾-ÐœÐµÑ‰ÐµÑ€ÑÐºÐ°Ñ ÑƒÐ»Ð¸Ñ†Ð°, 14 (Ð¥Ð¸Ð¼ÐºÐ¸))101000, ÐœÐ¾ÑÐºÐ²Ð°",
  },
  belka: {
    code: "belka",
    name: "Ð‘ÐµÐ»ÐºÐ°",
    city: "ÐœÐ¾ÑÐºÐ²Ð°",
    point: "RU: Point: ÐœÐ¾ÑÐºÐ²Ð°, Ð‘ÑƒÐ¼Ð°Ð¶Ð½Ñ‹Ð¹ Ð¿Ñ€Ð¾ÐµÐ·Ð´, 4 (Ð‘ÑƒÐ¼Ð°Ð¶Ð½Ñ‹Ð¹ Ð¿Ñ€Ð¾ÐµÐ·Ð´, 4 (Ð¼. Ð¡Ð°Ð²Ñ‘Ð»Ð¾Ð²ÑÐºÐ°Ñ / Ð¼. Ð‘ÐµÐ»Ð¾Ñ€ÑƒÑÑÐºÐ°Ñ))101000, ÐœÐ¾ÑÐºÐ²Ð°",
  },
};
const safePickupBranches = {
  sokol: {
    code: "sokol",
    name: "\u0421\u043e\u043a\u043e\u043b",
    city: "\u041c\u043e\u0441\u043a\u0432\u0430",
    point: "RU: Point: \u041c\u043e\u0441\u043a\u0432\u0430, \u0421\u043e\u043a\u043e\u043b\u043e\u0432\u043e-\u041c\u0435\u0449\u0435\u0440\u0441\u043a\u0430\u044f \u0443\u043b\u0438\u0446\u0430, 14, \u043e\u0444. 10 (\u0421\u043e\u043a\u043e\u043b\u043e\u0432\u043e-\u041c\u0435\u0449\u0435\u0440\u0441\u043a\u0430\u044f \u0443\u043b\u0438\u0446\u0430, 14 (\u0425\u0438\u043c\u043a\u0438))101000, \u041c\u043e\u0441\u043a\u0432\u0430",
    warehouseId: Number(process.env.BITRIX_SOKOL_WAREHOUSE_ID || 6953),
  },
  belka: {
    code: "belka",
    name: "\u0411\u0435\u043b\u043a\u0430",
    city: "\u041c\u043e\u0441\u043a\u0432\u0430",
    point: "RU: Point: \u041c\u043e\u0441\u043a\u0432\u0430, \u0411\u0443\u043c\u0430\u0436\u043d\u044b\u0439 \u043f\u0440\u043e\u0435\u0437\u0434, 4 (\u0411\u0443\u043c\u0430\u0436\u043d\u044b\u0439 \u043f\u0440\u043e\u0435\u0437\u0434, 4 (\u043c. \u0421\u0430\u0432\u0451\u043b\u043e\u0432\u0441\u043a\u0430\u044f / \u043c. \u0411\u0435\u043b\u043e\u0440\u0443\u0441\u0441\u043a\u0430\u044f))101000, \u041c\u043e\u0441\u043a\u0432\u0430",
    warehouseId: Number(process.env.BITRIX_BELKA_WAREHOUSE_ID || 6949),
  },
};
const branchDepartmentIds = {
  sokol: Number(process.env.BITRIX_SOKOL_DEPARTMENT_ID || 5),
  belka: Number(process.env.BITRIX_BELKA_DEPARTMENT_ID || 3),
};
let catalogPriceCache = null;
let catalogPriceCacheExpiresAt = 0;
let catalogProductsCache = [];
let catalogProductsCacheUpdatedAt = null;
let catalogSyncInFlight = null;
let promoCache = null;
let promoCacheExpiresAt = 0;
let tildaSignupFormCache = null;
let tildaSignupFormCacheExpiresAt = 0;
let offlineOrderSequenceLock = Promise.resolve();
const pendingTildaSignups = new Map();

loadCatalogCacheFromDisk();

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

    if (req.method === "OPTIONS") {
      res.writeHead(204, corsHeaders());
      return res.end();
    }

    if (url.pathname === "/integration" || url.pathname.startsWith("/integration/")) {
      return proxyIntegration(req, res, url);
    }

    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/manager")) {
      return redirect(res, managerFormPath);
    }

    if (req.method === "GET" && url.pathname === "/api/health") {
      return json(res, bitrixApiKey ? 200 : 503, {
        ok: Boolean(bitrixApiKey),
        bitrixConfigured: Boolean(bitrixApiKey),
      });
    }

    if (isProtectedPartnerPayoutRequest(req.method, url.pathname) && !isAuthorizedPartnerPayoutRequest(req)) {
      return forbidden(res);
    }

    if (isManagerFormRequest(req.method, url.pathname) && !isAuthorizedManagerRequest(req)) {
      const authorizedEmbeddedAsset = isPartnerPayoutDashboardAsset(req.method, url.pathname) &&
        isAuthorizedPartnerPayoutRequest(req);
      if (!authorizedEmbeddedAsset) return unauthorized(res);
    }

    if (req.method === "GET" && url.pathname === "/api/employees") {
      if (!bitrixApiKey) return json(res, 503, { error: "VIBECODE_API_KEY is not configured." });
      const branch = clean(url.searchParams.get("branch")) || "sokol";
      const employees = await loadBranchEmployees(branch);
      return json(res, 200, { branch, employees });
    }

    if (req.method === "GET" && url.pathname === "/api/promocodes/lookup") {
      if (!bitrixApiKey) return json(res, 503, { error: "VIBECODE_API_KEY is not configured." });
      const code = clean(url.searchParams.get("code"));
      if (!code) return json(res, 400, { error: "Введите промокод." });
      const promo = await findPartnerPromo(code);
      if (!promo) {
        const certificate = await findCertificate(code);
        if (certificate) {
          return json(res, 400, { error: "Это код сертификата. Введите его в поле «Сертификат» ниже." });
        }
        return json(res, 404, { error: "Промокод не найден." });
      }
      return json(res, 200, { promo });
    }

    if (req.method === "GET" && url.pathname === "/api/certificates/lookup") {
      if (!bitrixApiKey) return json(res, 503, { error: "VIBECODE_API_KEY is not configured." });
      const code = clean(url.searchParams.get("code"));
      if (!code) return json(res, 400, { error: "Введите код сертификата." });
      const certificate = await findCertificate(code);
      if (!certificate) return json(res, 404, { error: "Сертификат не найден." });
      return json(res, 200, { certificate });
    }

    if (req.method === "POST" && url.pathname === "/api/partner-payouts/offline") {
      if (!bitrixApiKey) return json(res, 503, { error: "VIBECODE_API_KEY is not configured." });
      const result = await createOfflinePartnerPayout(await readJson(req));
      return json(res, 201, result);
    }

    if (req.method === "GET" && url.pathname === "/api/partner-payouts/report") {
      if (!bitrixApiKey) return json(res, 503, { error: "VIBECODE_API_KEY is not configured." });
      const report = await buildPartnerPayoutReport({
        month: clean(url.searchParams.get("month")),
        type: clean(url.searchParams.get("type")),
        stage: clean(url.searchParams.get("stage")),
        dealStage: clean(url.searchParams.get("dealStage")),
        branch: clean(url.searchParams.get("branch")),
        paid: clean(url.searchParams.get("paid")),
        q: clean(url.searchParams.get("q")),
        limit: Number(url.searchParams.get("limit") || 500),
        enrich: url.searchParams.get("enrich") === "1",
      });
      return json(res, 200, report);
    }

    if (req.method === "POST" && url.pathname === "/api/partner-payouts/mark-paid") {
      if (!bitrixApiKey) return json(res, 503, { error: "VIBECODE_API_KEY is not configured." });
      const result = await markPartnerPayoutsPaid(await readJson(req));
      return json(res, result.errors.length ? 207 : 200, result);
    }

    if (req.method === "GET" && url.pathname === "/api/birthday-bonuses/run") {
      if (!bitrixApiKey) return json(res, 503, { error: "VIBECODE_API_KEY is not configured." });
      if (!isAuthorizedBirthdayBonusJobRequest(req)) return unauthorized(res);
      const result = await runBirthdayBonusAutomation({
        dryRun: url.searchParams.get("apply") !== "1",
        force: url.searchParams.get("force") === "1",
        contactId: clean(url.searchParams.get("contactId")),
        now: url.searchParams.get("today") || new Date(),
        source: "manual",
      });
      return json(res, 200, result);
    }

    if (req.method === "GET" && url.pathname === "/api/contacts/search") {
      if (!bitrixApiKey) return json(res, 503, { error: "ÐÐµ Ð½Ð°ÑÑ‚Ñ€Ð¾ÐµÐ½ VIBECODE_API_KEY." });
      const search = normalizeSearchQuery(url.searchParams.get("q"));
      if (!search) return json(res, 400, { error: "Ð’Ð²ÐµÐ´Ð¸Ñ‚Ðµ ÐºÐ¾Ñ€Ñ€ÐµÐºÑ‚Ð½Ñ‹Ð¹ email Ð¸Ð»Ð¸ Ñ‚ÐµÐ»ÐµÑ„Ð¾Ð½." });

      const result = await findBestContactBySearch(search);
      const contacts = (result.contacts || []).map(mapManagerContact).filter(Boolean);
      return json(res, 200, {
        contact: contacts[0] || mapManagerContact(result.contact),
        contacts,
        matches: result.matches,
      });
    }

    if (req.method === "POST" && url.pathname === "/api/contacts") {
      if (!bitrixApiKey) return json(res, 503, { error: "VIBECODE_API_KEY is not configured." });
      const payload = await readJson(req);
      const registration = normalizeRegistration(payload);
      if (registration.email && !isValidEmail(registration.email)) {
        return json(res, 400, { error: "Ð’Ð²ÐµÐ´Ð¸Ñ‚Ðµ ÐºÐ¾Ñ€Ñ€ÐµÐºÑ‚Ð½Ñ‹Ð¹ email, Ð½Ð°Ð¿Ñ€Ð¸Ð¼ÐµÑ€ client@mail.ru." });
      }
      if (!registration.phone && !registration.email) {
        return json(res, 400, { error: "Ð’Ð²ÐµÐ´Ð¸Ñ‚Ðµ Ñ‚ÐµÐ»ÐµÑ„Ð¾Ð½ Ð¸Ð»Ð¸ email." });
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
      const contactId = clean(url.searchParams.get("contactId") || url.searchParams.get("id"));
      const email = normalizeEmail(url.searchParams.get("email"));
      if (!contactId && !email) {
        return json(res, 400, { error: "Для личного кабинета нужен email или Bitrix contactId." });
      }
      const account = await loadAccountProfile({
        contactId,
        email,
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
      const member = await verifyTildaMemberRequest(req, email);
      if (!member.ok) return json(res, member.status, { error: member.error });
      const birthdate = normalizeBirthdate(payload.birthdate);
      if (!birthdate) return json(res, 400, { error: "Ð£ÐºÐ°Ð¶Ð¸Ñ‚Ðµ Ð´Ð°Ñ‚Ñƒ Ñ€Ð¾Ð¶Ð´ÐµÐ½Ð¸Ñ Ð² Ñ„Ð¾Ñ€Ð¼Ð°Ñ‚Ðµ Ð“Ð“Ð“Ð“-ÐœÐœ-Ð”Ð”." });

      const contact = await findAccountContactByAnyCommunication({
        contactId: clean(payload.contactId || payload.id),
        email,
      });
      if (!contact) return json(res, 404, { error: "ÐšÐ¾Ð½Ñ‚Ð°ÐºÑ‚ Ð½Ðµ Ð½Ð°Ð¹Ð´ÐµÐ½ Ð² Bitrix." });

      const contactId = contact.id || contact.ID;
      const previousBirthdate = contact.birthdate || contact.BIRTHDATE || "";
      await bitrixRequest(`/v1/contacts/${encodeURIComponent(contactId)}`, {
        method: "PATCH",
        body: JSON.stringify({ birthdate }),
      });
      const updated = await bitrixRequest(`/v1/contacts/${encodeURIComponent(contactId)}`);
      await recordBirthdateUpdate({
        contactId,
        email,
        previousBirthdate,
        birthdate,
        contact: updated,
      });
      const birthdayBonus = await runBirthdayBonusForContact(updated, {
        dryRun: false,
        now: new Date(),
        source: "birthdate_update",
      });
      return json(res, 200, {
        contact: mapContact(birthdayBonus.contact || updated),
        birthdayBonus: birthdayBonus.summary,
      });
    }

    if (req.method === "POST" && url.pathname === "/api/account/profile/name") {
      if (!bitrixApiKey) return json(res, 503, { error: "VIBECODE_API_KEY is not configured." });
      const payload = await readJson(req);
      const email = normalizeEmail(payload.email);
      const member = await verifyTildaMemberRequest(req, email);
      if (!member.ok) return json(res, member.status, { error: member.error });

      const nextName = normalizePersonName(payload.name);
      const nextLastName = normalizePersonName(payload.lastName);
      const nextSecondName = normalizePersonName(payload.secondName, { optional: true });
      if (!nextName || !nextLastName || nextSecondName === null) {
        return json(res, 400, { error: "Укажите корректные имя, фамилию и отчество." });
      }

      const contact = await findAccountContactByAnyCommunication({
        contactId: clean(payload.contactId || payload.id),
        email,
      });
      if (!contact) return json(res, 404, { error: "Контакт не найден в Bitrix." });

      const contactId = contact.id || contact.ID;
      const previous = mapContact(contact);
      await bitrixRequest(`/v1/contacts/${encodeURIComponent(contactId)}`, {
        method: "PATCH",
        body: JSON.stringify({ name: nextName, lastName: nextLastName, secondName: nextSecondName }),
      });
      const updated = await bitrixRequest(`/v1/contacts/${encodeURIComponent(contactId)}`);
      await recordAccountNameUpdate({
        contactId,
        email,
        previousFullName: previous?.fullName || "",
        nextFullName: mapContact(updated)?.fullName || "",
      });
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

    if (req.method === "POST" && url.pathname === "/api/orders") {
      if (!bitrixApiKey) return json(res, 503, { error: "VIBECODE_API_KEY is not configured." });
      const order = normalizeOrderPayload(await readJson(req));
      if (!order.contactId) return json(res, 400, { error: "Ð’Ñ‹Ð±ÐµÑ€Ð¸Ñ‚Ðµ ÐºÐ»Ð¸ÐµÐ½Ñ‚Ð° Ð¿ÐµÑ€ÐµÐ´ Ð¾Ñ„Ð¾Ñ€Ð¼Ð»ÐµÐ½Ð¸ÐµÐ¼ Ð·Ð°ÐºÐ°Ð·Ð°." });
      if (!order.items.length) return json(res, 400, { error: "Ð”Ð¾Ð±Ð°Ð²ÑŒÑ‚Ðµ Ñ…Ð¾Ñ‚Ñ Ð±Ñ‹ Ð¾Ð´Ð¸Ð½ Ñ‚Ð¾Ð²Ð°Ñ€." });

      const result = await createBitrixOrder(order);
      return json(res, 201, result);
    }

    if (req.method === "GET" && url.pathname === "/api/tilda/signup/captcha") {
      const draftId = clean(url.searchParams.get("draft"));
      const draft = getPendingTildaSignup(draftId);
      if (!draft) return json(res, 404, { error: "Ð ÐµÐ³Ð¸ÑÑ‚Ñ€Ð°Ñ†Ð¸Ñ Ð½Ð° ÑÐ°Ð¹Ñ‚Ðµ ÑƒÑÑ‚Ð°Ñ€ÐµÐ»Ð°, ÑÐ¾Ð·Ð´Ð°Ð¹Ñ‚Ðµ ÐºÐ»Ð¸ÐµÐ½Ñ‚Ð° Ð·Ð°Ð½Ð¾Ð²Ð¾." });
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
      if (!draft) return json(res, 404, { error: "Ð ÐµÐ³Ð¸ÑÑ‚Ñ€Ð°Ñ†Ð¸Ñ Ð½Ð° ÑÐ°Ð¹Ñ‚Ðµ ÑƒÑÑ‚Ð°Ñ€ÐµÐ»Ð°, ÑÐ¾Ð·Ð´Ð°Ð¹Ñ‚Ðµ ÐºÐ»Ð¸ÐµÐ½Ñ‚Ð° Ð·Ð°Ð½Ð¾Ð²Ð¾." });
      if (!captchaToken) return json(res, 400, { error: "Tilda Ð½Ðµ Ð²ÐµÑ€Ð½ÑƒÐ»Ð° captcha-Ñ‚Ð¾ÐºÐµÐ½." });
      const result = await registerTildaMember(draft.registration, captchaToken, draft.form);
      pendingTildaSignups.delete(draftId);
      return json(res, 200, result);
    }

    if ((req.method === "GET" || req.method === "POST") && url.pathname === "/api/jobs/partner-payouts/month-end") {
      if (!bitrixApiKey) return json(res, 503, { error: "VIBECODE_API_KEY is not configured." });
      const dryRun = url.searchParams.get("dryRun") !== "0";
      if (!dryRun && !isAuthorizedPartnerPayoutJobRequest(req)) {
        return json(res, 403, { error: "Manual partner payout run requires PARTNER_PAYOUT_JOB_TOKEN." });
      }
      const force = url.searchParams.get("force") === "1";
      const result = await runPartnerPayoutMonthEnd({
        dryRun,
        force,
        now: new Date(),
        source: "manual",
      });
      return json(res, 200, result);
    }

    if ((req.method === "GET" || req.method === "HEAD") && url.pathname.startsWith("/site-video/")) {
      return serveSiteVideo(req, res, url.pathname);
    }
    if (req.method !== "GET" && req.method !== "HEAD") return json(res, 405, { error: "ÐœÐµÑ‚Ð¾Ð´ Ð½Ðµ Ð¿Ð¾Ð´Ð´ÐµÑ€Ð¶Ð¸Ð²Ð°ÐµÑ‚ÑÑ." });
    return serveStatic(res, url.pathname);
  } catch (error) {
    console.error(error);
    return json(res, error.status || 502, {
      error: error.publicMessage || friendlyError(error),
      duplicate: error.duplicate || undefined,
    });
  }
});

if (process.argv[1] && path.resolve(process.argv[1]) === moduleFile) {
  server.listen(port, "0.0.0.0", () => {
    console.log(`Bitrix loyalty MVP: http://0.0.0.0:${port}`);
    console.log(`Bitrix API configured: ${bitrixApiKey ? "yes" : "no"}`);
    startCatalogSyncLoop();
    startPartnerPayoutAutomationLoop();
    startBirthdayBonusAutomationLoop();
    if (process.env.DIGIFT_CERTIFICATE_IMPORT_ENABLED === "1") {
      try {
        const api = createDigiftApi({ mailWebhookUrl: process.env.DIGIFT_BITRIX_MAIL_WEBHOOK_URL,
          crmBaseUrl: bitrixBaseUrl, crmApiKey: bitrixApiKey });
        startDigiftMailImportLoop(api);
      } catch (error) { console.error("Digift certificate import not started:", error.message); }
    }
  });
}

async function bitrixRequest(apiPath, options = {}) {
  const payload = await bitrixRawRequest(apiPath, options);
  return payload?.data ?? payload;
}

async function findBestContactBySearch(search) {
  const raw = await bitrixRequest("/v1/contacts/search", {
    method: "POST",
    body: JSON.stringify(buildContactSearch(search)),
  });
  const rawContacts = selectMatchingContacts(raw, search);

  const duplicateContacts = await searchVibeDuplicateContacts(search).catch((error) => {
    console.warn("Vibe duplicate contact multi-field fallback failed", error.message);
    return [];
  });

  const restRaw = await searchBitrixRestContacts(search).catch((error) => {
    console.warn("Bitrix REST contact multi-field fallback failed", error.message);
    return [];
  });
  const restContacts = selectMatchingContacts(restRaw, search);
  const enrichedRestContacts = await enrichContacts(restContacts);
  const contacts = dedupeContactsById([...rawContacts, ...duplicateContacts, ...enrichedRestContacts]);

  if (contacts.length > 0) {
    return { contact: contacts[0], contacts, matches: contacts.length };
  }

  const result = selectBestContact(raw, search);
  return { ...result, contacts: result.contact ? [result.contact] : [] };
}

async function enrichContacts(contacts) {
  const enriched = [];
  for (const contact of contacts) {
    const id = contact?.id || contact?.ID;
    if (!id) {
      enriched.push(contact);
      continue;
    }
    try {
      enriched.push(await bitrixRequest(`/v1/contacts/${encodeURIComponent(id)}`));
    } catch {
      enriched.push(contact);
    }
  }
  return enriched;
}

function dedupeContactsById(contacts) {
  const byId = new Map();
  for (const contact of contacts) {
    const id = String(contact?.id || contact?.ID || "");
    if (!id || byId.has(id)) continue;
    byId.set(id, contact);
  }
  return [...byId.values()].sort((a, b) => Number(b.id || b.ID || 0) - Number(a.id || a.ID || 0));
}

async function searchVibeDuplicateContacts(search) {
  if (!search) return [];
  const type = search.type === "email" ? "EMAIL" : "PHONE";
  const values = buildVibeDuplicateSearchValues(search);
  const seenIds = new Set();
  const contacts = [];

  for (const value of values) {
    const raw = await bitrixRequest("/v1/duplicates/find", {
      method: "POST",
      body: JSON.stringify({
        type,
        values: [value],
        entityType: "CONTACT",
      }),
    });
    const ids = asArray(raw?.contact || raw?.CONTACT || raw?.contacts || raw?.CONTACTS);
    for (const id of ids) {
      const contactId = String(id || "");
      if (!contactId || seenIds.has(contactId)) continue;
      seenIds.add(contactId);
      try {
        const restContact = await getBitrixRestContactById(contactId).catch(() => null);
        const contact = restContact || await bitrixRequest(`/v1/contacts/${encodeURIComponent(contactId)}`);
        contacts.push(addSearchedCommunication(contact, search));
      } catch (error) {
        console.warn(`Failed to load duplicate contact ${contactId}`, error.message);
      }
    }
  }

  return contacts;
}

function addSearchedCommunication(contact, search) {
  if (!contact || !search) return contact;
  if (search.type === "email") {
    const emails = unique([firstCommunication(contact.email || contact.EMAIL), ...communicationValues(contact.email || contact.EMAIL), search.value]);
    return { ...contact, email: emails.map((value) => ({ value })) };
  }
  const phones = unique([firstCommunication(contact.phone || contact.PHONE), ...communicationValues(contact.phone || contact.PHONE), search.value]);
  return { ...contact, phone: phones.map((value) => ({ value })) };
}

function buildVibeDuplicateSearchValues(search) {
  if (search.type === "email") return unique([search.value]);
  const digits = clean(search.value).replace(/\D/g, "");
  if (!digits) return [];
  const last10 = digits.length > 10 ? digits.slice(-10) : digits;
  return unique([
    search.value,
    digits,
    last10,
    last10.length === 10 ? `7${last10}` : "",
    last10.length === 10 ? `+7${last10}` : "",
    last10.length === 10 ? `8${last10}` : "",
  ].filter(Boolean));
}

async function vibeDuplicateHasContactId(search, contactId) {
  if (!search || !contactId) return false;
  const type = search.type === "email" ? "EMAIL" : "PHONE";
  const expected = String(contactId);
  for (const value of buildVibeDuplicateSearchValues(search)) {
    const raw = await bitrixRequest("/v1/duplicates/find", {
      method: "POST",
      body: JSON.stringify({
        type,
        values: [value],
        entityType: "CONTACT",
      }),
    });
    const ids = asArray(raw?.contact || raw?.CONTACT || raw?.contacts || raw?.CONTACTS).map((id) => String(id || ""));
    if (ids.includes(expected)) return true;
  }
  return false;
}

async function getBitrixRestContactById(contactId) {
  if (!bitrixRestWebhookUrl) return null;
  const payload = await bitrixRestRequest("crm.contact.get", { id: contactId });
  return payload?.result || null;
}

async function searchBitrixRestContacts(search) {
  if (!bitrixRestWebhookUrl || !search) return [];
  const values = buildBitrixRestContactSearchValues(search);
  const seen = new Set();
  const contacts = [];

  for (const value of values) {
    const filter = search.type === "email" ? { EMAIL: value } : { PHONE: value };
    const payload = await bitrixRestRequest("crm.contact.list", {
      filter,
      select: ["ID", "NAME", "LAST_NAME", "SECOND_NAME", "PHONE", "EMAIL", "BIRTHDATE", "DATE_CREATE"],
    });
    for (const contact of asArray(payload?.result)) {
      const id = String(contact?.ID || contact?.id || "");
      if (!id || seen.has(id)) continue;
      seen.add(id);
      contacts.push(contact);
    }
  }

  return contacts;
}

function buildBitrixRestContactSearchValues(search) {
  if (search.type === "email") return unique([search.value]);
  const digits = clean(search.value).replace(/\D/g, "");
  if (!digits) return [];
  const last10 = digits.length > 10 ? digits.slice(-10) : digits;
  const local = last10.length === 10 ? `7${last10}` : digits;
  return unique([
    digits,
    local,
    last10,
    last10.length === 10 ? `+7${last10}` : "",
    last10.length === 10 ? `8${last10}` : "",
  ].filter(Boolean));
}

async function bitrixRestRequest(method, params = {}) {
  if (!bitrixRestWebhookUrl) {
    throw new Error("BITRIX_REST_WEBHOOK_URL is not configured");
  }
  const response = await fetch(`${bitrixRestWebhookUrl}/${method}.json`, {
    method: "POST",
    signal: AbortSignal.timeout(bitrixRequestTimeoutMs),
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(params),
  });
  const text = await response.text();
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = text; }
  if (!response.ok || payload?.error) {
    throw new Error(`Bitrix REST ${method} ${response.status}: ${JSON.stringify(payload)}`);
  }
  return payload;
}

async function bitrixRawRequest(apiPath, options = {}) {
  const response = await fetch(`${bitrixBaseUrl}${apiPath}`, {
    ...options,
    signal: AbortSignal.timeout(bitrixRequestTimeoutMs),
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
  return payload;
}

async function acquireOfflineOrderNumber() {
  const previousLock = offlineOrderSequenceLock;
  let release;
  offlineOrderSequenceLock = new Promise((resolve) => { release = resolve; });
  await previousLock;

  try {
    const next = await readOfflineOrderSequence();
    let committed = false;
    return {
      orderNumber: String(next),
      commit: async () => {
        if (committed) return;
        committed = true;
        await writeOfflineOrderSequence(next + 1);
      },
      release,
    };
  } catch (error) {
    release();
    throw error;
  }
}

async function readOfflineOrderSequence() {
  try {
    const raw = await fs.promises.readFile(offlineOrderSequenceFile, "utf8");
    const parsed = JSON.parse(raw);
    const next = Number(parsed.next);
    return Number.isFinite(next) && next > 0 ? next : offlineOrderSequenceStart;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return offlineOrderSequenceStart;
  }
}

async function writeOfflineOrderSequence(next) {
  await fs.promises.mkdir(path.dirname(offlineOrderSequenceFile), { recursive: true });
  await fs.promises.writeFile(
    offlineOrderSequenceFile,
    JSON.stringify({ next, updatedAt: new Date().toISOString() }, null, 2),
    "utf8",
  );
}

function startPartnerPayoutAutomationLoop() {
  if (!partnerPayoutAutomation.enabled) return;
  const intervalMs = Math.max(Number(partnerPayoutAutomation.intervalMs) || 0, 60 * 1000);
  const run = () => {
    runPartnerPayoutMonthEnd({ dryRun: false, force: false, now: new Date(), source: "schedule" })
      .then((result) => {
        if (!result.skipped) {
          console.log(`Partner payout month-end ${result.dryRun ? "dry-run" : "run"}: moved ${result.moved}/${result.total} items.`);
        }
      })
      .catch((error) => console.error(`Partner payout month-end failed: ${error.message}`));
  };
  setTimeout(run, 30 * 1000).unref?.();
  const timer = setInterval(run, intervalMs);
  timer.unref?.();
}

async function runPartnerPayoutMonthEnd({ dryRun = true, force = false, now = new Date(), source = "manual" } = {}) {
  const config = validatePartnerPayoutAutomationConfig();
  const monthKey = getPreviousMonthKey(now);
  if (!config.ok) {
    return {
      ok: false,
      skipped: true,
      reason: config.reason,
      dryRun,
      source,
      monthKey,
      config: config.publicConfig,
    };
  }

  if (!force && !isFirstDayOfMonth(now)) {
    return {
      ok: true,
      skipped: true,
      reason: "not_month_close_day",
      dryRun,
      source,
      monthKey,
      date: toDateKey(now),
    };
  }

  const candidates = await loadPartnerPayoutCandidates(monthKey);
  if (dryRun) {
    return {
      ok: true,
      skipped: false,
      dryRun: true,
      source,
      monthKey,
      total: candidates.length,
      moved: 0,
      candidates,
    };
  }

  const moved = [];
  const errors = [];
  for (const item of candidates) {
    try {
      await movePartnerPayoutToPaymentStage(item.id);
      moved.push(item);
      await delay(partnerPayoutAutomation.batchDelayMs);
    } catch (error) {
      errors.push({ id: item.id, title: item.title, error: error.message });
    }
  }

  await writePartnerPayoutAutomationState({
    lastProcessedMonth: monthKey,
    lastProcessedAt: new Date().toISOString(),
    source,
    total: candidates.length,
    moved: moved.length,
    errors: errors.length,
  });

  return {
    ok: errors.length === 0,
    skipped: false,
    dryRun: false,
    source,
    monthKey,
    total: candidates.length,
    moved: moved.length,
    errors,
  };
}

function validatePartnerPayoutAutomationConfig() {
  const publicConfig = {
    entityTypeId: partnerPayoutAutomation.entityTypeId || null,
    newStageId: partnerPayoutAutomation.newStageId || null,
    paymentStageId: partnerPayoutAutomation.paymentStageId || null,
    listLimit: partnerPayoutAutomation.listLimit,
  };
  if (!partnerPayoutAutomation.enabled) return { ok: false, reason: "disabled", publicConfig };
  if (!partnerPayoutAutomation.entityTypeId) return { ok: false, reason: "missing_entity_type_id", publicConfig };
  if (!partnerPayoutAutomation.newStageId) return { ok: false, reason: "missing_new_stage_id", publicConfig };
  if (!partnerPayoutAutomation.paymentStageId) return { ok: false, reason: "missing_payment_stage_id", publicConfig };
  return { ok: true, publicConfig };
}

function isAuthorizedPartnerPayoutJobRequest(req) {
  if (!partnerPayoutAutomation.manualToken) return false;
  const token = String(req.headers["x-job-token"] || "");
  return constantTimeEqual(token, partnerPayoutAutomation.manualToken);
}

function isAuthorizedBirthdayBonusJobRequest(req) {
  if (!birthdayBonusAutomation.manualToken) return false;
  const token = String(req.headers["x-job-token"] || "");
  return constantTimeEqual(token, birthdayBonusAutomation.manualToken);
}

async function loadPartnerPayoutCandidates(monthKey = "") {
  const limit = Math.min(Math.max(Number(partnerPayoutAutomation.listLimit) || 500, 1), 500);
  const raw = await bitrixRequest(`/v1/items/${partnerPayoutAutomation.entityTypeId}?limit=${limit}`);
  return asArray(raw)
    .map(mapPartnerPayoutItem)
    .filter((item) =>
      item.id &&
      normalizeStageId(item.stageId) === normalizeStageId(partnerPayoutAutomation.newStageId) &&
      (!monthKey || getPartnerPayoutItemMonthKey(item) === monthKey)
    );
}

async function buildPartnerPayoutReport({ month = "", type = "", stage = "", dealStage = "", branch = "", paid = "", q = "", limit = 500, enrich = false } = {}) {
  const monthKey = normalizeReportMonth(month);
  const rows = await loadPartnerPayoutReportItems({ limit });
  const typeMetadata = await loadPartnerPayoutTypeMetadata();
  for (const row of rows) {
    row.partnershipTypeLabel = typeMetadata.payoutLabels.get(String(row.partnershipTypeId)) || row.partnershipTypeLabel;
  }
  const normalizedType = normalizeReportFilter(type);
  const normalizedStage = normalizeReportFilter(stage);
  const normalizedDealStage = normalizeReportFilter(dealStage);
  const normalizedBranch = normalizeReportFilter(branch);
  const normalizedPaid = normalizeReportFilter(paid);
  const query = normalizeReportFilter(q);

  const prefiltered = rows.filter((row) => {
    if (monthKey && row.monthKey !== monthKey) return false;
    if (normalizedStage && normalizeReportFilter(row.stageLabel) !== normalizedStage && normalizeStageId(row.stageId) !== normalizeStageId(stage)) return false;
    if (normalizedPaid && normalizeReportFilter(row.paidLabel) !== normalizedPaid && normalizeReportFilter(row.paid) !== normalizedPaid) return false;
    if (query) {
      const haystack = normalizeReportFilter([row.code, row.partnerName, row.title, row.dealTitle, row.offlineWithoutRegistration ? "продажа офлайн без регистрации" : ""].join(" "));
      if (!haystack.includes(query)) return false;
    }
    return true;
  });

  // The linked partner card is the source of truth for partnership type.
  // New enumeration values therefore appear without a code update.
  await enrichPartnerPayoutRowsWithPartners(prefiltered, typeMetadata.partnerLabels);
  const filtered = prefiltered.filter((row) => {
    if (!normalizedType) return true;
    return normalizeReportFilter(row.partnershipTypeLabel) === normalizedType || String(row.partnershipTypeId) === type;
  });

  // Deal stages are part of the report and are fetched in batches.
  await enrichPartnerPayoutRowsWithDeals(filtered);
  const options = buildPartnerPayoutReportOptions(rows, filtered, typeMetadata.partnerOptions.map((option) => option.label));
  const reportRows = filtered.filter((row) => {
    if (normalizedDealStage && !matchesPartnerPayoutDealStage(row, dealStage)) return false;
    if (normalizedBranch && (normalizedBranch === "unassigned"
      ? Boolean(row.branch)
      : normalizeReportFilter(row.branch) !== normalizedBranch)) return false;
    return true;
  });
  const groups = buildPartnerPayoutGroups(reportRows);
  const totals = sumPartnerPayoutRows(reportRows);
  return {
    ok: true,
    month: monthKey,
    generatedAt: new Date().toISOString(),
    filters: { type, stage, dealStage, branch, paid, q },
    totals: {
      ...totals,
      groups: groups.length,
      orders: reportRows.length,
      paidCount: reportRows.filter((row) => row.isPaid).length,
      unpaidCount: reportRows.filter((row) => !row.isPaid).length,
    },
    options,
    groups,
    rows: reportRows,
  };
}

async function loadPartnerPayoutReportItems({ limit = 500 } = {}) {
  const pageLimit = Math.min(Math.max(Number(limit) || 500, 1), 5000);
  const raw = await bitrixRequest(`/v1/items/${partnerPayoutAutomation.entityTypeId}?limit=${pageLimit}`);
  return asArray(raw)
    .map(mapPartnerPayoutReportItem)
    .filter((row) => row.id)
    .sort((left, right) => `${left.date}|${left.code}|${left.id}`.localeCompare(`${right.date}|${right.code}|${right.id}`));
}

function mapPartnerPayoutReportItem(item) {
  const id = String(item.id ?? item.ID ?? "");
  const orderAmount = parseMoneyAmount(item[partnerPayoutFields.orderAmount]);
  const rewardPercent = numberOrZero(item[partnerPayoutFields.rewardPercent]);
  const payoutAmount = numberOrZero(item.opportunity ?? item.OPPORTUNITY ?? item.amount ?? item.AMOUNT);
  const code = normalizePromoCode(item[partnerPayoutFields.code]);
  const stageId = clean(item.stageId || item.STAGE_ID || item.stage || item.STAGE || "");
  const date = dateOnly(item.begindate || item.BEGINDATE || item.createdTime || item.CREATED_TIME || item.dateCreate || item.DATE_CREATE);
  const partnerParentId = Number(item[partnerPayoutFields.partnerParent] || 0) || null;
  const dealId = Number(item[partnerPayoutFields.dealParent] || item.parentId2 || item.PARENT_ID_2 || item.dealId || item.DEAL_ID || 0) || null;
  const contactId = Number(item.contactId || item.CONTACT_ID || 0) || null;
  const partnershipTypeId = clean(item[partnerPayoutFields.partnershipType]);
  const paid = clean(item[partnerPayoutFields.paid]);
  const isPaid = isPartnerPayoutPaid(paid) || normalizeStageId(stageId) === normalizeStageId(partnerPayoutAutomation.paidStageId);
  const title = clean(item.title || item.TITLE || item.name || item.NAME);
  const comment = clean(item[partnerPayoutFields.comment]);
  const branchValue = normalizeReportFilter(item[partnerPayoutFields.branch]);
  const managerRemainder = parseMoneyAmount(item[partnerPayoutFields.managerRemainder]);
  const branch = branchValue === "сокол" || branchValue === "sokol" ? "sokol"
    : branchValue === "белка" || branchValue === "belka" ? "belka" : "";
  return {
    id,
    title,
    url: buildSmartItemUrl(partnerPayoutAutomation.entityTypeId, id),
    date,
    monthKey: date ? date.slice(0, 7) : "",
    code,
    partnerName: extractPartnerName(item) || extractPartnerNameFromTitle(title, code),
    partnerParentId,
    partnerUrl: partnerParentId ? buildSmartItemUrl(partnerPromo.entityTypeId, partnerParentId) : "",
    contactId,
    dealId,
    branch,
    offlineWithoutRegistration: !dealId && comment.toLowerCase().includes("без регистрации"),
    dealTitle: clean(item.dealTitle || item.DEAL_TITLE || ""),
    dealUrl: dealId ? buildDealUrl(dealId) : "",
    dealStageId: "",
    dealStageLabel: "",
    dealStageSemanticId: "",
    partnershipTypeId,
    partnershipTypeLabel: getPartnerPayoutTypeLabel(partnershipTypeId),
    stageId,
    stageLabel: getPartnerPayoutStageLabel(stageId),
    payoutStageLabel: getPartnerPayoutStageLabel(stageId),
    orderAmount,
    rewardPercent,
    payoutAmount: payoutAmount || roundMoney(orderAmount * rewardPercent / 100),
    managerRemainder,
    paid,
    paidLabel: isPaid ? "\u0414\u0430" : "\u041d\u0435\u0442",
    isPaid,
    comment,
    cancelReason: clean(item[partnerPayoutFields.cancelReason]),
  };
}

async function markPartnerPayoutsPaid(payload = {}) {
  const ids = unique((Array.isArray(payload.ids) ? payload.ids : [])
    .map((value) => String(value || "").trim())
    .filter((value) => /^\d+$/.test(value)))
    .slice(0, 500);
  if (!ids.length) throw Object.assign(new Error("Выберите хотя бы одну выплату."), { status: 400, publicMessage: "Выберите хотя бы одну выплату." });

  const existing = new Map((await loadPartnerPayoutReportItems({ limit: 5000 })).map((row) => [row.id, row]));
  const moved = [];
  const skipped = [];
  const errors = [];
  await mapWithConcurrency(ids, 4, async (id) => {
    const row = existing.get(id);
    if (!row) return skipped.push({ id, reason: "not_found" });
    if (row.isPaid) return skipped.push({ id, reason: "already_paid" });
    if (normalizeStageId(row.stageId) === "DT1042_17:FAIL") return skipped.push({ id, reason: "rejected" });
    try {
      await bitrixRequest(`/v1/items/${partnerPayoutAutomation.entityTypeId}/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify({ stageId: partnerPayoutAutomation.paidStageId }),
      });
      moved.push(id);
    } catch (error) {
      errors.push({ id, error: error.message });
    }
  });
  return { ok: errors.length === 0, requested: ids.length, moved, skipped, errors };
}

async function enrichPartnerPayoutRowsWithPartners(rows, typeLabels = new Map()) {
  let partners = [];
  try {
    partners = await loadPartnerPromos();
  } catch (error) {
    console.warn(`Partner payout report: failed to load partner cards: ${error.message}`);
  }
  const partnersById = new Map(partners.map((partner) => [String(partner.id), partner]));
  const partnersByCode = new Map(partners.map((partner) => [normalizePromoCode(partner.code), partner]));
  const unresolvedIds = unique(rows
    .filter((row) => row.partnerParentId && !partnersById.has(String(row.partnerParentId)))
    .map((row) => row.partnerParentId));
  await mapWithConcurrency(unresolvedIds, 4, async (partnerId) => {
    try {
      const partner = await bitrixRequest(`/v1/items/${partnerPromo.entityTypeId}/${encodeURIComponent(partnerId)}`);
      partnersById.set(String(partnerId), mapPartnerPayoutPartnerCard(partner, partnerId));
    } catch (error) {
      console.warn(`Partner payout report: failed to load archived partner card ${partnerId}: ${error.message}`);
    }
  });
  for (const row of rows) {
    const partner = partnersById.get(String(row.partnerParentId)) || partnersByCode.get(normalizePromoCode(row.code));
    if (!partner) continue;
    row.partnerName = partner.name || partner.partnerName || row.partnerName;
    row.partnerUrl = partner.url || (partner.id ? buildSmartItemUrl(partnerPromo.entityTypeId, partner.id) : "") || row.partnerUrl;
    row.partnerCode = partner.code || row.code;
    row.partnerStageId = partner.stageId;
    row.partnerStageLabel = partner.stageLabel || partner.status || partner.stageId || "";
    if (partner.partnershipTypeId) {
      row.partnershipTypeId = partner.partnershipTypeId;
      row.partnershipTypeLabel = typeLabels.get(String(partner.partnershipTypeId)) || row.partnershipTypeLabel;
    }
  }
}

function mapPartnerPayoutPartnerCard(item, fallbackId = "") {
  const id = String(item?.id || item?.ID || fallbackId || "");
  const title = clean(item?.title || item?.TITLE || item?.name || item?.NAME || (id ? `\u041f\u0430\u0440\u0442\u043d\u0435\u0440 #${id}` : ""));
  const stageId = clean(item?.stageId || item?.STAGE_ID || "");
  return {
    id,
    name: title,
    code: normalizePromoCode(item?.[partnerPromo.codeField]),
    partnershipTypeId: clean(item?.[partnerPromo.partnershipTypeField]),
    stageId,
    stageLabel: stageId,
    url: id ? buildSmartItemUrl(partnerPromo.entityTypeId, id) : "",
  };
}

async function enrichPartnerPayoutRowsWithDeals(rows) {
  const dealIds = unique(rows.map((row) => row.dealId).filter(Boolean));
  const dealsById = new Map();
  const batches = [];
  for (let index = 0; index < dealIds.length; index += 100) batches.push(dealIds.slice(index, index + 100));
  await mapWithConcurrency(batches, 4, async (ids) => {
    try {
      const raw = await bitrixRequest("/v1/deals/search", {
        method: "POST",
        body: JSON.stringify({
          filter: { id: { $in: ids } },
          select: ["id", "title", "stageId", "stageSemanticId", "categoryId", dealOrderFields.deliveryPoint, dealOrderFields.warehouse],
          limit: ids.length,
        }),
      });
      for (const deal of asArray(raw)) {
        const mapped = mapPartnerPayoutDeal(deal);
        if (mapped.id) dealsById.set(mapped.id, mapped);
      }
    } catch (error) {
      console.warn(`Partner payout report: failed to load deals ${ids.join(",")}: ${error.message}`);
    }
  });
  const stageLabels = await loadPartnerPayoutDealStageLabels([...dealsById.values()]);
  for (const row of rows) {
    const deal = dealsById.get(String(row.dealId));
    if (!deal) continue;
    row.dealTitle = deal.title || row.dealTitle;
    row.dealStageId = deal.stageId;
    row.dealStageLabel = stageLabels.get(normalizeStageId(deal.stageId)) || deal.stageLabel;
    row.dealStageSemanticId = deal.stageSemanticId;
    row.branch = deal.branch;
  }
}

async function loadPartnerPayoutDealStageLabels(deals) {
  const categoryIds = unique(deals.map((deal) => Number(deal.categoryId) || 0));
  const labels = new Map();
  await mapWithConcurrency(categoryIds, 4, async (categoryId) => {
    const entityId = getDealStageEntityId(categoryId);
    try {
      const raw = await bitrixRequest(`/v1/statuses?entityId=${encodeURIComponent(entityId)}&limit=500`);
      for (const status of asArray(raw)) {
        const stageId = clean(status.statusId || status.STATUS_ID || "");
        const name = clean(status.name || status.NAME || "");
        if (stageId && name) labels.set(normalizeStageId(stageId), name);
      }
    } catch (error) {
      console.warn(`Partner payout report: failed to load stages for category ${categoryId}: ${error.message}`);
    }
  });
  return labels;
}

function getDealStageEntityId(categoryId) {
  const normalized = Number(categoryId) || 0;
  return normalized > 0 ? `DEAL_STAGE_${normalized}` : "DEAL_STAGE";
}

function mapPartnerPayoutDeal(deal, fallbackId = "") {
  const id = deal?.id || deal?.ID || fallbackId;
  const stageId = clean(deal?.stageId || deal?.STAGE_ID || "");
  const stageName = clean(deal?.stageName || deal?.STAGE_NAME || "");
  const branch = getPartnerPayoutDealBranch(deal);
  return {
    id: String(id || ""),
    title: clean(deal?.title || deal?.TITLE || (id ? `\u0421\u0434\u0435\u043b\u043a\u0430 #${id}` : "")),
    stageId,
    stageLabel: stageName || getDealStageFallbackLabel(stageId),
    stageSemanticId: clean(deal?.stageSemanticId || deal?.STAGE_SEMANTIC_ID || ""),
    ...(branch ? { branch } : {}),
    categoryId: Number(deal?.categoryId ?? deal?.CATEGORY_ID ?? 0) || 0,
  };
}

function getPartnerPayoutDealBranch(deal) {
  const warehouse = String(getDealValue(deal, dealOrderFields.warehouse) || "");
  if (warehouse === String(safePickupBranches.sokol.warehouseId)) return "sokol";
  if (warehouse === String(safePickupBranches.belka.warehouseId)) return "belka";
  const point = normalizeReportFilter(getDealValue(deal, dealOrderFields.deliveryPoint));
  if (point.includes("сокол")) return "sokol";
  if (point.includes("белк")) return "belka";
  const title = normalizeReportFilter(deal?.title || deal?.TITLE);
  if (title.includes("сокол")) return "sokol";
  if (title.includes("белк")) return "belka";
  return "";
}

function getDealStageFallbackLabel(stageId) {
  const normalized = normalizeStageId(stageId);
  if (!normalized) return "";
  if (normalized.includes("WON") || normalized.includes("SUCCESS")) return "\u0423\u0441\u043f\u0435\u0448\u043d\u0430\u044f";
  if (normalized.includes("LOSE") || normalized.includes("FAIL")) return "\u041f\u0440\u043e\u0432\u0430\u043b\u0435\u043d\u0430";
  return stageId;
}

function buildPartnerPayoutGroups(rows) {
  const byCode = new Map();
  for (const row of rows) {
    const key = row.code || `CARD-${row.partnerParentId || row.contactId || row.id}`;
    if (!byCode.has(key)) {
      byCode.set(key, {
        key,
        code: row.code,
        partnerName: row.partnerName,
        partnerUrl: row.partnerUrl,
        partnershipTypeLabel: row.partnershipTypeLabel,
        rewardPercent: row.rewardPercent,
        totals: { orders: 0, orderAmount: 0, payoutAmount: 0, managerRemainder: 0, paidAmount: 0, unpaidAmount: 0 },
        days: [],
      });
    }
    const group = byCode.get(key);
    group.partnerName ||= row.partnerName;
    group.partnerUrl ||= row.partnerUrl;
    group.partnershipTypeLabel ||= row.partnershipTypeLabel;
    group.rewardPercent ||= row.rewardPercent;
    group.days.push(row);
    group.totals.orders += 1;
    group.totals.orderAmount = roundMoney(group.totals.orderAmount + row.orderAmount);
    group.totals.payoutAmount = roundMoney(group.totals.payoutAmount + row.payoutAmount);
    group.totals.managerRemainder = roundMoney(group.totals.managerRemainder + row.managerRemainder);
    if (row.isPaid) group.totals.paidAmount = roundMoney(group.totals.paidAmount + row.payoutAmount);
    else group.totals.unpaidAmount = roundMoney(group.totals.unpaidAmount + row.payoutAmount);
  }
  return [...byCode.values()]
    .map((group) => ({ ...group, days: group.days.sort((left, right) => `${left.date}|${left.id}`.localeCompare(`${right.date}|${right.id}`)) }))
    .sort((left, right) => right.totals.payoutAmount - left.totals.payoutAmount || left.key.localeCompare(right.key, "ru"));
}

function sumPartnerPayoutRows(rows) {
  return rows.reduce((totals, row) => {
    totals.orderAmount = roundMoney(totals.orderAmount + row.orderAmount);
    totals.payoutAmount = roundMoney(totals.payoutAmount + row.payoutAmount);
    totals.managerRemainder = roundMoney(totals.managerRemainder + row.managerRemainder);
    if (row.isPaid) totals.paidAmount = roundMoney(totals.paidAmount + row.payoutAmount);
    else totals.unpaidAmount = roundMoney(totals.unpaidAmount + row.payoutAmount);
    return totals;
  }, { orderAmount: 0, payoutAmount: 0, managerRemainder: 0, paidAmount: 0, unpaidAmount: 0 });
}

function buildPartnerPayoutReportOptions(rows, dealRows = rows, configuredTypes = []) {
  return {
    months: unique(rows.map((row) => row.monthKey).filter(Boolean)).sort().reverse(),
    types: unique([...configuredTypes, ...rows.map((row) => row.partnershipTypeLabel)].filter(Boolean)).sort((left, right) => left.localeCompare(right, "ru")),
    stages: unique(rows.map((row) => row.stageLabel).filter(Boolean)).sort((left, right) => left.localeCompare(right, "ru")),
    dealStages: unique(dealRows.map((row) => row.dealStageLabel).filter(Boolean)).sort((left, right) => left.localeCompare(right, "ru")),
  };
}

function extractEnumerationOptions(field) {
  const items = Array.isArray(field?.items) ? field.items : Array.isArray(field?.ITEMS) ? field.ITEMS : [];
  return items
    .map((item) => ({
      id: clean(item?.ID ?? item?.id ?? item?.VALUE_ID ?? item?.valueId),
      label: clean(item?.VALUE ?? item?.value ?? item?.NAME ?? item?.name),
    }))
    .filter((item) => item.id && item.label);
}

function findSmartProcessField(fieldsResponse, fieldName) {
  const fields = fieldsResponse?.fields || fieldsResponse?.result?.fields || fieldsResponse || {};
  if (Array.isArray(fields)) {
    return fields.find((field) => clean(field?.name || field?.fieldName || field?.FIELD_NAME) === fieldName) || null;
  }
  return fields[fieldName] || fields[fieldName.toUpperCase()] || null;
}

async function loadPartnerPayoutTypeMetadata() {
  const now = Date.now();
  if (partnerPayoutTypeMetadataCache.value && partnerPayoutTypeMetadataCache.expiresAt > now) {
    return partnerPayoutTypeMetadataCache.value;
  }
  try {
    const [partnerFields, payoutFields] = await Promise.all([
      bitrixRequest(`/v1/items/${partnerPromo.entityTypeId}/fields`),
      bitrixRequest(`/v1/items/${partnerPayoutAutomation.entityTypeId}/fields`),
    ]);
    const partnerOptions = extractEnumerationOptions(findSmartProcessField(partnerFields, partnerPromo.partnershipTypeField));
    const payoutOptions = extractEnumerationOptions(findSmartProcessField(payoutFields, partnerPayoutFields.partnershipType));
    const value = {
      partnerOptions,
      partnerLabels: new Map(partnerOptions.map((option) => [String(option.id), option.label])),
      payoutLabels: new Map(payoutOptions.map((option) => [String(option.id), option.label])),
    };
    partnerPayoutTypeMetadataCache.value = value;
    partnerPayoutTypeMetadataCache.expiresAt = now + 5 * 60 * 1000;
    return value;
  } catch (error) {
    console.warn(`Partner payout report: failed to load partnership type metadata: ${error.message}`);
    const partnerOptions = [
      { id: "97", label: "\u042d\u043a\u0441\u043f\u0435\u0440\u0442" },
      { id: "99", label: "\u0410\u043c\u0431\u0430\u0441\u0441\u0430\u0434\u043e\u0440" },
      { id: "109", label: "\u0414\u0440\u0443\u0433\u043e\u0435" },
    ];
    return {
      partnerOptions,
      partnerLabels: new Map(partnerOptions.map((option) => [option.id, option.label])),
      payoutLabels: new Map(),
    };
  }
}

function matchesPartnerPayoutDealStage(row, value) {
  const expected = normalizeReportFilter(value);
  if (!expected) return true;
  return normalizeReportFilter(row?.dealStageLabel) === expected ||
    normalizeStageId(row?.dealStageId) === normalizeStageId(value);
}

async function mapWithConcurrency(items, limit, worker) {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(Math.max(Number(limit) || 1, 1), queue.length || 1) }, async () => {
    while (queue.length) {
      const item = queue.shift();
      await worker(item);
    }
  });
  await Promise.all(workers);
}

function normalizeReportMonth(value) {
  const text = clean(value);
  const match = /^(\d{4})-(\d{2})/.exec(text);
  if (match) return `${match[1]}-${match[2]}`;
  return getMonthKey(new Date());
}

function normalizeReportFilter(value) {
  return String(value || "").trim().toLowerCase().replace(/\u0451/g, "\u0435");
}

function getPartnerPayoutTypeLabel(value) {
  const id = String(value || "").trim();
  if (!id) return "";
  if (id === String(partnerPayoutPartnershipTypes["97"])) return "\u042d\u043a\u0441\u043f\u0435\u0440\u0442";
  if (id === String(partnerPayoutPartnershipTypes["99"])) return "\u0410\u043c\u0431\u0430\u0441\u0441\u0430\u0434\u043e\u0440";
  if (id === String(partnerPayoutPartnershipTypes["109"])) return "\u0414\u0440\u0443\u0433\u043e\u0439";
  return id;
}

function getPartnerPayoutStageLabel(stageId) {
  const normalized = normalizeStageId(stageId);
  const labels = {
    [normalizeStageId(partnerPayoutAutomation.newStageId)]: "\u041d\u043e\u0432\u044b\u0439 \u0437\u0430\u043a\u0430\u0437",
    [normalizeStageId(partnerPayoutAutomation.paymentStageId)]: "\u041a \u043e\u043f\u043b\u0430\u0442\u0435",
    "DT1042_17:SUCCESS": "\u0412\u044b\u043f\u043b\u0430\u0447\u0435\u043d\u043e",
    "DT1042_17:FAIL": "\u0412\u044b\u043f\u043b\u0430\u0442\u0430 \u043e\u0442\u043a\u043b\u043e\u043d\u0435\u043d\u0430",
  };
  return labels[normalized] || stageId || "";
}

function isPartnerPayoutPaid(value) {
  const normalized = normalizeReportFilter(value);
  return ["y", "yes", "true", "1", "\u0434\u0430"].includes(normalized);
}

function extractPartnerName(item) {
  const contact = item.contact || item.CONTACT || {};
  const contactName = [contact.lastName || contact.LAST_NAME, contact.name || contact.NAME].map(clean).filter(Boolean).join(" ");
  return contactName || clean(item.contactName || item.CONTACT_NAME || item.partnerName || item.PARTNER_NAME);
}

function extractPartnerNameFromTitle(title, code = "") {
  const cleanTitle = clean(title);
  const match = /:\s*(.+)$/.exec(cleanTitle);
  const name = clean(match?.[1] || "");
  return name && name.toUpperCase() !== code ? name : "";
}

function mapPartnerPayoutItem(item) {
  return {
    id: String(item.id ?? item.ID ?? ""),
    title: clean(item.title || item.TITLE || item.name || item.NAME || ""),
    stageId: clean(item.stageId || item.STAGE_ID || item.stage || item.STAGE || ""),
    begindate: clean(item.begindate || item.BEGINDATE || ""),
    createdTime: clean(item.createdTime || item.CREATED_TIME || item.dateCreate || item.DATE_CREATE || ""),
  };
}

function getPartnerPayoutItemMonthKey(item) {
  const source = clean(item.begindate || item.createdTime);
  const match = /^(\d{4})-(\d{2})-/.exec(source);
  return match ? `${match[1]}-${match[2]}` : "";
}

async function movePartnerPayoutToPaymentStage(itemId) {
  return bitrixRequest(`/v1/items/${partnerPayoutAutomation.entityTypeId}/${encodeURIComponent(itemId)}`, {
    method: "PATCH",
    body: JSON.stringify({ stageId: partnerPayoutAutomation.paymentStageId }),
  });
}

function normalizeStageId(value) {
  return String(value || "").trim().toUpperCase();
}

export function isLastDayOfMonth(date = new Date()) {
  const value = new Date(date);
  const lastDay = new Date(value.getFullYear(), value.getMonth() + 1, 0).getDate();
  return value.getDate() === lastDay;
}

export function isFirstDayOfMonth(date = new Date()) {
  return new Date(date).getDate() === 1;
}

export function getMonthKey(date = new Date()) {
  const value = new Date(date);
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}`;
}

export function getPreviousMonthKey(date = new Date()) {
  const value = new Date(date);
  return getMonthKey(new Date(value.getFullYear(), value.getMonth() - 1, 1));
}

function toDateKey(date = new Date()) {
  const value = new Date(date);
  return `${getMonthKey(value)}-${String(value.getDate()).padStart(2, "0")}`;
}

async function readPartnerPayoutAutomationState() {
  try {
    const raw = await fs.promises.readFile(partnerPayoutAutomation.stateFile, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return {};
  }
}

async function writePartnerPayoutAutomationState(state) {
  await fs.promises.mkdir(path.dirname(partnerPayoutAutomation.stateFile), { recursive: true });
  await fs.promises.writeFile(partnerPayoutAutomation.stateFile, JSON.stringify(state, null, 2), "utf8");
}

function startBirthdayBonusAutomationLoop() {
  if (!birthdayBonusAutomation.enabled) return;
  const scheduleNext = () => {
    const delayMs = msUntilNextMoscowSchedule();
    const timer = setTimeout(run, delayMs);
    timer.unref?.();
    console.log(`Birthday bonus next run scheduled in ${Math.round(delayMs / 1000)}s at ${birthdayBonusAutomation.scheduleHourMsk}:${
      String(birthdayBonusAutomation.scheduleMinuteMsk).padStart(2, "0")
    } MSK.`);
  };
  const run = () => {
    runBirthdayBonusAutomation({ dryRun: false, force: false, now: new Date(), source: "schedule" })
      .then((result) => {
        if (!result.skipped) {
          console.log(`Birthday bonus run: accrued ${result.accrued}, expired ${result.expired}/${result.total} contacts, errors ${result.errors.length}.`);
        }
      })
      .catch((error) => console.error(`Birthday bonus run failed: ${error.message}`))
      .finally(scheduleNext);
  };
  scheduleNext();
}

export function msUntilNextMoscowSchedule(now = new Date()) {
  const moscowOffsetMs = 3 * 60 * 60 * 1000;
  const nowDate = new Date(now);
  const moscowNow = new Date(nowDate.getTime() + moscowOffsetMs);
  let targetUtcMs = Date.UTC(
    moscowNow.getUTCFullYear(),
    moscowNow.getUTCMonth(),
    moscowNow.getUTCDate(),
    birthdayBonusAutomation.scheduleHourMsk - 3,
    birthdayBonusAutomation.scheduleMinuteMsk,
    0,
    0,
  );
  if (targetUtcMs <= nowDate.getTime()) targetUtcMs += 24 * 60 * 60 * 1000;
  return Math.max(targetUtcMs - nowDate.getTime(), 1000);
}

async function runBirthdayBonusAutomation({
  dryRun = true,
  force = false,
  contactId = "",
  now = new Date(),
  source = "manual",
} = {}) {
  const today = toDateKey(now);
  const config = validateBirthdayBonusAutomationConfig();
  if (!config.ok) {
    return { ok: false, skipped: true, reason: config.reason, dryRun, source, date: today, config: config.publicConfig };
  }

  if (!contactId && !dryRun && !force) {
    const state = await readBirthdayBonusAutomationState();
    if (state.lastProcessedDate === today) {
      return {
        ok: true,
        skipped: true,
        reason: "already_processed",
        dryRun,
        source,
        date: today,
        processedAt: state.lastProcessedAt || null,
      };
    }
  }

  const contacts = contactId
    ? [await bitrixRequest(`/v1/contacts/${encodeURIComponent(contactId)}`)]
    : await loadBirthdayBonusContacts();
  const accrued = [];
  const expired = [];
  const skipped = [];
  const errors = [];

  for (const contact of contacts) {
    try {
      const result = await runBirthdayBonusForContact(contact, { dryRun, now, source });
      if (result.summary.accrued) accrued.push(result.summary);
      else if (result.summary.expired) expired.push(result.summary);
      else skipped.push(result.summary);
      if (!dryRun) await delay(birthdayBonusAutomation.batchDelayMs);
    } catch (error) {
      errors.push({
        contactId: String(contact?.id || contact?.ID || ""),
        error: error.message,
      });
    }
  }

  const result = {
    ok: errors.length === 0,
    skipped: false,
    dryRun,
    source,
    date: today,
    total: contacts.length,
    accrued: accrued.length,
    expired: expired.length,
    skippedContacts: skipped.length,
    accruedContacts: accrued,
    expiredContacts: expired,
    skippedSample: skipped.slice(0, 20),
    errors,
  };

  await appendBirthdayBonusAutomationLog({
    event: "birthday_bonus_automation",
    recordedAt: new Date().toISOString(),
    ...result,
    accruedContacts: accrued.slice(0, 100),
    expiredContacts: expired.slice(0, 100),
  }).catch((error) => console.warn("Birthday bonus automation logging failed:", error.message));

  if (!contactId && !dryRun && errors.length === 0) {
    await writeBirthdayBonusAutomationState({
      lastProcessedDate: today,
      lastProcessedAt: new Date().toISOString(),
      source,
      total: contacts.length,
      accrued: accrued.length,
      expired: expired.length,
      skipped: skipped.length,
    });
  }

  return result;
}

async function runBirthdayBonusForContact(contact, { dryRun = false, now = new Date(), source = "manual" } = {}) {
  const plan = buildBirthdayBonusPatch(contact, { now });
  const summary = {
    contactId: String(contact?.id || contact?.ID || ""),
    birthdate: plan.birthdate || "",
    birthdayDate: plan.birthdayDate || "",
    accrued: false,
    expired: false,
    reason: plan.reason,
    amount: plan.amount || 0,
    expiredAmount: plan.expiredAmount || 0,
    expiresAt: plan.expiresAt || "",
    source,
    dryRun,
  };
  if (!plan.shouldAccrue && !plan.shouldExpire) return { summary, contact };

  summary.accrued = Boolean(plan.shouldAccrue);
  summary.expired = Boolean(plan.shouldExpire);
  if (dryRun) return { summary, contact };

  const contactId = contact.id || contact.ID;
  await bitrixRequest(`/v1/contacts/${encodeURIComponent(contactId)}`, {
    method: "PATCH",
    body: JSON.stringify(plan.fields),
  });
  await Promise.allSettled([
    appendBirthdayBonusAutomationLog({
      event: plan.shouldExpire ? "birthday_bonus_expired" : "birthday_bonus_accrued",
      recordedAt: new Date().toISOString(),
      ...summary,
      fields: plan.fields,
    }),
    plan.shouldExpire
      ? addBirthdayBonusExpirationTimelineLog({ ...summary, contactId })
      : addBirthdayBonusTimelineLog({ ...summary, contactId }),
  ]).then((results) => {
    for (const result of results) {
      if (result.status === "rejected") console.warn("Birthday bonus logging failed:", result.reason?.message || result.reason);
    }
  });
  const updated = await bitrixRequest(`/v1/contacts/${encodeURIComponent(contactId)}`);
  return { summary, contact: updated };
}

export function buildBirthdayBonusPatch(contact, { now = new Date() } = {}) {
  const contactId = String(contact?.id || contact?.ID || "");
  const birthdate = dateOnly(contact?.birthdate || contact?.BIRTHDATE);
  const amount = roundMoney(birthdayBonusAutomation.amount);
  const today = dateOnly(now);
  const currentYear = Number(today.slice(0, 4));
  const birthdayDate = birthdate ? birthdayDateForYear(birthdate, currentYear) : "";
  const window = birthdayBonusWindow(today);

  if (!contactId) return { shouldAccrue: false, reason: "missing_contact_id", amount, birthdate, birthdayDate };
  const birthdayState = buildBirthdayBonusState({
    accrued: contact[loyaltyFields.birthdayBonusAccrued],
    used: contact[loyaltyFields.birthdayBonusUsed],
    expired: contact[loyaltyFields.birthdayBonusExpired],
    accruedAt: contact[loyaltyFields.birthdayBonusAccruedAt],
    expiresAt: contact[loyaltyFields.birthdayBonusExpiresAt],
    lastYear: contact[loyaltyFields.birthdayBonusLastYear],
    today: now,
  });
  if (birthdayState.shouldExpire) {
    const expiredAmount = roundMoney(Math.max(0, birthdayState.accrued - birthdayState.used - birthdayState.expired));
    const fields = {
      [loyaltyFields.birthdayBonusAccrued]: 0,
      [loyaltyFields.birthdayBonusExpired]: roundMoney(birthdayState.expired + expiredAmount),
      [loyaltyFields.syncedAt]: new Date(now).toISOString(),
    };
    return {
      shouldAccrue: false,
      shouldExpire: true,
      reason: "expired_by_date",
      amount,
      expiredAmount,
      birthdate,
      birthdayDate,
      expiresAt: birthdayState.expiresAt,
      fields,
    };
  }
  if (!birthdate) return { shouldAccrue: false, reason: "missing_birthdate", amount, birthdate, birthdayDate };
  if (!amount) return { shouldAccrue: false, reason: "zero_amount", amount, birthdate, birthdayDate };
  if (!isDateBetween(birthdayDate, window.start, window.end)) {
    return { shouldAccrue: false, reason: "outside_window", amount, birthdate, birthdayDate, window };
  }

  const lastYear = numberOrNull(contact[loyaltyFields.birthdayBonusLastYear]);
  const accruedAtYear = yearFromDate(contact[loyaltyFields.birthdayBonusAccruedAt]);
  const expiresAtYear = yearFromDate(contact[loyaltyFields.birthdayBonusExpiresAt]);
  if (lastYear === currentYear || accruedAtYear === currentYear || expiresAtYear === currentYear) {
    return { shouldAccrue: false, reason: "already_accrued_this_year", amount, birthdate, birthdayDate, window };
  }

  const expiresAt = addDateDays(birthdayDate, birthdayBonusAutomation.lifetimeDays);
  const totals = computeBirthdayBonusTotals(contact, { birthdayAccrued: amount, birthdayUsed: 0, birthdayExpired: 0 });
  const fields = {
    [loyaltyFields.birthdayBonusAccrued]: amount,
    [loyaltyFields.birthdayBonusUsed]: 0,
    [loyaltyFields.birthdayBonusExpired]: 0,
    [loyaltyFields.birthdayBonusAccruedAt]: today,
    [loyaltyFields.birthdayBonusExpiresAt]: expiresAt,
    [loyaltyFields.birthdayBonusLastYear]: currentYear,
    [loyaltyFields.accruedTotal]: totals.accruedTotal,
    [loyaltyFields.spentTotal]: totals.spentTotal,
    [loyaltyFields.syncedAt]: new Date(now).toISOString(),
  };

  return { shouldAccrue: true, reason: "in_birthday_window", amount, birthdate, birthdayDate, expiresAt, window, fields };
}

function validateBirthdayBonusAutomationConfig() {
  const publicConfig = {
    amount: birthdayBonusAutomation.amount,
    windowDays: birthdayBonusAutomation.windowDays,
    lifetimeDays: birthdayBonusAutomation.lifetimeDays,
    listLimit: birthdayBonusAutomation.listLimit,
  };
  if (!birthdayBonusAutomation.enabled) return { ok: false, reason: "disabled", publicConfig };
  if (!birthdayBonusAutomation.amount) return { ok: false, reason: "missing_amount", publicConfig };
  return { ok: true, publicConfig };
}

async function loadBirthdayBonusContacts() {
  const select = [
    "id", "name", "lastName", "secondName", "phone", "email", "birthdate",
    ...Object.values(loyaltyFields),
  ];
  const limit = birthdayBonusAutomation.listLimit;
  const contacts = [];
  let afterId = "";
  for (let page = 0; page < 200; page += 1) {
    const filter = afterId ? { id: { $gt: Number(afterId) || afterId } } : {};
    const payload = {
      filter,
      select,
      sort: { id: "ASC" },
      limit,
    };
    const raw = await bitrixRawRequest("/v1/contacts/search", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    const batch = asArray(raw?.data ?? raw);
    contacts.push(...batch.filter((contact) => dateOnly(contact?.birthdate || contact?.BIRTHDATE)));
    afterId = String(raw?.meta?.nextAfterId || "");
    if (!raw?.meta?.hasMore || !afterId || !batch.length) break;
  }
  return contacts;
}

function computeBirthdayBonusTotals(contact, { birthdayAccrued, birthdayUsed, birthdayExpired }) {
  const accruedTotal = roundMoney(
    numberOrZero(contact[loyaltyFields.balance]) +
    numberOrZero(birthdayAccrued),
  );
  const spentTotal = roundMoney(
    numberOrZero(contact[loyaltyFields.welcomeBonusUsed]) +
    numberOrZero(contact[loyaltyFields.welcomeBonusExpired]) +
    numberOrZero(birthdayUsed) +
    numberOrZero(birthdayExpired),
  );
  return { accruedTotal, spentTotal };
}

async function readBirthdayBonusAutomationState() {
  try {
    const raw = await fs.promises.readFile(birthdayBonusAutomation.stateFile, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return {};
  }
}

async function writeBirthdayBonusAutomationState(state) {
  await fs.promises.mkdir(path.dirname(birthdayBonusAutomation.stateFile), { recursive: true });
  await fs.promises.writeFile(birthdayBonusAutomation.stateFile, JSON.stringify(state, null, 2), "utf8");
}

async function appendBirthdayBonusAutomationLog(event) {
  await fs.promises.mkdir(path.dirname(birthdayBonusAutomation.logFile), { recursive: true });
  await fs.promises.appendFile(birthdayBonusAutomation.logFile, `${JSON.stringify(event)}\n`, "utf8");
}

async function addBirthdayBonusTimelineLog(event) {
  if (!event.contactId) return;
  await bitrixRequest("/v1/timeline-logs", {
    method: "POST",
    body: JSON.stringify({
      entityTypeId: 3,
      entityId: Number(event.contactId) || event.contactId,
      title: "Начислены бонусы за день рождения",
      text: [
        `Начислено ${formatOrderNumber(event.amount)} бонусных баллов за день рождения.`,
        event.birthdayDate ? `Дата рождения в текущем году: ${formatDateRu(event.birthdayDate)}.` : "",
        event.expiresAt ? `Действуют до ${formatDateRu(event.expiresAt)} включительно.` : "",
        `Источник: ${event.source}.`,
      ].filter(Boolean).join("\n"),
    }),
  });
}

async function addBirthdayBonusExpirationTimelineLog(event) {
  if (!event.contactId) return;
  await bitrixRequest("/v1/timeline-logs", {
    method: "POST",
    body: JSON.stringify({
      entityTypeId: 3,
      entityId: Number(event.contactId) || event.contactId,
      title: "Бонусы ко дню рождения сгорели",
      text: [
        `Сгорело ${formatOrderNumber(event.expiredAmount)} бонусных баллов.`,
        event.expiresAt ? `Срок действия закончился ${formatDateRu(event.expiresAt)}.` : "",
        `Источник: ${event.source}.`,
      ].filter(Boolean).join("\n"),
    }),
  });
}

function birthdayBonusWindow(today) {
  const beforeDays = Math.floor(birthdayBonusAutomation.windowDays / 2);
  const afterDays = birthdayBonusAutomation.windowDays - beforeDays;
  return {
    start: addDateDays(today, -beforeDays),
    end: addDateDays(today, afterDays),
  };
}

function birthdayDateForYear(birthdate, year) {
  const [, month, day] = String(birthdate).split("-").map(Number);
  if (month === 2 && day === 29 && !isLeapYear(year)) return `${year}-02-28`;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function isLeapYear(year) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function yearFromDate(value) {
  const date = dateOnly(value);
  return date ? Number(date.slice(0, 4)) : null;
}

function isDateBetween(date, start, end) {
  return Boolean(date && start && end && date >= start && date <= end);
}

function addDateDays(value, days) {
  const date = new Date(`${dateOnly(value)}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + Number(days || 0));
  return date.toISOString().slice(0, 10);
}

function delay(ms) {
  const timeout = Math.max(Number(ms) || 0, 0);
  if (!timeout) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, timeout));
}

async function loadAccountProfile({ contactId, email, limit = 50, offset = 0, includeOrders = true }) {
  const contact = await findAccountContactByAnyCommunication({ contactId, email });
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

async function findAccountContactByAnyCommunication({ contactId, email }) {
  const search = normalizeSearchQuery(email);
  if (contactId) {
    try {
      const byId = await bitrixRequest(`/v1/contacts/${encodeURIComponent(contactId)}`);
      if (!email) return byId;
      if (search && selectBestContact({ items: [byId] }, search).contact) return byId;
      if (search && await vibeDuplicateHasContactId(search, contactId).catch(() => false)) return byId;

      const byRestId = search ? await getBitrixRestContactById(contactId).catch(() => null) : null;
      if (byRestId && selectBestContact({ items: [byRestId] }, search).contact) return byId;
    } catch (error) {
      if (!email) throw error;
    }
  }

  if (!search) throw new Error("Для личного кабинета нужен email или Bitrix contactId.");
  return (await findBestContactBySearch(search)).contact;
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
  if (!search) throw new Error("Ð”Ð»Ñ Ð»Ð¸Ñ‡Ð½Ð¾Ð³Ð¾ ÐºÐ°Ð±Ð¸Ð½ÐµÑ‚Ð° Ð½ÑƒÐ¶ÐµÐ½ email Ð¸Ð»Ð¸ Bitrix contactId.");
  const raw = await bitrixRequest("/v1/contacts/search", {
    method: "POST",
    body: JSON.stringify(buildContactSearch(search)),
  });
  return selectBestContact(raw, search).contact;
}

async function verifyTildaMemberRequest(req, expectedEmail) {
  const token = clean(req.headers["x-tilda-member-token"]);
  const projectId = clean(req.headers["x-tilda-project-id"]);
  if (!token || !projectId) {
    return { ok: false, status: 401, error: "Сессия Tilda не подтверждена. Войдите в личный кабинет заново." };
  }
  if (tildaMembersProjectId && projectId !== tildaMembersProjectId) {
    return { ok: false, status: 403, error: "Сессия относится к другому проекту Tilda." };
  }

  try {
    const response = await fetch(`${tildaMembersApiBase}/api/getprofile/`, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=UTF-8", Accept: "application/json", Origin: "https://v2sportdress.ru", Referer: "https://v2sportdress.ru/", "User-Agent": clean(req.headers["user-agent"]) },
      body: JSON.stringify({ projectid: projectId, token, tzoffset: 0 }),
      signal: AbortSignal.timeout(12000),
    });
    const result = await response.json().catch(() => null);
    const profile = result?.status === "ok" && result?.data && typeof result.data === "object" ? result.data : null;
    if (!response.ok || !profile) {
      const code = typeof result?.code === "string" ? result.code : "";
      console.warn(`Tilda member verification rejected: HTTP ${response.status}; code=${code.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80)}`);
      if (response.ok && code === "access_denied") {
        return { ok: false, status: 503, error: "Tilda отклонила проверку сессии. Обратитесь в поддержку сайта." };
      }
      if (response.ok && code === "no_token") {
        return { ok: false, status: 401, error: "Сессия Tilda не подтверждена. Войдите в личный кабинет заново." };
      }
      return { ok: false, status: 503, error: "Не удалось подтвердить сессию Tilda. Попробуйте ещё раз." };
    }
    const login = normalizeEmail(profile.login || profile.email);
    if (!expectedEmail || !login || login !== expectedEmail) {
      return { ok: false, status: 403, error: "Email сессии Tilda не совпадает с профилем клиента." };
    }
    return { ok: true, profile };
  } catch (error) {
    console.warn(`Tilda member verification failed: ${error.message}`);
    return { ok: false, status: 503, error: "Не удалось подтвердить сессию Tilda. Попробуйте ещё раз." };
  }
}

function normalizePersonName(value, { optional = false } = {}) {
  const normalized = clean(value).replace(/\s+/g, " ");
  if (!normalized) return optional ? "" : null;
  if (normalized.length > 100 || !/^[\p{L}\p{M}'’ -]+$/u.test(normalized)) return null;
  return normalized;
}

async function recordAccountNameUpdate({ contactId, email, previousFullName, nextFullName }) {
  const event = {
    event: "account_name_update",
    recordedAt: new Date().toISOString(),
    contactId: String(contactId || ""),
    email: normalizeEmail(email),
    previousFullName: clean(previousFullName),
    nextFullName: clean(nextFullName),
  };
  await Promise.allSettled([
    appendBirthdateUpdateLog(event),
    addNameTimelineLog(event),
  ]).then((results) => {
    for (const result of results) {
      if (result.status === "rejected") console.warn("Account name update logging failed:", result.reason?.message || result.reason);
    }
  });
}

async function addNameTimelineLog(event) {
  if (!event.contactId) return;
  const text = [
    `ФИО изменено клиентом в личном кабинете Tilda.`,
    `Было: ${event.previousFullName || "не указано"}.`,
    `Стало: ${event.nextFullName || "не указано"}.`,
    event.email ? `Email входа: ${event.email}.` : "",
  ].filter(Boolean).join("\n");
  await bitrixRequest("/v1/timeline-logs", {
    method: "POST",
    body: JSON.stringify({
      entityTypeId: 3,
      entityId: Number(event.contactId) || event.contactId,
      title: "ФИО из личного кабинета",
      text,
    }),
  });
}

async function recordBirthdateUpdate({ contactId, email, previousBirthdate, birthdate, contact }) {
  const event = {
    event: "account_birthdate_update",
    recordedAt: new Date().toISOString(),
    contactId: String(contactId || ""),
    email: normalizeEmail(email || firstCommunication(contact?.email)),
    previousBirthdate: dateOnly(previousBirthdate) || "",
    birthdate: dateOnly(birthdate) || "",
  };

  await Promise.allSettled([
    appendBirthdateUpdateLog(event),
    addBirthdateTimelineLog(event),
  ]).then((results) => {
    for (const result of results) {
      if (result.status === "rejected") console.warn("Birthdate update logging failed:", result.reason?.message || result.reason);
    }
  });
}

async function appendBirthdateUpdateLog(event) {
  await fs.promises.mkdir(path.dirname(birthdateUpdateLogFile), { recursive: true });
  await fs.promises.appendFile(birthdateUpdateLogFile, `${JSON.stringify(event)}\n`, "utf8");
}

async function addBirthdateTimelineLog(event) {
  if (!event.contactId) return;
  const previous = event.previousBirthdate ? formatDateRu(event.previousBirthdate) : "не было";
  const next = event.birthdate ? formatDateRu(event.birthdate) : "не указано";
  const text = [
    `Дата рождения указана в личном кабинете Tilda: ${next}.`,
    `Предыдущее значение: ${previous}.`,
    event.email ? `Email: ${event.email}.` : "",
  ].filter(Boolean).join("\n");

  await bitrixRequest("/v1/timeline-logs", {
    method: "POST",
    body: JSON.stringify({
      entityTypeId: 3,
      entityId: Number(event.contactId) || event.contactId,
      title: "Дата рождения из личного кабинета",
      text,
    }),
  });
}

function formatDateRu(value) {
  const date = dateOnly(value);
  if (!date) return String(value || "");
  const [year, month, day] = date.split("-");
  return `${day}.${month}.${year}`;
}

async function loadContactDeals(contactId, { limit = 50, offset = 0 } = {}) {
  const raw = await bitrixRequest("/v1/deals/search", {
    method: "POST",
    body: JSON.stringify({
      filter: { contactId: Number(contactId) || contactId },
      select: [
        "id", "title", "amount", "opportunity", "currency", "createdAt", "updatedAt",
        "begindate", "closedAt", "stageId", "stageSemanticId", "categoryId", "closed", "contactId", "ufCrm_V2SD_ORDER_BONUS_ADDED",
        "ufCrm_V2SD_ORDER_BONUS_USED", "ufCrm_V2SD_ORDER_DISCOUNT_PERCENT",
        dealOrderFields.operation, dealOrderFields.paymentStatus, dealOrderFields.track, "ufCrm_V2SD_NOCODB_ORDER_DATE",
        dealOrderFields.orderId, dealOrderFields.tildaOrderId, "comments",
      ],
      sort: { id: "DESC" },
      limit: Math.min(Math.max(Number(limit) || 50, 1), 100),
      offset: Math.max(Number(offset) || 0, 0),
    }),
  });
  const deals = asArray(raw);
  return Promise.all(deals.filter(deal => !isAccountHistoryLead(deal) && shouldShowAccountDeal(deal)).map(mapAccountDeal));
}

function isArchivedAccountDeal(deal) {
  return ["C1:UC_5WTFOJ", "C1:UC_ER41UI"].includes(clean(deal.stageId || deal.STAGE_ID).toUpperCase());
}

function shouldShowAccountDeal(deal) {
  if (!isPaidAccountDeal(deal)) return false;
  if (isArchivedAccountDeal(deal)) return true;
  return new Set([
    "C1:PREPARATION", "C1:EXECUTING", "C1:FINAL_INVOICE",
    "C1:UC_04FYEQ", "C1:UC_79WI97", "C1:WON",
  ]).has(clean(deal.stageId || deal.STAGE_ID).toUpperCase());
}

function isPaidAccountDeal(deal) {
  const status = clean(getDealValue(deal, dealOrderFields.paymentStatus));
  const normalized = status.toLowerCase();
  return normalized === dealOrderValues.paymentStatus.toLowerCase() || normalized === "оплачен";
}

function isCanceledAccountDeal(deal) {
  if (isArchivedAccountDeal(deal)) return false;
  const stageId = clean(deal.stageId || deal.STAGE_ID).toUpperCase();
  const stageName = clean(deal.stageName || deal.STAGE_NAME).toLowerCase();
  const semanticId = clean(deal.stageSemanticId || deal.STAGE_SEMANTIC_ID).toUpperCase();
  return semanticId === "F" ||
    canceledDealStageIds.has(stageId) ||
    stageId.includes("CANCEL") ||
    stageId.includes("LOSE") ||
    stageName.includes("Ð¾Ñ‚Ð¼ÐµÐ½");
}

function accountOrderStatus(deal) {
  if (isArchivedAccountDeal(deal)) return "Выполнен";
  const stageId = clean(deal.stageId || deal.STAGE_ID).toUpperCase();
  if (stageId === "C1:PREPARATION") return "Принят/Собирается";
  if (stageId === "C1:EXECUTING" || stageId === "C1:FINAL_INVOICE") return "На персонализации";
  if (stageId === "C1:UC_04FYEQ") return "Готов к отправке";
  if (stageId === "C1:UC_79WI97") {
    const track = clean(getDealValue(deal, dealOrderFields.track));
    return track ? `В пути (трек-номер: ${track})` : "В пути";
  }
  if (stageId === "C1:WON") return "Доставлен";
  return "";
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
  const operation = clean(getDealValue(deal, dealOrderFields.operation));
  const paymentStatus = clean(getDealValue(deal, dealOrderFields.paymentStatus));
  const canceled = isCanceledAccountDeal(deal);
  const archived = isArchivedAccountDeal(deal);
  const status = accountOrderStatus(deal);
  const orderType = getOrderTypeFromOperation(operation);
  const orderNumber = accountOrderNumber(deal, dealOrderFields);
  const baseComposition = products.length ? products.map(product => product.name).join(", ") :
    (orderNumber ? `Заказ № ${orderNumber}` : (archived ? "" : clean(deal.title || deal.TITLE)));
  return {
    id,
    title: baseComposition,
    entityType: "deal",
    orderNumber,
    ...accountOrderDate(deal),
    archived,
    sum: amount,
    currency: deal.currency || deal.CURRENCY || "RUB",
    stageId: deal.stageId || deal.STAGE_ID || "",
    stageName: deal.stageName || deal.STAGE_NAME || "",
    stageSemanticId: deal.stageSemanticId || deal.STAGE_SEMANTIC_ID || "",
    closed: Boolean(deal.closed || deal.CLOSED === "Y"),
    canceled,
    status,
    paymentStatus,
    track: clean(getDealValue(deal, dealOrderFields.track)),
    operation,
    orderType,
    products,
    composition: baseComposition,
    bonusAdded: numberOrNull(deal.ufCrm_V2SD_ORDER_BONUS_ADDED),
    bonusUsed: numberOrNull(deal.ufCrm_V2SD_ORDER_BONUS_USED),
    discountPercent: numberOrNull(deal.ufCrm_V2SD_ORDER_DISCOUNT_PERCENT),
  };
}

function getDealValue(deal, fieldName) {
  if (!deal || !fieldName) return "";
  return deal[fieldName] ?? deal[fieldName.toUpperCase()] ?? deal[upperFirst(fieldName)] ?? "";
}

function upperFirst(value) {
  return String(value || "").replace(/^([a-z])/, (letter) => letter.toUpperCase());
}

function getOrderTypeFromOperation(operation) {
  const value = clean(operation).toLowerCase();
  if (!value) return "";
  if (value.includes("\u043e\u0444\u043b\u0430\u0439\u043d")) return "\u043e\u0444\u043b\u0430\u0439\u043d";
  if (value.includes("\u043e\u043d\u043b\u0430\u0439\u043d") || value.includes("online")) return "\u043e\u043d\u043b\u0430\u0439\u043d";
  return operation;
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

async function createBitrixOrder(order) {
  const codes = order.certificates.map((certificate) => certificate.code).sort();
  return withCertificateLocks(codes, () => createBitrixOrderWithCertificates(order));
}

async function createBitrixOrderWithCertificates(order) {
  if (!order.certificates.length) return createBitrixOrderCore(order);
  const refreshed = [];
  for (const requested of order.certificates) {
    const certificate = await findCertificate(requested.code, { force: true });
    if (!certificate || String(certificate.id) !== String(requested.id)) {
      throw publicError(409, `Сертификат ${requested.code} не найден. Проверьте код ещё раз.`);
    }
    const amount = roundMoney(requested.amount);
    if (amount <= 0) throw publicError(400, `Укажите сумму списания сертификата ${requested.code}.`);
    if (amount > certificate.balance) throw publicError(409, `На сертификате ${requested.code} доступно только ${formatOrderNumber(certificate.balance)} ₽.`);
    refreshed.push({ ...certificate, amount });
  }
  const maximum = roundMoney(Math.max(0, order.totals.subtotal - order.totals.discountAmount - order.totals.bonusUsed));
  const total = roundMoney(refreshed.reduce((sum, certificate) => sum + certificate.amount, 0));
  if (total > maximum) throw publicError(400, `Общая сумма списания сертификатов не может превышать ${formatOrderNumber(maximum)} ₽.`);

  order.certificates = refreshed;
  order.certificate = refreshed[0] || null;
  order.certificate2 = refreshed[1] || null;
  order.totals.certificateUsed = total;
  order.totals.certificate2Used = refreshed[1]?.amount || 0;
  order.totals.payTotal = roundMoney(maximum - total);
  const result = await createBitrixOrderCore(order);
  for (const certificate of refreshed) await recordCertificateUsage(certificate, certificate.amount, result.deal.id);
  result.certificates = refreshed.map((certificate) => ({
    id: certificate.id,
    code: certificate.code,
    amount: certificate.amount,
    balance: roundMoney(certificate.balance - certificate.amount),
  }));
  result.certificate = result.certificates[0] || null;
  return result;
}

async function createBitrixOrderCore(order) {
  const branch = getPickupBranch(order.branch);
  const isPreorder = order.kind === "preorder";
  const isMessengerOrder = order.kind === "messenger";
  const messengerSourceName = messengerOrderSources[order.sourceId] || "";
  const bonusState = isPreorder ? null : await loadBonusesForOrder(order.contactId);
  if (!isPreorder && order.totals.bonusUsed > 0) {
    const availableBonuses = roundMoney((bonusState.welcome?.available || 0) + (bonusState.birthday?.available || 0));
    if (order.totals.bonusUsed > availableBonuses) {
      throw publicError(409, `Доступно только ${formatOrderNumber(availableBonuses)} бонусов.`);
    }
  }
  const productRows = await buildDealProductRows(order.items, order.totals.discountAmount + order.totals.bonusUsed + (order.totals.certificateUsed || 0));
  const duplicate = await findDuplicateOfflineOrder(order, productRows, branch);
  if (duplicate) {
    const error = new Error(`DUPLICATE_OFFLINE_ORDER:${duplicate.id}`);
    error.status = 409;
    error.publicMessage = `\u0422\u0430\u043a\u043e\u0439 \u0437\u0430\u043a\u0430\u0437 \u0443\u0436\u0435 \u0441\u043e\u0437\u0434\u0430\u043d \u0432 Bitrix24: \u0441\u0434\u0435\u043b\u043a\u0430 #${duplicate.id}.`;
    duplicate.url = buildDealUrl(duplicate.id);
    error.duplicate = duplicate;
    throw error;
  }

  const orderNumberReservation = order.orderNumber ? null : await acquireOfflineOrderNumber();
  const orderNumber = order.orderNumber || orderNumberReservation.orderNumber;
  order.orderNumber = orderNumber;

  try {
    const dealFields = {
      title: order.title || `${isPreorder ? dealOrderValues.preorderTitle : isMessengerOrder ? "Заказ ВК/Макс/ТГ" : dealOrderValues.offlineOrderTitle} \u2116${orderNumber} | ${branch.name}`,
      categoryId: isPreorder ? preorderDealDefaults.categoryId : isMessengerOrder ? messengerOrderDefaults.categoryId : dealDefaults.categoryId,
      stageId: isPreorder ? preorderDealDefaults.stageId : isMessengerOrder
        ? (order.paymentStatus === "paid" ? messengerOrderDefaults.paidStageId : messengerOrderDefaults.unpaidStageId)
        : dealDefaults.stageId,
      assignedById: order.assignedById || undefined,
      contactId: Number(order.contactId) || order.contactId,
      amount: order.totals.payTotal,
      opportunity: order.totals.payTotal,
      currency: order.currency,
      comments: buildOrderComments(order),
      [dealOrderFields.orderId]: orderNumber,
      [dealOrderFields.tildaOrderId]: orderNumber,
      sourceId: isMessengerOrder ? order.sourceId : undefined,
      sourceDescription: isMessengerOrder ? `${messengerSourceName} | ${branch.name}` : undefined,
      [dealOrderFields.operation]: isPreorder ? dealOrderValues.preorderOperation : isMessengerOrder ? "Заказ ВК/Макс/ТГ" : dealOrderValues.operation,
      [dealOrderFields.deliveryCity]: branch.city,
      [dealOrderFields.deliveryAddress]: branch.point,
      [dealOrderFields.deliveryPoint]: branch.name,
      [dealOrderFields.warehouse]: branch.warehouseId,
      [dealOrderFields.paymentStatus]: isPreorder ? undefined : isMessengerOrder
        ? (order.paymentStatus === "paid" ? "Оплачено" : "Не оплачено")
        : dealOrderValues.paymentStatus,
      [dealOrderFields.deliveryMethod]: dealOrderValues.deliveryMethod,
      [dealLoyaltyFields.discountPercent]: order.totals.loyaltyDiscountPercent,
      [dealLoyaltyFields.discountAmount]: `${order.totals.loyaltyDiscountAmount}|${order.currency}`,
      [dealLoyaltyFields.bonusUsed]: order.totals.bonusUsed,
      [dealLoyaltyFields.bonusAdded]: 0,
    };
    if (order.promo?.code) {
      dealFields[dealPromoFields.code] = order.promo.code;
      dealFields[dealPromoFields.discountPercent] = order.promo.discountPercent;
      dealFields[dealPromoFields.discountAmount] = `${order.promo.discountAmount}|${order.currency}`;
    } else if (order.certificate?.code) {
      dealFields[dealPromoFields.code] = order.certificate.code;
      dealFields[dealPromoFields.discountPercent] = 0;
      dealFields[dealPromoFields.discountAmount] = `${order.certificate.amount}|${order.currency}`;
    }
    if (order.certificate2?.code) {
      dealFields[secondaryCertificateDealFields.code] = order.certificate2.code;
      dealFields[secondaryCertificateDealFields.amount] = `${order.certificate2.amount}|${order.currency}`;
    }

    const created = await bitrixRequest("/v1/deals", {
      method: "POST",
      body: JSON.stringify(dealFields),
    });
    const dealId = created?.id || created?.ID || created?.deal?.id || created?.deal?.ID;
    if (!dealId) throw new Error(`Bitrix deal was created without id: ${JSON.stringify(created)}`);
    await orderNumberReservation?.commit();

    if (order.assignedById) {
      await bitrixRequest(`/v1/deals/${encodeURIComponent(dealId)}`, {
        method: "PATCH",
        body: JSON.stringify({ assignedById: order.assignedById }),
      });
    }

    await saveDealProducts(dealId, productRows);
    if (!isPreorder) await finalizeBonusesAfterOrder(order.contactId, bonusState, order.totals.bonusUsed);

    const deal = await bitrixRequest(`/v1/deals/${encodeURIComponent(dealId)}`);
    return {
      ok: true,
      orderNumber,
      deal: mapCreatedDeal(deal, dealId),
      productRows,
    };
  } finally {
    orderNumberReservation?.release();
  }
}

async function loadBonusesForOrder(contactId) {
  const contact = await bitrixRequest(`/v1/contacts/${encodeURIComponent(contactId)}`);
  const mapped = mapContact(contact);
  let ordersCount = mapped?.loyalty?.ordersCount;
  if (ordersCount === null || ordersCount === undefined) {
    ordersCount = await hasAnyPaidDeal(contactId) ? 1 : 0;
  }
  return {
    welcome: buildWelcomeBonusState({
      accrued: contact[loyaltyFields.balance],
      used: contact[loyaltyFields.welcomeBonusUsed],
      expired: contact[loyaltyFields.welcomeBonusExpired],
      registeredAt: contact[loyaltyFields.registeredAt],
      ordersCount,
    }),
    birthday: buildBirthdayBonusState({
      accrued: contact[loyaltyFields.birthdayBonusAccrued],
      used: contact[loyaltyFields.birthdayBonusUsed],
      expired: contact[loyaltyFields.birthdayBonusExpired],
      accruedAt: contact[loyaltyFields.birthdayBonusAccruedAt],
      expiresAt: contact[loyaltyFields.birthdayBonusExpiresAt],
      lastYear: contact[loyaltyFields.birthdayBonusLastYear],
    }),
  };
}

async function hasAnyPaidDeal(contactId) {
  const raw = await bitrixRequest("/v1/deals/search", {
    method: "POST",
    body: JSON.stringify({
      filter: { contactId: Number(contactId) || contactId },
      select: ["id", "stageId", "stageSemanticId", dealOrderFields.paymentStatus],
      sort: { id: "DESC" },
      limit: 1,
    }),
  });
  return asArray(raw).some(shouldShowAccountDeal);
}

async function finalizeBonusesAfterOrder(contactId, bonusState, bonusUsed) {
  const allocation = allocateBonusUsage(bonusState, bonusUsed);
  const fields = {
    [loyaltyFields.syncedAt]: new Date().toISOString(),
  };
  applyWelcomeBonusFinalization(fields, bonusState.welcome, allocation.welcomeUsed);
  applyBirthdayBonusFinalization(fields, bonusState.birthday, allocation.birthdayUsed);
  if (Object.keys(fields).length <= 1) return;
  await bitrixRequest(`/v1/contacts/${encodeURIComponent(contactId)}`, {
    method: "PATCH",
    body: JSON.stringify(fields),
  });
}

function applyWelcomeBonusFinalization(fields, welcomeBonus, welcomeUsed) {
  if (!welcomeBonus.eligible && !welcomeBonus.shouldAccrue && !welcomeBonus.shouldExpire) return;
  const accrued = roundMoney(welcomeBonus.accrued || 300);
  if (welcomeBonus.shouldAccrue) fields[loyaltyFields.balance] = 300;
  if (welcomeBonus.eligible && roundMoney(welcomeUsed) > 0) {
    fields[loyaltyFields.welcomeBonusUsed] = roundMoney(welcomeUsed);
  } else {
    fields[loyaltyFields.welcomeBonusExpired] = accrued || 300;
  }
}

function applyBirthdayBonusFinalization(fields, birthdayBonus, birthdayUsed) {
  if (!birthdayBonus.eligible && !birthdayBonus.shouldExpire) return;
  const used = roundMoney(birthdayUsed);
  if (birthdayBonus.eligible && used > 0) {
    fields[loyaltyFields.birthdayBonusUsed] = roundMoney(birthdayBonus.used + used);
  }
  const remainingAfterUse = roundMoney(birthdayBonus.available - used);
  if (birthdayBonus.shouldExpire && remainingAfterUse > 0) {
    fields[loyaltyFields.birthdayBonusExpired] = roundMoney(birthdayBonus.expired + remainingAfterUse);
  }
}

function allocateBonusUsage({ welcome, birthday }, bonusUsed) {
  const used = roundMoney(Math.max(0, bonusUsed));
  const welcomeAvailable = roundMoney(welcome?.available || 0);
  const birthdayAvailable = roundMoney(birthday?.available || 0);
  if (!used) return { welcomeUsed: 0, birthdayUsed: 0 };

  if (used >= roundMoney(welcomeAvailable + birthdayAvailable)) {
    return { welcomeUsed: welcomeAvailable, birthdayUsed: birthdayAvailable };
  }

  if (birthdayAvailable > 0 && used <= birthdayAvailable && (used === birthdayAvailable || welcomeAvailable <= 0)) {
    return { welcomeUsed: 0, birthdayUsed: used };
  }

  const welcomeUsed = Math.min(used, welcomeAvailable);
  return {
    welcomeUsed,
    birthdayUsed: Math.min(roundMoney(used - welcomeUsed), birthdayAvailable),
  };
}

async function findDuplicateOfflineOrder(order, productRows, branch) {
  if (!offlineDuplicateCheck.enabled || !order.contactId) return null;

  const isPreorder = order.kind === "preorder";
  const isMessengerOrder = order.kind === "messenger";
  const limit = Math.min(Math.max(Number(offlineDuplicateCheck.limit) || 30, 1), 100);
  const filter = {
    contactId: Number(order.contactId) || order.contactId,
    categoryId: isPreorder
      ? preorderDealDefaults.categoryId
      : isMessengerOrder ? messengerOrderDefaults.categoryId : (offlineDuplicateCheck.categoryId || dealDefaults.categoryId),
  };
  if (isPreorder) filter.stageId = preorderDealDefaults.stageId;
  else if (isMessengerOrder) filter.stageId = order.paymentStatus === "paid" ? messengerOrderDefaults.paidStageId : messengerOrderDefaults.unpaidStageId;
  else if (offlineDuplicateCheck.stageId) filter.stageId = offlineDuplicateCheck.stageId;

  const raw = await bitrixRequest("/v1/deals/search", {
    method: "POST",
    body: JSON.stringify({
      filter,
      select: [
        "id", "title", "amount", "opportunity", "currency", "stageId", 
        "stageSemanticId", "categoryId", "contactId",
        dealOrderFields.operation, dealOrderFields.deliveryPoint, dealOrderFields.warehouse,
      ],
      sort: { id: "DESC" },
      limit,
    }),
  });

  const targetSignature = buildProductRowsSignature(productRows);
  const targetAmount = roundMoney(order.totals.payTotal);
  const branchName = normalizeText(branch?.name);
  const warehouseId = String(branch?.warehouseId || "");

  for (const deal of asArray(raw)) {
    if (!isDuplicateCheckStage(deal, isPreorder)) continue;
    if (!isMatchingOrderKindDeal(deal, isPreorder)) continue;
    if (!isSameDuplicateBranch(deal, branchName, warehouseId)) continue;
    if (roundMoney(deal.amount ?? deal.opportunity ?? deal.OPPORTUNITY) !== targetAmount) continue;

    const dealId = deal.id || deal.ID;
    if (!dealId) continue;
    let existingRows = [];
    try {
      existingRows = asArray(await bitrixRequest(`/v1/deals/${encodeURIComponent(dealId)}/products`));
    } catch (error) {
      console.warn(`Duplicate check products load failed for ${dealId}: ${error.message}`);
      continue;
    }

    if (buildProductRowsSignature(existingRows) === targetSignature) {
      return {
        id: dealId,
        url: buildDealUrl(dealId),
        title: deal.title || deal.TITLE || "",
        amount: targetAmount,
        stageId: deal.stageId || deal.STAGE_ID || "",
        stageName: deal.stageName || deal.STAGE_NAME || "",
      };
    }
  }

  return null;
}

function isDuplicateCheckStage(deal, isPreorder = false) {
  if (isPreorder) {
    return normalizeStageId(deal.stageId || deal.STAGE_ID) === normalizeStageId(preorderDealDefaults.stageId);
  }
  if (offlineDuplicateCheck.stageId) {
    return normalizeStageId(deal.stageId || deal.STAGE_ID) === normalizeStageId(offlineDuplicateCheck.stageId);
  }
  const stageName = normalizeText(deal.stageName || deal.STAGE_NAME);
  const semanticId = clean(deal.stageSemanticId || deal.STAGE_SEMANTIC_ID).toUpperCase();
  return stageName.includes("\u0432\u0440\u0443\u0447\u0435\u043d") || semanticId === "S";
}

function isOfflineOrderDeal(deal) {
  return isMatchingOrderKindDeal(deal, false);
}

function isMatchingOrderKindDeal(deal, isPreorder = false) {
  const operation = normalizeText(getDealValue(deal, dealOrderFields.operation));
  if (isPreorder) return operation.includes("\u043f\u0440\u0435\u0434\u0437\u0430\u043a\u0430\u0437");
  return !operation || operation.includes("\u043e\u0444\u043b\u0430\u0439\u043d");
}

function isSameDuplicateBranch(deal, branchName, warehouseId) {
  const dealWarehouseId = String(getDealValue(deal, dealOrderFields.warehouse) || "");
  if (warehouseId && dealWarehouseId && dealWarehouseId === warehouseId) return true;
  const dealBranch = normalizeText(getDealValue(deal, dealOrderFields.deliveryPoint));
  return !branchName || !dealBranch || dealBranch === branchName;
}

function buildProductRowsSignature(rows) {
  return asArray(rows)
    .map(normalizeProductRowForDuplicate)
    .filter(Boolean)
    .sort()
    .join("|");
}

function normalizeProductRowForDuplicate(row) {
  const name = normalizeText(row.productName || row.PRODUCT_NAME || row.name || row.NAME);
  const productId = clean(row.productId || row.PRODUCT_ID);
  const quantity = roundMoney(row.quantity || row.QUANTITY || 1);
  const price = roundMoney(row.price || row.PRICE || 0);
  const discount = roundMoney(row.discount || row.DISCOUNT || 0);
  if (!name && !productId) return "";
  return [
    productId || name,
    name,
    quantity.toFixed(3),
    price.toFixed(2),
    discount.toFixed(2),
  ].join("~");
}

function normalizeText(value) {
  return clean(value).toLowerCase().replace(/\s+/g, " ").trim();
}

async function saveDealProducts(dealId, productRows) {
  try {
    await bitrixRequest(`/v1/deals/${encodeURIComponent(dealId)}/products`, {
      method: "PUT",
      body: JSON.stringify({ items: productRows }),
    });
  } catch (error) {
    const catalogRows = productRows.filter((row) => row.productId);
    if (!catalogRows.length || catalogRows.length === productRows.length) throw error;
    console.warn(`Deal products with custom rows failed for ${dealId}: ${error.message}`);
    await bitrixRequest(`/v1/deals/${encodeURIComponent(dealId)}/products`, {
      method: "PUT",
      body: JSON.stringify({ items: catalogRows }),
    });
  }
}

function buildOrderComments(order) {
  const lines = [
    `\u041d\u043e\u043c\u0435\u0440 \u0437\u0430\u043a\u0430\u0437\u0430: ${order.orderNumber}`,
    "\u0421\u043e\u0441\u0442\u0430\u0432 \u0437\u0430\u043a\u0430\u0437\u0430:",
    ...order.items.map((item, index) => (
      `${index + 1}. ${item.name} - ${formatOrderNumber(item.quantity)} \u0448\u0442. x ${formatOrderNumber(item.price)} ${order.currency}`
    )),
    "",
    `\u0422\u043e\u0432\u0430\u0440\u044b: ${formatOrderNumber(order.totals.subtotal)} ${order.currency}`,
    `\u0421\u043a\u0438\u0434\u043a\u0430: ${formatOrderNumber(order.totals.discountAmount)} ${order.currency}`,
    `\u0411\u043e\u043d\u0443\u0441\u044b: ${formatOrderNumber(order.totals.bonusUsed)} ${order.currency}`,
    `\u041a \u043e\u043f\u043b\u0430\u0442\u0435: ${formatOrderNumber(order.totals.payTotal)} ${order.currency}`,
  ];
  if (order.kind === "messenger") {
    lines.splice(1, 0, `Источник: ${messengerOrderSources[order.sourceId] || order.sourceId}`);
    lines.splice(2, 0, `Статус оплаты: ${order.paymentStatus === "paid" ? "Оплачен" : "Не оплачен"}`);
  }
  if (order.promo?.code) lines.splice(-4, 0, `\u041f\u0440\u043e\u043c\u043e\u043a\u043e\u0434: ${order.promo.code}`);
  order.certificates.forEach((certificate, index) => {
    lines.splice(-4, 0, `Сертификат${index ? ` ${index + 1}` : ""}: ${certificate.code}, списано ${formatOrderNumber(certificate.amount)} ${order.currency}`);
  });
  return lines.join("\n");
}

export async function buildDealProductRows(items, orderDiscount = 0) {
  const rows = [];
  for (const item of items) {
    const product = await resolveCatalogProduct(item);
    const row = {
      productName: item.name,
      price: item.price,
      quantity: item.quantity,
      taxRate: 0,
      taxIncluded: "N",
    };
    if (product?.id) row.productId = Number(product.id);
    rows.push(row);
  }
  applyOrderDiscountToProductRows(rows, orderDiscount);
  return rows;
}

async function resolveCatalogProductId(item) {
  const product = await resolveCatalogProduct(item);
  return product?.id ? Number(product.id) : null;
}

async function resolveCatalogProduct(item) {
  const candidates = [item.productId, item.xmlId].map(clean).filter(Boolean);
  for (const candidate of candidates) {
    try {
      const raw = await bitrixRequest("/v1/products/search", {
        method: "POST",
        body: JSON.stringify({
          filter: { xmlId: candidate },
          select: ["id", "name", "xmlId", "active"],
          sort: { id: "DESC" },
          limit: 10,
        }),
      });
      const match = asArray(raw).find((product) => clean(product.xmlId || product.XML_ID) === candidate) || asArray(raw)[0];
      const id = match?.id || match?.ID;
      if (id) return { id: Number(id), xmlId: clean(match.xmlId || match.XML_ID), name: clean(match.name || match.NAME) };
    } catch (error) {
      console.warn(`Catalog product lookup failed for ${candidate}: ${error.message}`);
    }
  }
  return null;
}

export function applyOrderDiscountToProductRows(rows, orderDiscount) {
  let remaining = roundMoney(orderDiscount);
  if (remaining <= 0 || !rows.length) return;

  const sorted = rows
    .map((row, index) => ({
      row,
      index,
      quantity: Math.max(1, Number(row.quantity || 1)),
      unitPrice: roundMoney(row.price),
      capacity: roundMoney(Number(row.price || 0) * Number(row.quantity || 1)),
    }))
    .filter((entry) => entry.capacity > 0)
    .sort((left, right) => right.capacity - left.capacity || left.index - right.index);

  for (const entry of sorted) {
    if (remaining <= 0) break;
    const applied = roundMoney(Math.min(remaining, entry.capacity));
    const unitDiscount = roundMoney(applied / entry.quantity);
    entry.row.price = roundMoney(Math.max(0, entry.unitPrice - unitDiscount));
    entry.row.discount = unitDiscount;
    entry.row.discountTypeId = 1;
    remaining = roundMoney(remaining - roundMoney(unitDiscount * entry.quantity));
  }
}

function mapCreatedDeal(deal, fallbackId) {
  const id = deal?.id || deal?.ID || fallbackId;
  return {
    id,
    url: buildDealUrl(id),
    title: deal?.title || deal?.TITLE || "",
    amount: numberOrZero(deal?.amount ?? deal?.opportunity ?? deal?.OPPORTUNITY),
    currency: deal?.currency || deal?.CURRENCY || "RUB",
  };
}

function mapManagerContact(contact) {
  const mapped = mapContact(contact);
  if (!mapped) return null;
  return {
    ...mapped,
    url: buildContactUrl(mapped.id),
  };
}

function buildContactUrl(id) {
  return id ? `${bitrixPortalUrl}/crm/contact/details/${encodeURIComponent(id)}/` : "";
}

function buildDealUrl(id) {
  return id ? `${bitrixPortalUrl}/crm/deal/details/${encodeURIComponent(id)}/` : "";
}

function buildSmartItemUrl(entityTypeId, id) {
  return entityTypeId && id ? `${bitrixPortalUrl}/crm/type/${encodeURIComponent(entityTypeId)}/details/${encodeURIComponent(id)}/` : "";
}

function getPickupBranch(branchCode) {
  return safePickupBranches[clean(branchCode).toLowerCase()] || safePickupBranches.sokol;
}

function normalizeOrderPayload(payload = {}) {
  const currency = normalizeCurrency(payload.currency);
  const items = asArray(payload.items)
    .map((item) => {
      const quantity = Math.max(1, numberOrZero(item.quantity || item.count || 1));
      const price = Math.max(0, numberOrZero(item.price));
      const name = clean(item.name || item.productName || item.title);
      return {
        productId: clean(item.productId),
        xmlId: clean(item.xmlId || item.externalId),
        source: clean(item.source),
        preorder: Boolean(item.preorder),
        name,
        quantity,
        price,
        sum: roundMoney(quantity * price),
      };
    })
    .filter((item) => item.name && item.quantity > 0);

  const subtotal = roundMoney(items.reduce((sum, item) => sum + item.sum, 0));
  const requestedKind = clean(payload.kind || payload.orderKind || payload.type).toLowerCase();
  const kind = requestedKind === "preorder" ? "preorder" : requestedKind === "messenger" ? "messenger" : "order";
  const sourceId = kind === "messenger" ? clean(payload.sourceId) : "";
  if (kind === "messenger" && !Object.hasOwn(messengerOrderSources, sourceId)) throw publicError(400, "Выберите источник заказа из списка Bitrix24.");
  const paymentStatus = kind === "messenger" && clean(payload.paymentStatus).toLowerCase() === "paid" ? "paid" : "unpaid";
  const promo = normalizeOrderPromo(payload.promo || payload.promocode || payload.promoCode, subtotal);
  const certificates = [payload.certificate, payload.certificate2, ...asArray(payload.certificates)]
    .map(normalizeOrderCertificate)
    .filter(Boolean);
  const uniqueCertificates = new Set(certificates.map((certificate) => normalizePromoCode(certificate.code)));
  if (uniqueCertificates.size !== certificates.length) {
    throw publicError(400, "Один сертификат нельзя использовать дважды в одном заказе.");
  }
  if (certificates.length > 2) throw publicError(400, "В одном заказе можно использовать не более двух сертификатов.");
  const certificate = certificates[0] || null;
  const certificate2 = certificates[1] || null;
  const rawLoyaltyDiscountPercent = clampPercent(
    payload.loyaltyDiscountPercent ?? payload.totals?.loyaltyDiscountPercent ?? payload.loyaltyPercent,
  );
  const rawPromoDiscountPercent = clampPercent(
    payload.promoDiscountPercent ?? payload.totals?.promoDiscountPercent ?? promo?.discountPercent,
  );
  const { loyaltyDiscountPercent, promoDiscountPercent, discountPercent } = chooseBestDiscountPercents(
    rawLoyaltyDiscountPercent,
    rawPromoDiscountPercent,
  );
  const loyaltyDiscountAmount = roundMoney(
    subtotal * loyaltyDiscountPercent / 100,
  );
  const promoDiscountAmount = roundMoney(
    subtotal * promoDiscountPercent / 100,
  );
  if (promo) {
    promo.discountPercent = promoDiscountPercent;
    promo.discountAmount = promoDiscountAmount;
  }
  const discountAmount = roundMoney(loyaltyDiscountAmount + promoDiscountAmount);
  const bonusUsed = roundMoney(Math.max(0, numberOrZero(payload.bonusUsed ?? payload.totals?.bonusUsed)));
  if (bonusUsed > 0 && ![300, 500, 800].includes(bonusUsed)) {
    throw publicError(400, "Можно использовать только 300, 500 или 800 бонусов.");
  }
  const certificateUsed = roundMoney(certificates.reduce((sum, item) => sum + Math.max(0, item.amount || 0), 0));
  const payTotal = roundMoney(Math.max(0, subtotal - discountAmount - bonusUsed - certificateUsed));

  return {
    kind,
    sourceId,
    paymentStatus,
    contactId: clean(payload.contactId),
    title: clean(payload.title),
    branch: clean(payload.branch || payload.pickupBranch),
    assignedById: Number(payload.assignedById || payload.responsibleId || 0) || null,
    currency,
    items,
    promo,
    certificate,
    certificate2,
    certificates,
    totals: {
      subtotal,
      discountPercent,
      discountAmount,
      loyaltyDiscountPercent,
      loyaltyDiscountAmount,
      promoDiscountPercent,
      promoDiscountAmount,
      bonusUsed,
      certificateUsed,
      certificate2Used: roundMoney(certificate2?.amount || 0),
      payTotal,
    },
  };
}

function clampPercent(value) {
  return Math.min(100, Math.max(0, numberOrZero(value)));
}

export function chooseBestDiscountPercents(loyaltyPercent, promoPercent) {
  const loyalty = clampPercent(loyaltyPercent);
  const promo = clampPercent(promoPercent);
  return {
    loyaltyDiscountPercent: loyalty >= promo ? loyalty : 0,
    promoDiscountPercent: promo > loyalty ? promo : 0,
    discountPercent: Math.max(loyalty, promo),
  };
}

function roundMoney(value) {
  const number = Number(value) || 0;
  return Math.round(number * 100) / 100;
}

function formatOrderNumber(value) {
  return roundMoney(value).toLocaleString("ru-RU");
}

function normalizeOrderPromo(value, subtotal = 0) {
  if (!value) return null;
  const source = typeof value === "string" ? { code: value } : value;
  const code = clean(source.code || source.promocode || source.promoCode);
  if (!code) return null;
  const discountPercent = clampPercent(source.discountPercent || source.percent);
  const discountAmount = roundMoney(source.discountAmount ?? subtotal * discountPercent / 100);
  return {
    code,
    discountPercent,
    discountAmount,
    partnerId: source.partnerId || source.id || null,
    partnerName: clean(source.partnerName || source.title),
  };
}

function normalizeOrderCertificate(value) {
  if (!value) return null;
  const code = clean(value.code);
  const id = clean(value.id);
  if (!code || !id) return null;
  return { id, code, amount: roundMoney(Math.max(0, numberOrZero(value.amount))) };
}

async function findCertificate(code) {
  const normalized = normalizePromoCode(code);
  if (!normalized) return null;
  const raw = await bitrixRequest(`/v1/items/${certificates.entityTypeId}?limit=500`);
  const item = asArray(raw).find((candidate) => normalizePromoCode(candidate[certificates.codeField]) === normalized);
  return item ? mapCertificate(item) : null;
}

function mapCertificate(item) {
  const nominal = moneyValue(item[certificates.nominalField]);
  const usedAmount = moneyValue(item[certificates.usedAmountField]);
  const id = item.id || item.ID;
  const orders = asArray(item[certificates.ordersField]).map(clean).filter(Boolean);
  return {
    id,
    title: clean(item.title || item.TITLE),
    code: clean(item[certificates.codeField]),
    nominal,
    usedAmount,
    balance: roundMoney(Math.max(0, nominal - usedAmount)),
    usedDates: asArray(item[certificates.usedDatesField]).map(clean).filter(Boolean),
    orders,
    url: `${bitrixPortalUrl}/crm/type/${certificates.entityTypeId}/details/${id}/`,
    orderLinks: orders.map((value) => {
      const dealId = String(value).replace(/^D_/, "");
      return { id: dealId, url: buildDealUrl(dealId) };
    }),
  };
}

function moneyValue(value) {
  return roundMoney(numberOrZero(String(value ?? "").split("|")[0]));
}

async function recordCertificateUsage(certificate, amount, dealId) {
  const usedAmount = roundMoney(certificate.usedAmount + amount);
  const balance = roundMoney(Math.max(0, certificate.nominal - usedAmount));
  const orderRef = `D_${dealId}`;
  const usedDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Moscow" }).format(new Date());
  await bitrixRequest(`/v1/items/${certificates.entityTypeId}/${encodeURIComponent(certificate.id)}`, {
    method: "PATCH",
    body: JSON.stringify({
      [certificates.usedAmountField]: `${usedAmount}|RUB`,
      [certificates.balanceField]: `${balance}|RUB`,
      [certificates.usedDatesField]: [...new Set([...certificate.usedDates, usedDate])],
      [certificates.ordersField]: [...new Set([...certificate.orders, orderRef])],
    }),
  });
}

async function withCertificateLocks(codes, work, index = 0) {
  if (index >= codes.length) return work();
  return withCertificateLock(codes[index], () => withCertificateLocks(codes, work, index + 1));
}

async function withCertificateLock(code, work) {
  const key = normalizePromoCode(code);
  const previous = certificateLocks.get(key) || Promise.resolve();
  let release;
  const current = new Promise((resolve) => { release = resolve; });
  const queued = previous.then(() => current);
  certificateLocks.set(key, queued);
  await previous;
  try { return await work(); }
  finally {
    release();
    if (certificateLocks.get(key) === queued) certificateLocks.delete(key);
  }
}

function publicError(status, message) {
  const error = new Error(message);
  error.status = status;
  error.publicMessage = message;
  return error;
}

async function findPartnerPromo(code) {
  return findPartnerPromoWithOptions(code);
}

async function findPartnerPromoWithOptions(code, { force = false } = {}) {
  const normalized = normalizePromoCode(code);
  if (!normalized) return null;
  const promos = await loadPartnerPromos(force);
  return promos.find((promo) => normalizePromoCode(promo.code) === normalized) || null;
}

async function loadPartnerPromos(force = false) {
  if (!force && promoCache && Date.now() < promoCacheExpiresAt) return promoCache;
  const raw = await bitrixRequest(`/v1/items/${partnerPromo.entityTypeId}?limit=500`);
  promoCache = asArray(raw)
    .map(mapPartnerPromo)
    .filter((promo) => promo.code && promo.discountPercent > 0 && !promo.status.toLowerCase().includes("Ð¿Ñ€ÐµÐºÑ€Ð°Ñ‰"));
  promoCache = promoCache.filter(isActivePartnerPromo);
  promoCacheExpiresAt = Date.now() + 5 * 60 * 1000;
  return promoCache;
}

function mapPartnerPromo(item) {
  return {
    id: item.id || item.ID,
    partnerName: clean(item.title || item.TITLE),
    contactId: Number(item.contactId || item.CONTACT_ID || 0) || null,
    code: clean(item[partnerPromo.codeField]),
    discountPercent: clampPercent(item[partnerPromo.discountField]),
    rewardPercent: clampPercent(item[partnerPromo.rewardPercentField]),
    partnershipTypeId: clean(item[partnerPromo.partnershipTypeField]),
    status: clean(item[partnerPromo.statusField]),
    stageId: clean(item.stageId || item.STAGE_ID),
  };
}

function isActivePartnerPromo(promo) {
  const status = promo.status.toLowerCase();
  const stage = promo.stageId.toUpperCase();
  if (status.includes("\u043d\u0435\u0430\u043a\u0442\u0438\u0432")) return false;
  if (status.includes("\u043f\u0440\u0435\u043a\u0440\u0430\u0449")) return false;
  if (stage.includes("INACTIVE") || stage.includes("FAIL") || stage.includes("LOSE")) return false;
  return true;
}

async function createOfflinePartnerPayout(payload = {}) {
  const code = normalizePromoCode(payload.code || payload.promocode || payload.promoCode);
  const orderAmount = roundMoney(payload.orderAmount ?? payload.amount ?? payload.sum);
  const comment = typeof payload.comment === "string" ? payload.comment.trim() : "";
  const branchCode = clean(payload.branch).toLowerCase();
  const assignedById = Number(payload.assignedById || 0);
  if (!code) throw publicHttpError(400, "\u0412\u0432\u0435\u0434\u0438\u0442\u0435 \u043f\u0440\u043e\u043c\u043e\u043a\u043e\u0434.");
  if (!(orderAmount > 0)) throw publicHttpError(400, "\u0423\u043a\u0430\u0436\u0438\u0442\u0435 \u0441\u0443\u043c\u043c\u0443 \u0437\u0430\u043a\u0430\u0437\u0430.");
  if (comment.length > 4000) throw publicHttpError(400, "Комментарий не должен превышать 4000 символов.");
  if (!Object.hasOwn(safePickupBranches, branchCode)) throw publicHttpError(400, "Выберите филиал: Сокол или Белка.");
  if (!Number.isSafeInteger(assignedById) || assignedById <= 0) throw publicHttpError(400, "Выберите ответственного сотрудника.");
  const branchEmployees = await loadBranchEmployees(branchCode);
  if (!branchEmployees.some((employee) => employee.id === assignedById)) {
    throw publicHttpError(400, "Ответственный сотрудник не относится к выбранному филиалу.");
  }

  const promo = await findPartnerPromoWithOptions(code, { force: true });
  if (!promo) {
    throw publicHttpError(404, "\u0422\u0430\u043a\u043e\u0439 \u043f\u0440\u043e\u043c\u043e\u043a\u043e\u0434 \u043d\u0435 \u043d\u0430\u0439\u0434\u0435\u043d \u0432 Bitrix24.");
  }

  const rewardPercent = clampPercent(promo.rewardPercent);
  const rewardAmount = roundMoney(orderAmount * rewardPercent / 100);
  const partnershipTypeId = mapPartnerPayoutPartnershipType(promo.partnershipTypeId);
  const duplicate = await findRecentDuplicatePartnerPayout({ promo, code, orderAmount });
  if (duplicate) {
    const error = publicHttpError(
      409,
      `\u0422\u0430\u043a\u0430\u044f \u0432\u044b\u043f\u043b\u0430\u0442\u0430 \u0443\u0436\u0435 \u0441\u043e\u0437\u0434\u0430\u043d\u0430 \u0432 Bitrix24: \u043a\u0430\u0440\u0442\u043e\u0447\u043a\u0430 #${duplicate.id}.`,
    );
    duplicate.url = buildSmartItemUrl(partnerPayoutAutomation.entityTypeId, duplicate.id);
    error.duplicate = duplicate;
    throw error;
  }
  const fields = {
    title: `\u0412\u044b\u043f\u043b\u0430\u0442\u0430 \u043f\u0430\u0440\u0442\u043d\u0435\u0440\u0443: ${promo.partnerName || promo.code}`,
    categoryId: Number(process.env.BITRIX_PARTNER_PAYOUT_CATEGORY_ID || 17),
    stageId: partnerPayoutAutomation.newStageId,
    opportunity: rewardAmount,
    isManualOpportunity: true,
    currencyId: "RUB",
    assignedById,
    sourceDescription: "\u0417\u0430\u043a\u0430\u0437 \u043f\u043e \u043e\u0444\u043b\u0430\u0439\u043d \u0444\u043e\u0440\u043c\u0435 \u0431\u0435\u0437 \u0440\u0435\u0433\u0438\u0441\u0442\u0440\u0430\u0446\u0438\u0438.",
    [partnerPayoutFields.orderAmount]: `${orderAmount}|RUB`,
    [partnerPayoutFields.rewardPercent]: rewardPercent,
    [partnerPayoutFields.code]: promo.code,
    [partnerPayoutFields.paid]: "N",
    [partnerPayoutFields.partnerParent]: Number(promo.id),
    [partnerPayoutFields.comment]: "\u0417\u0430\u043a\u0430\u0437 \u0447\u0435\u0440\u0435\u0437 \u0444\u043e\u0440\u043c\u0443 \u0431\u0435\u0437 \u0440\u0435\u0433\u0438\u0441\u0442\u0440\u0430\u0446\u0438\u0438.",
    [partnerPayoutFields.branch]: safePickupBranches[branchCode].name,
  };
  if (promo.contactId) fields.contactId = promo.contactId;
  if (partnershipTypeId) fields[partnerPayoutFields.partnershipType] = partnershipTypeId;

  const created = await bitrixRequest(`/v1/items/${partnerPayoutAutomation.entityTypeId}`, {
    method: "POST",
    body: JSON.stringify(fields),
  });
  const item = created?.item || created;
  const payoutId = item?.id || item?.ID || created?.id || created?.ID;
  if (!payoutId) {
    throw publicHttpError(502, "\u0412\u044b\u043f\u043b\u0430\u0442\u0430 \u0431\u044b\u043b\u0430 \u043e\u0442\u043f\u0440\u0430\u0432\u043b\u0435\u043d\u0430 \u0432 Bitrix24, \u043d\u043e ID \u043a\u0430\u0440\u0442\u043e\u0447\u043a\u0438 \u043d\u0435 \u0432\u0435\u0440\u043d\u0443\u043b\u0441\u044f.");
  }
  await bitrixRequest(`/v1/items/${partnerPayoutAutomation.entityTypeId}/${encodeURIComponent(payoutId)}`, {
    method: "PATCH",
    body: JSON.stringify({ assignedById, [partnerPayoutFields.branch]: safePickupBranches[branchCode].name }),
  });
  if (partnershipTypeId) {
    await bitrixRequest(`/v1/items/${partnerPayoutAutomation.entityTypeId}/${encodeURIComponent(payoutId)}`, {
      method: "PATCH",
      body: JSON.stringify({ [partnerPayoutFields.partnershipType]: partnershipTypeId }),
    });
  }

  let commentWarning = "";
  if (comment) {
    try {
      await bitrixRequest("/v1/timelines", {
        method: "POST",
        body: JSON.stringify({
          entityType: `DYNAMIC_${partnerPayoutAutomation.entityTypeId}`,
          entityId: Number(payoutId),
          comment,
        }),
      });
    } catch (error) {
      console.warn(`Partner payout #${payoutId} created, but timeline comment failed:`, error);
      commentWarning = "откройте карточку и добавьте текст вручную.";
    }
  }

  return {
    ok: true,
    commentWarning,
    partner: {
      id: promo.id,
      name: promo.partnerName,
      contactId: promo.contactId,
      code: promo.code,
    },
    payout: {
      id: payoutId,
      url: buildSmartItemUrl(partnerPayoutAutomation.entityTypeId, payoutId),
      orderAmount,
      rewardPercent,
      rewardAmount,
      partnershipTypeId,
    },
  };
}

async function findRecentDuplicatePartnerPayout({ promo, code, orderAmount }) {
  const windowMs = Math.max(Number(partnerPayoutDuplicateCheck.windowMs) || 0, 0);
  if (!windowMs) return null;
  const limit = Math.min(Math.max(Number(partnerPayoutDuplicateCheck.limit) || 100, 1), 200);
  const raw = await bitrixRequest(`/v1/items/${partnerPayoutAutomation.entityTypeId}?limit=${limit}`);
  const cutoff = Date.now() - windowMs;
  const normalizedCode = normalizePromoCode(code || promo.code);
  const partnerId = Number(promo.id) || 0;
  const contactId = Number(promo.contactId) || 0;

  return asArray(raw)
    .map(mapPartnerPayoutDuplicateCandidate)
    .find((item) => (
      item.id &&
      item.createdAt >= cutoff &&
      normalizePromoCode(item.code) === normalizedCode &&
      roundMoney(item.orderAmount) === roundMoney(orderAmount) &&
      (
        (partnerId && Number(item.partnerParentId) === partnerId) ||
        (contactId && Number(item.contactId) === contactId)
      )
    )) || null;
}

function mapPartnerPayoutDuplicateCandidate(item) {
  return {
    id: item.id || item.ID,
    url: buildSmartItemUrl(partnerPayoutAutomation.entityTypeId, item.id || item.ID),
    title: clean(item.title || item.TITLE),
    contactId: Number(item.contactId || item.CONTACT_ID || 0) || null,
    partnerParentId: Number(item[partnerPayoutFields.partnerParent] || 0) || null,
    code: clean(item[partnerPayoutFields.code]),
    orderAmount: parseMoneyAmount(item[partnerPayoutFields.orderAmount]),
    createdAt: Date.parse(item.createdTime || item.CREATED_TIME || item.dateCreate || item.DATE_CREATE || "") || 0,
  };
}

function parseMoneyAmount(value) {
  const source = String(value ?? "").split("|")[0];
  return numberOrZero(source);
}

function mapPartnerPayoutPartnershipType(sourceTypeId) {
  const key = String(sourceTypeId || "").trim();
  const targetId = partnerPayoutPartnershipTypes[key] || null;
  return targetId ? String(targetId) : null;
}

function publicHttpError(status, publicMessage) {
  const error = new Error(publicMessage);
  error.status = status;
  error.publicMessage = publicMessage;
  return error;
}

function normalizePromoCode(value) {
  return clean(value).replace(/\s+/g, "").toUpperCase();
}

async function loadBranchEmployees(branchCode) {
  const branch = getPickupBranch(branchCode);
  const departmentId = branchDepartmentIds[branch.code];
  if (!departmentId) return [];

  const raw = await bitrixRequest("/v1/users/search", {
    method: "POST",
    body: JSON.stringify({
      filter: { departmentId, active: true },
      sort: { id: "ASC" },
      limit: 100,
    }),
  });

  return asArray(raw)
    .map(mapEmployee)
    .filter((employee) => employee.id)
    .sort((left, right) => left.name.localeCompare(right.name, "ru"));
}

function mapEmployee(user) {
  const firstName = clean(user.name || user.NAME);
  const lastName = clean(user.lastName || user.LAST_NAME);
  const secondName = clean(user.secondName || user.SECOND_NAME);
  const email = clean(user.email || user.EMAIL);
  const name = [lastName, firstName, secondName].filter(Boolean).join(" ") || email || `User #${user.id || user.ID}`;
  return {
    id: Number(user.id || user.ID),
    name,
    email,
  };
}

function buildAccountPromo(contact) {
  const discountPercent = numberOrZero(contact?.loyalty?.discountPercent);
  if (!discountPercent) return null;
  return {
    code: `V2SD${contact.id}`,
    discountPercent,
    text: `Ð’Ð°ÑˆÐ° ÑÐºÐ¸Ð´ÐºÐ° ${discountPercent}%`,
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
    const result = await findBestContactBySearch(search);
    if (result.contact) matches.push(result.contact);
  }

  return matches
    .sort((a, b) => Number(b.id || b.ID || 0) - Number(a.id || a.ID || 0))[0] || null;
}

function buildRegistrationCreateFields(registration) {
  const now = new Date().toISOString();
  const fields = {
    name: registration.firstName || "ÐšÐ»Ð¸ÐµÐ½Ñ‚",
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
  if (!registration.email) return { ok: false, skipped: true, error: "Ð”Ð»Ñ Ñ€ÐµÐ³Ð¸ÑÑ‚Ñ€Ð°Ñ†Ð¸Ð¸ Ð½Ð° ÑÐ°Ð¹Ñ‚Ðµ Ð½ÑƒÐ¶ÐµÐ½ email." };

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
  payload.set("tildaspec-formname", form.formName || form.formId);
  payload.set("tildaspec-formskey", form.formsKey);
  payload.set("tildaspec-is-formajax", "y");
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
  console.log("Tilda signup response", JSON.stringify(summarizeTildaResponse(result)));
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
    error: "Tilda Ð·Ð°Ð¿Ñ€Ð¾ÑÐ¸Ð»Ð° ÐºÐ°Ð¿Ñ‡Ñƒ. ÐÐ°Ð¶Ð¼Ð¸Ñ‚Ðµ ÐºÐ½Ð¾Ð¿ÐºÑƒ Ð·Ð°Ð²ÐµÑ€ÑˆÐµÐ½Ð¸Ñ Ñ€ÐµÐ³Ð¸ÑÑ‚Ñ€Ð°Ñ†Ð¸Ð¸ Ð½Ð° ÑÐ°Ð¹Ñ‚Ðµ.",
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
  if (!formMatch) throw new Error("ÐÐµ Ð½Ð°Ð¹Ð´ÐµÐ½Ð° Ñ„Ð¾Ñ€Ð¼Ð° Ñ€ÐµÐ³Ð¸ÑÑ‚Ñ€Ð°Ñ†Ð¸Ð¸ Tilda.");

  const formHtml = formMatch[0];
  const services = [...formHtml.matchAll(/name=["']formservices\[\]["'][^>]*value=["']([^"']+)["']/gi)]
    .map((match) => decodeHtmlAttribute(match[1]))
    .filter(Boolean);
  if (!services.length) throw new Error("ÐÐµ Ð½Ð°Ð¹Ð´ÐµÐ½Ñ‹ ÑÐµÑ€Ð²Ð¸ÑÑ‹-Ð¿Ð¾Ð»ÑƒÑ‡Ð°Ñ‚ÐµÐ»Ð¸ Ñ„Ð¾Ñ€Ð¼Ñ‹ Tilda.");

  tildaSignupFormCache = {
    formId: formMatch[1],
    formName: htmlAttribute(formHtml, "name") || formMatch[1],
    services,
    pageId: htmlAttribute(allRecords, "data-tilda-page-id"),
    projectId: htmlAttribute(allRecords, "data-tilda-project-id"),
    formsKey: htmlAttribute(allRecords, "data-tilda-formskey"),
    lang: htmlAttribute(allRecords, "data-tilda-project-lang") || "RU",
  };
  if (!tildaSignupFormCache.pageId || !tildaSignupFormCache.projectId || !tildaSignupFormCache.formsKey) {
    throw new Error("ÐÐµ Ð½Ð°Ð¹Ð´ÐµÐ½Ñ‹ ÑÐ»ÑƒÐ¶ÐµÐ±Ð½Ñ‹Ðµ Ð¿Ð°Ñ€Ð°Ð¼ÐµÑ‚Ñ€Ñ‹ ÑÑ‚Ñ€Ð°Ð½Ð¸Ñ†Ñ‹ Tilda.");
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
    select: ["id", "name", "active", "iblockId", "type", "purchasingPrice"],
    sort: { id: "ASC" },
    limit: 5000,
  };
}

function loadCatalogCacheFromDisk() {
  try {
    if (!fs.existsSync(catalogCacheFile)) return;
    const payload = JSON.parse(fs.readFileSync(catalogCacheFile, "utf8"));
    catalogProductsCache = mergePreorderProducts(filterCatalogProducts(payload.products));
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
  const queryTokens = catalogSearchTokens(normalized);
  const source = normalized
    ? catalogProductsCache.filter((product) => catalogProductMatchesQuery(product, normalized, queryTokens))
    : catalogProductsCache;
  return source.slice(0, normalized ? 500 : 5000);
}

function catalogProductMatchesQuery(product, normalizedQuery, queryTokens) {
  const name = normalizeCatalogText(product?.name);
  if (name.includes(normalizedQuery)) return true;
  const nameTokens = catalogSearchTokens(name);
  return queryTokens.every((queryToken) =>
    nameTokens.some((nameToken) => catalogTokensMatch(nameToken, queryToken))
  );
}

function catalogSearchTokens(value) {
  return normalizeCatalogText(value).split(/[^\p{L}0-9]+/u).filter((token) => token.length >= 2);
}

function catalogTokensMatch(nameToken, queryToken) {
  if (nameToken.includes(queryToken) || queryToken.includes(nameToken)) return true;
  if (nameToken.length >= 4 && queryToken.length >= 4) return nameToken.slice(0, 4) === queryToken.slice(0, 4);
  return false;
}

async function syncCatalogProducts(reason = "manual") {
  if (catalogSyncInFlight) return catalogSyncInFlight;
  catalogSyncInFlight = (async () => {
    catalogProductsCache = mergePreorderProducts(filterCatalogProducts(await loadCatalogProductsFromSource()));
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
      const ymlProducts = await loadCatalogProductsFromYml(catalogYmlUrl);
      if (!bitrixApiKey) return ymlProducts;
      try {
        return mergeCatalogProducts(ymlProducts, await loadCatalogProductsFromBitrix());
      } catch (error) {
        console.error(`Bitrix catalog merge failed: ${error.message}`);
        return ymlProducts;
      }
    } catch (error) {
      console.error(`YML catalog sync failed: ${error.message}`);
      if (!bitrixApiKey) throw error;
    }
  }
  return loadCatalogProductsFromBitrix();
}

async function loadCatalogProductsFromBitrix() {
  const raw = await bitrixRequest("/v1/catalog-products/search", {
    method: "POST",
    body: JSON.stringify(buildProductSearch("")),
  });
  const prices = await loadCatalogPrices(true);
  return mapProducts(raw, prices);
}

function mergeCatalogProducts(primaryProducts, fallbackProducts) {
  const products = [...asArray(primaryProducts)];
  const keys = new Set(products.map(catalogProductKey).filter(Boolean));
  for (const product of asArray(fallbackProducts)) {
    const key = catalogProductKey(product);
    if (!key || keys.has(key)) continue;
    keys.add(key);
    products.push(product);
  }
  return products;
}

function mergePreorderProducts(products) {
  return mergeCatalogProducts(products, loadPreorderProducts());
}

function catalogProductKey(product) {
  const id = clean(product?.id);
  const xmlId = clean(product?.xmlId || product?.XML_ID);
  return xmlId || id;
}

function loadPreorderProducts() {
  try {
    if (!fs.existsSync(preorderProductsFile)) return [];
    return filterCatalogProducts(JSON.parse(fs.readFileSync(preorderProductsFile, "utf8")));
  } catch (error) {
    console.warn(`Preorder products load failed: ${error.message}`);
    return [];
  }
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
    const rawName = xmlTag(body, "name");
    const name = normalizeCatalogProductName(rawName);
    if (!id || !name) continue;
    if (isCatalogCustomizationVariant(rawName)) continue;
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

function filterCatalogProducts(products) {
  return Array.isArray(products)
    ? products
      .filter((product) => product && !isCatalogCustomizationVariant(product.name))
      .map((product) => ({ ...product, name: normalizeCatalogProductName(product.name) }))
    : [];
}

function normalizeCatalogProductName(name) {
  return String(name || "").replace(/\s+-\s+\u041d\u0435\u0442\s*$/i, "").trim();
}

function isCatalogCustomizationVariant(name) {
  const normalized = normalizeCatalogText(name).replace(/\s+/g, " ");
  const suffix = normalized.split(/\s+-\s+/).pop() || "";
  return suffix.includes("\u0438\u043d\u0438\u0446\u0438\u0430\u043b\u044b")
    || suffix.includes("\u0444\u0430\u043c\u0438\u043b\u0438\u044f \u0438 \u0438\u043c\u044f");
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
  return String(value || "").trim().toLowerCase().replace(/\u0451/g, "\u0435");
}

function mapProducts(raw, prices = new Map()) {
  return asArray(raw)
    .filter((product) => product && product.active !== false)
    .map((product) => {
      const id = String(product.id ?? product.ID);
      const xmlId = clean(product.xmlId || product.XML_ID);
      const price = prices.get(id);
      return {
        id: xmlId || id,
        bitrixProductId: id,
        xmlId,
        name: String(product.name ?? product.NAME ?? `Product #${id}`),
        price: price?.price ?? numberOrZero(product.price ?? product.PRICE ?? product.purchasingPrice ?? product.PURCHASING_PRICE),
        currency: price?.currency ?? String(product.currency ?? product.CURRENCY ?? "RUB"),
        source: "bitrix-catalog",
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

function unique(values) {
  return [...new Set(values)];
}

function numberOrZero(value) {
  return numberOrNull(value) ?? 0;
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(String(value).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(number) ? number : null;
}

function dateOnly(value) {
  if (!value) return "";
  const text = String(value).trim();
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(text);
  if (match) return match[1];
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

function firstCommunication(value) {
  if (Array.isArray(value)) {
    const item = value.find((entry) => entry?.value || entry?.VALUE || entry?.email || entry?.phone);
    return clean(item?.value || item?.VALUE || item?.email || item?.phone);
  }
  if (value && typeof value === "object") return clean(value.value || value.VALUE || value.email || value.phone);
  return clean(value);
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

function proxyIntegration(req, res, url) {
  const targetPath = url.pathname.slice("/integration".length) || "/";
  const upstream = http.request({
    hostname: "127.0.0.1",
    port: 3101,
    method: req.method,
    path: targetPath + url.search,
    headers: { ...req.headers, host: "127.0.0.1:3101" },
    timeout: 30000,
  }, response => {
    res.writeHead(response.statusCode || 502, response.headers);
    response.pipe(res);
  });
  upstream.on("timeout", () => upstream.destroy(new Error("Integration timeout")));
  upstream.on("error", error => {
    console.error("Integration proxy failed", error);
    if (!res.headersSent) json(res, 502, { error: "Integration unavailable" });
    else res.destroy(error);
  });
  req.pipe(upstream);
}

function serveSiteVideo(req, res, pathname) {
  const name = pathname.slice("/site-video/".length);
  if (!/^IMG_\d{4}\.mp4$/.test(name)) return json(res, 404, { error: "Video not found" });
  const file = path.join(siteVideoDir, name);
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return json(res, 404, { error: "Video not found" });
  const size = fs.statSync(file).size;
  let start = 0;
  let end = size - 1;
  let status = 200;
  const range = req.headers.range;
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match || (!match[1] && !match[2])) {
      res.writeHead(416, { "Content-Range": `bytes */${size}`, "Accept-Ranges": "bytes" });
      return res.end();
    }
    if (!match[1]) {
      const suffix = Number(match[2]);
      if (!Number.isSafeInteger(suffix) || suffix < 1) {
        res.writeHead(416, { "Content-Range": `bytes */${size}`, "Accept-Ranges": "bytes" });
        return res.end();
      }
      start = Math.max(0, size - suffix);
    } else {
      start = Number(match[1]);
      if (match[2]) end = Number(match[2]);
    }
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || end < start) {
      res.writeHead(416, { "Content-Range": `bytes */${size}`, "Accept-Ranges": "bytes" });
      return res.end();
    }
    end = Math.min(end, size - 1);
    status = 206;
  }
  const headers = {
    "Content-Type": "video/mp4",
    "Content-Length": end - start + 1,
    "Accept-Ranges": "bytes",
    "Cache-Control": "public, max-age=86400",
    "Access-Control-Allow-Origin": "*",
  };
  if (status === 206) headers["Content-Range"] = `bytes ${start}-${end}/${size}`;
  res.writeHead(status, headers);
  if (req.method === "HEAD") return res.end();
  let streamedBytes = 0;
  let logged = false;
  const log = (completed) => {
    if (logged) return;
    logged = true;
    const record = { at: new Date().toISOString(), file: name, status, range: range || null,
      streamedBytes, completed };
    fs.appendFile(siteVideoTrafficLog, `${JSON.stringify(record)}\n`, error => {
      if (error) console.error("Video traffic log failed", error);
    });
  };
  res.once("finish", () => log(true));
  res.once("close", () => log(false));
  const stream = fs.createReadStream(file, { start, end });
  stream.on("data", chunk => { streamedBytes += chunk.length; });
  stream.on("error", error => { console.error("Video stream failed", error); res.destroy(error); });
  res.on("close", () => stream.destroy());
  stream.pipe(res);
}

function serveStatic(res, pathname) {
  const staticAliases = {
    [managerFormPath]: "/index.html",
    "/partner-payouts-dashboard": "/partner-payouts-dashboard.html",
  };
  const requested = staticAliases[pathname] || pathname;
  const relative = requested.replace(/^\/+/, "");
  const filePath = path.resolve(frontend, relative);
  if (!filePath.startsWith(`${frontend}${path.sep}`) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    return json(res, 404, { error: "Ð¤Ð°Ð¹Ð» Ð½Ðµ Ð½Ð°Ð¹Ð´ÐµÐ½." });
  }
  const extension = path.extname(filePath).toLowerCase();
  const types = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8" };
  res.writeHead(200, { "Content-Type": types[extension] || "application/octet-stream", "Cache-Control": "no-store" });
  fs.createReadStream(filePath).pipe(res);
}

function normalizeManagerPath(value) {
  const pathValue = String(value || "").trim() || "/managers";
  return `/${pathValue.replace(/^\/+|\/+$/g, "") || "managers"}`;
}

function isManagerFormRequest(method, pathname) {
  if (method === "GET" && (pathname === managerFormPath || pathname === "/partner-payouts-dashboard")) return true;
  if (method === "GET" && ["/index.html", "/app.js", "/styles.css", "/partner-payouts-dashboard.html", "/partner-payouts-dashboard.js"].includes(pathname)) return true;
  if (!pathname.startsWith("/api/")) return false;
  return [
    "/api/employees",
    "/api/promocodes/lookup",
    "/api/certificates/lookup",
    "/api/partner-payouts/offline",
    "/api/partner-payouts/report",
    "/api/partner-payouts/mark-paid",
    "/api/contacts/search",
    "/api/contacts",
    "/api/products",
    "/api/orders",
    "/api/tilda/signup/captcha",
    "/api/tilda/signup/complete",
    "/api/jobs/partner-payouts/month-end",
  ].some((apiPath) => pathname === apiPath || pathname.startsWith(`${apiPath}/`));
}

function isAuthorizedManagerRequest(req) {
  if (!managerFormUser || !managerFormPassword) return true;
  const authorization = String(req.headers.authorization || "");
  if (!authorization.startsWith("Basic ")) return false;
  const decoded = Buffer.from(authorization.slice(6), "base64").toString("utf8");
  const separator = decoded.indexOf(":");
  if (separator < 0) return false;
  const user = decoded.slice(0, separator);
  const password = decoded.slice(separator + 1);
  return constantTimeEqual(user, managerFormUser) && constantTimeEqual(password, managerFormPassword);
}

function isProtectedPartnerPayoutRequest(method, pathname) {
  return (method === "GET" && (pathname === "/partner-payouts-dashboard" ||
    pathname === "/partner-payouts-dashboard.html" ||
    pathname === "/api/partner-payouts/report")) ||
    (method === "POST" && pathname === "/api/partner-payouts/mark-paid");
}

function isPartnerPayoutDashboardAsset(method, pathname) {
  if (method === "POST" && pathname === "/api/partner-payouts/mark-paid") return true;
  if (method !== "GET") return false;
  return [
    "/partner-payouts-dashboard",
    "/partner-payouts-dashboard.html",
    "/partner-payouts-dashboard.js",
    "/styles.css",
    "/api/partner-payouts/report",
  ].includes(pathname);
}

function isAuthorizedPartnerPayoutRequest(req) {
  const userId = String(req.headers["x-vibe-user-id"] || "").trim();
  const role = String(req.headers["x-vibe-user-role"] || "").trim().toUpperCase();
  return /^\d+$/.test(userId) && ["ADMIN", "MEMBER"].includes(role);
}

function constantTimeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function unauthorized(res) {
  res.writeHead(401, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
    "WWW-Authenticate": 'Basic realm="V2SD managers", charset="UTF-8"',
  });
  res.end("Authentication required.");
}

function forbidden(res) {
  return json(res, 403, { error: "Доступ к отчету выплат не разрешен." });
}

function redirect(res, location) {
  res.writeHead(302, {
    Location: location,
    "Cache-Control": "no-store",
  });
  res.end();
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
    "Access-Control-Allow-Headers": "Content-Type,Accept,X-Tilda-Member-Token,X-Tilda-Project-Id",
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
  if (message.includes("TimeoutError") || message.includes("aborted due to timeout")) {
    return "\u0411\u0438\u0442\u0440\u0438\u043a\u044124 \u0434\u043e\u043b\u0433\u043e \u043e\u0442\u0432\u0435\u0447\u0430\u0435\u0442. \u041f\u043e\u043f\u0440\u043e\u0431\u0443\u0439\u0442\u0435 \u0435\u0449\u0435 \u0440\u0430\u0437.";
  }
  if (message.includes("CATALOG_PRODUCT_NOT_FOUND")) {
    return "\u0422\u043e\u0432\u0430\u0440 \u043d\u0435 \u043d\u0430\u0439\u0434\u0435\u043d \u0432 \u043a\u0430\u0442\u0430\u043b\u043e\u0433\u0435 Bitrix24: " + message.replace("CATALOG_PRODUCT_NOT_FOUND:", "").trim();
  }
  if (message.includes("fetch failed")) return "ÐÐµÑ‚ ÑÐ¾ÐµÐ´Ð¸Ð½ÐµÐ½Ð¸Ñ Ñ API Bitrix24.";
  if (message.includes("401") || message.includes("403")) return "Bitrix24 Ð¾Ñ‚ÐºÐ»Ð¾Ð½Ð¸Ð» API-ÐºÐ»ÑŽÑ‡.";
  return "ÐÐµ ÑƒÐ´Ð°Ð»Ð¾ÑÑŒ Ð¿Ð¾Ð»ÑƒÑ‡Ð¸Ñ‚ÑŒ Ð´Ð°Ð½Ð½Ñ‹Ðµ ÐºÐ¾Ð½Ñ‚Ð°ÐºÑ‚Ð° Ð¸Ð· Bitrix24.";
}
