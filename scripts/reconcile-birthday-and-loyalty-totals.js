import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildWelcomeBonusState, loyaltyFields } from "../backend/contact.js";

const moduleFile = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(moduleFile), "..");
loadEnv(path.join(root, ".env"));
loadEnv(
  process.env.LEGACY_ENV_FILE ||
    path.resolve(root, "..", "api-vibecode-vibe-api-76zodj3ui3hx42zrvd1qrk8lqvszr6u4-8945d5-2", ".env"),
  new Set(["VIBECODE_API_BASE", "VIBECODE_API_KEY"]),
);

const args = parseArgs(process.argv.slice(2));
const apiBase = String(process.env.VIBECODE_API_BASE || "https://vibecode.bitrix24.tech").replace(/\/$/, "");
const apiKey = process.env.VIBECODE_API_KEY || "";
const apply = Boolean(args.apply);
const all = Boolean(args.all);
const contactId = args["contact-id"] || "";
const limit = Math.min(Math.max(Number(args.limit || 200), 1), 500);
const delayMs = Math.max(Number(args["delay-ms"] || 0), 0);
const quiet = Boolean(args.quiet);
const progressEvery = Math.max(Number(args["progress-every"] || 500), 0);
const concurrency = Math.min(Math.max(Number(args.concurrency || 1), 1), 10);
const today = dateOnly(args.today || new Date());
const currentYear = Number(today.slice(0, 4));
const birthdayAmount = Math.max(Number(args["birthday-amount"] || 500), 0);
const windowBeforeDays = Math.max(Number(args["window-before-days"] || 7), 0);
const windowAfterDays = Math.max(Number(args["window-after-days"] || 7), 0);
const birthdayLifetimeDays = Math.max(Number(args["birthday-lifetime-days"] || 7), 0);
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const logDir = path.resolve(root, args["log-dir"] || path.join("logs", `birthday-loyalty-reconcile-${runId}`));

if (!apiKey) {
  console.error("VIBECODE_API_KEY is not configured.");
  process.exit(1);
}

if (!all && !contactId) {
  console.error("Pass --contact-id=ID for a single-contact check, or --all intentionally.");
  process.exit(1);
}

const summary = {
  scanned: 0,
  wouldUpdate: 0,
  updated: 0,
  skipped: 0,
  birthdayWouldAccrue: 0,
  birthdayAccrued: 0,
  welcomeWouldFix: 0,
  totalsWouldFix: 0,
  negativeWouldFix: 0,
  ambiguous: 0,
  errors: 0,
};

await fs.promises.mkdir(logDir, { recursive: true });
const logs = {
  birthdayAccrued: path.join(logDir, "birthday-accrued.csv"),
  corrected: path.join(logDir, "corrected.csv"),
  skipped: path.join(logDir, "skipped.csv"),
  ambiguous: path.join(logDir, "ambiguous.csv"),
  errors: path.join(logDir, "errors.log"),
  summary: path.join(logDir, "summary.json"),
};

await writeText(logs.birthdayAccrued, `${baseHeader()},birthdate,birthdayThisYear,expiresAt,fields\n`);
await writeText(logs.corrected, `${baseHeader()},birthdate,reason,fields\n`);
await writeText(logs.skipped, `${baseHeader()},birthdate,reason\n`);
await writeText(logs.ambiguous, `${baseHeader()},birthdate,reason\n`);
await writeText(logs.errors, "");

console.log(apply ? "Mode: APPLY" : "Mode: DRY RUN");
console.log(contactId ? `Scope: contact #${contactId}` : "Scope: all contacts");
console.log(`Birthday window: ${addDays(today, -windowBeforeDays)} .. ${addDays(today, windowAfterDays)}`);
console.log(`Log dir: ${logDir}`);

const active = new Set();
for await (const contact of iterateContacts()) {
  const task = processContact(contact).finally(() => active.delete(task));
  active.add(task);
  if (active.size >= concurrency) await Promise.race(active);
}
await Promise.all(active);

async function processContact(contact) {
  summary.scanned += 1;
  const result = buildPatch(contact);
  const id = contact.id || contact.ID;

  if (result.ambiguous.length) {
    summary.ambiguous += 1;
    await appendCsv(logs.ambiguous, contact, [contact.birthdate || contact.BIRTHDATE || "", result.ambiguous.join("; ")]);
  }

  if (!Object.keys(result.fields).length) {
    summary.skipped += 1;
    await appendCsv(logs.skipped, contact, [contact.birthdate || contact.BIRTHDATE || "", result.reason || "no action"]);
    if (delayMs) await delay(delayMs);
    logProgress();
    return;
  }

  summary.wouldUpdate += 1;
  if (result.birthdayAccrual) summary.birthdayWouldAccrue += 1;
  if (result.welcomeFix) summary.welcomeWouldFix += 1;
  if (result.totalsFix) summary.totalsWouldFix += 1;
  if (result.negativeFix) summary.negativeWouldFix += 1;
  if (!quiet) console.log(`#${id}: ${result.reason}`, result.fields);

  if (!apply) {
    await writeActionLogs(result, contact, "dry-run");
    if (delayMs) await delay(delayMs);
    logProgress();
    return;
  }

  try {
    await request(`/v1/contacts/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(result.fields),
    });
    summary.updated += 1;
    if (result.birthdayAccrual) summary.birthdayAccrued += 1;
    await writeActionLogs(result, contact, "updated");
  } catch (error) {
    summary.errors += 1;
    console.error(`#${id}: ${error.message}`);
    await append(logs.errors, `#${id}: ${error.stack || error.message}\n`);
    await writeActionLogs({ ...result, reason: `${result.reason}; ERROR: ${error.message}` }, contact, "error");
  }

  if (delayMs) await delay(delayMs);
  logProgress();
}

const summaryPayload = {
  ...summary,
  apply,
  contactId,
  all,
  today,
  birthdayAmount,
  birthdayWindowFrom: addDays(today, -windowBeforeDays),
  birthdayWindowTo: addDays(today, windowAfterDays),
  birthdayLifetimeDays,
  limit,
  delayMs,
  concurrency,
  logDir,
};

console.log(JSON.stringify(summaryPayload, null, 2));
await writeText(logs.summary, JSON.stringify(summaryPayload, null, 2));

function logProgress() {
  if (!progressEvery || summary.scanned % progressEvery !== 0) return;
  console.log(`Progress: scanned=${summary.scanned}, wouldUpdate=${summary.wouldUpdate}, updated=${summary.updated}`);
}

function buildPatch(contact) {
  const fields = {};
  const reasons = [];
  const ambiguous = [];
  let birthdayAccrual = false;
  let welcomeFix = false;
  let totalsFix = false;
  let negativeFix = false;

  const numbers = readNumbers(contact);
  for (const [field, value] of Object.entries(numbers)) {
    if (value !== null && value < 0) {
      fields[field] = 0;
      numbers[field] = 0;
      negativeFix = true;
    }
  }
  if (negativeFix) reasons.push("negative bonus values -> clamp to 0");

  const welcomeState = buildWelcomeBonusState({
    accrued: numbers[loyaltyFields.balance],
    used: numbers[loyaltyFields.welcomeBonusUsed],
    expired: numbers[loyaltyFields.welcomeBonusExpired],
    registeredAt: contact[loyaltyFields.registeredAt],
    ordersCount: contact[loyaltyFields.ordersCount],
  });

  if (welcomeState.used > 0 && welcomeState.expired > 0) {
    ambiguous.push("welcome has both used and expired");
  }
  if (welcomeState.used > welcomeState.accrued && welcomeState.accrued > 0) {
    ambiguous.push("welcome used is greater than accrued");
  }
  if (welcomeState.expired > welcomeState.accrued && welcomeState.accrued > 0) {
    ambiguous.push("welcome expired is greater than accrued");
  }

  if (!ambiguous.length && welcomeState.shouldAccrue) {
    fields[loyaltyFields.balance] = 300;
    numbers[loyaltyFields.balance] = 300;
    welcomeFix = true;
    reasons.push("registered without welcome accrual and no orders -> accrue 300");
  } else if (!ambiguous.length && welcomeState.shouldExpire) {
    fields[loyaltyFields.welcomeBonusExpired] = welcomeState.accrued || 300;
    numbers[loyaltyFields.welcomeBonusExpired] = welcomeState.accrued || 300;
    welcomeFix = true;
    reasons.push(`${welcomeState.reason} -> expire welcome bonus`);
  }

  const birthday = buildBirthdayAccrual(contact, numbers);
  if (birthday.ambiguous) ambiguous.push(birthday.ambiguous);
  if (birthday.fields) {
    Object.assign(fields, birthday.fields);
    Object.assign(numbers, birthday.numberUpdates);
    birthdayAccrual = true;
    reasons.push(birthday.reason);
  } else if (birthday.reason) {
    reasons.push(birthday.reason);
  }

  const computedTotals = computeTotals(numbers);
  const currentAccruedTotal = numbers[loyaltyFields.accruedTotal] ?? 0;
  const currentSpentTotal = numbers[loyaltyFields.spentTotal] ?? 0;
  if (roundMoney(currentAccruedTotal) !== computedTotals.accruedTotal) {
    fields[loyaltyFields.accruedTotal] = computedTotals.accruedTotal;
    totalsFix = true;
  }
  if (roundMoney(currentSpentTotal) !== computedTotals.spentTotal) {
    fields[loyaltyFields.spentTotal] = computedTotals.spentTotal;
    totalsFix = true;
  }
  if (totalsFix) reasons.push("sync total accrued/spent fields");
  if (Object.keys(fields).length) fields[loyaltyFields.syncedAt] = new Date().toISOString();

  return {
    fields,
    reason: reasons.filter(Boolean).join("; "),
    ambiguous,
    birthdayAccrual,
    welcomeFix,
    totalsFix,
    negativeFix,
    birthdayThisYear: birthday.birthdayThisYear || "",
    birthdayExpiresAt: birthday.expiresAt || "",
  };
}

function buildBirthdayAccrual(contact, numbers) {
  const rawBirthdate = contact.birthdate || contact.BIRTHDATE || "";
  const birthdayThisYear = birthdayDateForYear(rawBirthdate, currentYear);
  if (!birthdayThisYear) return {};
  if (!isDateInRange(birthdayThisYear, addDays(today, -windowBeforeDays), addDays(today, windowAfterDays))) {
    return {};
  }

  const accrued = numbers[loyaltyFields.birthdayBonusAccrued] ?? 0;
  const used = numbers[loyaltyFields.birthdayBonusUsed] ?? 0;
  const expired = numbers[loyaltyFields.birthdayBonusExpired] ?? 0;
  const lastYear = numbers[loyaltyFields.birthdayBonusLastYear];
  const accruedAt = String(contact[loyaltyFields.birthdayBonusAccruedAt] || "");
  const hasThisYearAccrual = lastYear === currentYear || accruedAt.slice(0, 4) === String(currentYear);
  const hasBirthdayData = accrued > 0 || used > 0 || expired > 0;

  if (hasThisYearAccrual || hasBirthdayData) {
    return { birthdayThisYear, reason: "birthday in rollout window but already has birthday bonus data" };
  }

  const expiresAt = addDays(birthdayThisYear, birthdayLifetimeDays);
  return {
    birthdayThisYear,
    expiresAt,
    reason: "birthday in rollout window -> accrue birthday bonus",
    fields: {
      [loyaltyFields.birthdayBonusAccrued]: birthdayAmount,
      [loyaltyFields.birthdayBonusUsed]: 0,
      [loyaltyFields.birthdayBonusExpired]: 0,
      [loyaltyFields.birthdayBonusAccruedAt]: today,
      [loyaltyFields.birthdayBonusExpiresAt]: expiresAt,
      [loyaltyFields.birthdayBonusLastYear]: currentYear,
    },
    numberUpdates: {
      [loyaltyFields.birthdayBonusAccrued]: birthdayAmount,
      [loyaltyFields.birthdayBonusUsed]: 0,
      [loyaltyFields.birthdayBonusExpired]: 0,
      [loyaltyFields.birthdayBonusLastYear]: currentYear,
    },
  };
}

function readNumbers(contact) {
  const fields = [
    loyaltyFields.balance,
    loyaltyFields.welcomeBonusUsed,
    loyaltyFields.welcomeBonusExpired,
    loyaltyFields.birthdayBonusAccrued,
    loyaltyFields.birthdayBonusUsed,
    loyaltyFields.birthdayBonusExpired,
    loyaltyFields.birthdayBonusLastYear,
    loyaltyFields.accruedTotal,
    loyaltyFields.spentTotal,
  ];
  return Object.fromEntries(fields.map((field) => [field, numberOrNull(contact[field])]));
}

function computeTotals(numbers) {
  return {
    accruedTotal: roundMoney(
      positive(numbers[loyaltyFields.balance]) +
        positive(numbers[loyaltyFields.birthdayBonusAccrued]),
    ),
    spentTotal: roundMoney(
      positive(numbers[loyaltyFields.welcomeBonusUsed]) +
        positive(numbers[loyaltyFields.welcomeBonusExpired]) +
        positive(numbers[loyaltyFields.birthdayBonusUsed]) +
        positive(numbers[loyaltyFields.birthdayBonusExpired]),
    ),
  };
}

async function writeActionLogs(result, contact, status) {
  const fieldsJson = JSON.stringify(result.fields);
  if (result.birthdayAccrual) {
    await appendCsv(logs.birthdayAccrued, contact, [
      contact.birthdate || contact.BIRTHDATE || "",
      result.birthdayThisYear,
      result.birthdayExpiresAt,
      fieldsJson,
    ]);
  }
  await appendCsv(logs.corrected, contact, [
    contact.birthdate || contact.BIRTHDATE || "",
    `${status}: ${result.reason}`,
    fieldsJson,
  ]);
}

async function* iterateContacts() {
  if (contactId) {
    const contact = await request(`/v1/contacts/${encodeURIComponent(contactId)}`);
    yield contact;
    return;
  }

  let offset = 0;
  while (true) {
    const raw = await request("/v1/contacts/search", {
      method: "POST",
      body: JSON.stringify({
        filter: {},
        select: [
          "id",
          "name",
          "lastName",
          "email",
          "phone",
          "birthdate",
          loyaltyFields.balance,
          loyaltyFields.welcomeBonusUsed,
          loyaltyFields.welcomeBonusExpired,
          loyaltyFields.birthdayBonusAccrued,
          loyaltyFields.birthdayBonusUsed,
          loyaltyFields.birthdayBonusExpired,
          loyaltyFields.birthdayBonusAccruedAt,
          loyaltyFields.birthdayBonusExpiresAt,
          loyaltyFields.birthdayBonusLastYear,
          loyaltyFields.purchaseSum,
          loyaltyFields.ordersCount,
          loyaltyFields.registeredAt,
          loyaltyFields.accruedTotal,
          loyaltyFields.spentTotal,
          loyaltyFields.syncedAt,
        ],
        sort: { id: "ASC" },
        limit,
        offset,
      }),
    });
    const items = asArray(raw);
    if (!items.length) break;
    for (const item of items) yield item;
    if (items.length < limit) break;
    offset += items.length;
  }
}

function baseHeader() {
  return [
    "id",
    "name",
    "email",
    "phone",
    "registeredAt",
    "ordersCount",
    "welcomeAccrued",
    "welcomeUsed",
    "welcomeExpired",
    "birthdayAccrued",
    "birthdayUsed",
    "birthdayExpired",
    "birthdayAccruedAt",
    "birthdayExpiresAt",
    "birthdayLastYear",
    "accruedTotal",
    "spentTotal",
  ].join(",");
}

function contactRow(contact) {
  return [
    contact.id || contact.ID || "",
    [contact.lastName || contact.LAST_NAME, contact.name || contact.NAME].filter(Boolean).join(" ").trim(),
    firstCommunication(contact.email || contact.EMAIL),
    firstCommunication(contact.phone || contact.PHONE),
    contact[loyaltyFields.registeredAt] || "",
    contact[loyaltyFields.ordersCount] ?? "",
    contact[loyaltyFields.balance] ?? "",
    contact[loyaltyFields.welcomeBonusUsed] ?? "",
    contact[loyaltyFields.welcomeBonusExpired] ?? "",
    contact[loyaltyFields.birthdayBonusAccrued] ?? "",
    contact[loyaltyFields.birthdayBonusUsed] ?? "",
    contact[loyaltyFields.birthdayBonusExpired] ?? "",
    contact[loyaltyFields.birthdayBonusAccruedAt] ?? "",
    contact[loyaltyFields.birthdayBonusExpiresAt] ?? "",
    contact[loyaltyFields.birthdayBonusLastYear] ?? "",
    contact[loyaltyFields.accruedTotal] ?? "",
    contact[loyaltyFields.spentTotal] ?? "",
  ];
}

async function appendCsv(filePath, contact, extraColumns = []) {
  await append(filePath, [...contactRow(contact), ...extraColumns].map(csvCell).join(",") + "\n");
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function firstCommunication(value) {
  if (!value) return "";
  const values = Array.isArray(value) ? value : [value];
  const first = values[0];
  return String(first?.value ?? first?.VALUE ?? first ?? "").trim();
}

async function request(apiPath, options = {}) {
  const response = await fetch(`${apiBase}${apiPath}`, {
    ...options,
    headers: {
      "X-Api-Key": apiKey,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(options.headers || {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.success === false) {
    const details = payload.error || payload.message || payload;
    throw new Error(typeof details === "string" ? details : JSON.stringify(details));
  }
  return payload.data ?? payload;
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.items)) return value.items;
  if (Array.isArray(value?.contacts)) return value.contacts;
  if (Array.isArray(value?.result)) return value.result;
  return [];
}

function parseArgs(values) {
  const result = {};
  for (const value of values) {
    if (!value.startsWith("--")) continue;
    const [key, raw = "1"] = value.slice(2).split("=");
    result[key] = raw === "0" ? false : raw;
  }
  return result;
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

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(String(value).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(number) ? number : null;
}

function positive(value) {
  return Math.max(0, Number(value) || 0);
}

function dateOnly(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  const match = String(value || "").match(/^\d{4}-\d{2}-\d{2}/);
  if (match) return match[0];
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function birthdayDateForYear(value, year) {
  const source = dateOnly(value);
  if (!source) return null;
  const [, , month, day] = source.match(/^(\d{4})-(\d{2})-(\d{2})$/) || [];
  if (!month || !day) return null;
  if (month === "02" && day === "29" && !isLeapYear(year)) return `${year}-02-28`;
  return `${year}-${month}-${day}`;
}

function isDateInRange(value, from, to) {
  return value >= from && value <= to;
}

function addDays(value, days) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function isLeapYear(year) {
  return year % 400 === 0 || (year % 4 === 0 && year % 100 !== 0);
}

function roundMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function writeText(filePath, text) {
  await fs.promises.writeFile(filePath, text, "utf8");
}

async function append(filePath, text) {
  await fs.promises.appendFile(filePath, text, "utf8");
}
