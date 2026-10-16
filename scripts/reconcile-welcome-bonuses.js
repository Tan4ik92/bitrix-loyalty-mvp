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
const limit = Math.min(Math.max(Number(args.limit || 200), 1), 500);
const registeredFrom = args["registered-from"] || "";
const contactId = args["contact-id"] || "";
const all = Boolean(args.all);
const delayMs = Math.max(Number(args["delay-ms"] || 0), 0);
const includeAmbiguous = Boolean(args["include-ambiguous"]);
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const logDir = path.resolve(root, args["log-dir"] || path.join("logs", `welcome-bonus-reconcile-${runId}`));

if (!apiKey) {
  console.error("VIBECODE_API_KEY is not configured.");
  process.exit(1);
}

if (!all && !contactId) {
  console.error("Pass --contact-id=ID for a single-contact check, or --all intentionally.");
  process.exit(1);
}

if (registeredFrom && !all && !contactId) {
  console.error("Bitrix does not allow filtering contacts by the registration UF field. Use --all with --registered-from for client-side filtering.");
  process.exit(1);
}

const summary = {
  scanned: 0,
  wouldUpdate: 0,
  updated: 0,
  skipped: 0,
  emptyFields: 0,
  ambiguous: 0,
  ambiguousSkipped: 0,
  errors: 0,
};

await fs.promises.mkdir(logDir, { recursive: true });
const logs = {
  actions: path.join(logDir, "actions.csv"),
  emptyFields: path.join(logDir, "empty-fields.csv"),
  ambiguous: path.join(logDir, "ambiguous.csv"),
  errors: path.join(logDir, "errors.log"),
  summary: path.join(logDir, "summary.json"),
};
await writeText(logs.actions, "id,name,email,phone,registeredAt,ordersCount,accrued,used,expired,reason,applyStatus,fields\n");
await writeText(logs.emptyFields, "id,name,email,phone,registeredAt,ordersCount,reason\n");
await writeText(logs.ambiguous, "id,name,email,phone,registeredAt,ordersCount,accrued,used,expired,reason\n");
await writeText(logs.errors, "");

console.log(apply ? "Mode: APPLY" : "Mode: DRY RUN");
console.log(contactId ? `Scope: contact #${contactId}` : "Scope: all contacts");
if (registeredFrom) console.log(`Client-side registered-from filter: ${registeredFrom}`);
console.log(`Log dir: ${logDir}`);

for await (const contact of iterateContacts()) {
  summary.scanned += 1;
  const audit = auditContact(contact);
  if (audit.emptyFields) {
    summary.emptyFields += 1;
    await appendCsv(logs.emptyFields, contact, [audit.emptyFieldsReason]);
  }
  if (audit.ambiguous.length) {
    summary.ambiguous += 1;
    await appendCsv(logs.ambiguous, contact, [audit.ambiguous.join("; ")]);
    if (!includeAmbiguous) {
      summary.ambiguousSkipped += 1;
      summary.skipped += 1;
      if (delayMs) await delay(delayMs);
      continue;
    }
  }

  const action = buildContactWelcomeBonusPatch(contact);
  if (!action) {
    summary.skipped += 1;
    if (delayMs) await delay(delayMs);
    continue;
  }

  summary.wouldUpdate += 1;
  const id = contact.id || contact.ID;
  console.log(`#${id}: ${action.reason}`, action.fields);

  if (!apply) {
    await appendCsv(logs.actions, contact, [action.reason, "dry-run", JSON.stringify(action.fields)]);
    if (delayMs) await delay(delayMs);
    continue;
  }
  try {
    await request(`/v1/contacts/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(action.fields),
    });
    summary.updated += 1;
    await appendCsv(logs.actions, contact, [action.reason, "updated", JSON.stringify(action.fields)]);
  } catch (error) {
    summary.errors += 1;
    console.error(`#${id}: ${error.message}`);
    await append(logs.errors, `#${id}: ${error.stack || error.message}\n`);
    await appendCsv(logs.actions, contact, [action.reason, "error", JSON.stringify(action.fields)]);
  }
  if (delayMs) await delay(delayMs);
}

console.log(JSON.stringify(summary, null, 2));
await writeText(logs.summary, JSON.stringify({ ...summary, apply, contactId, all, registeredFrom, limit, delayMs, includeAmbiguous, logDir }, null, 2));

function buildContactWelcomeBonusPatch(contact) {
  const state = buildWelcomeBonusState({
    accrued: contact[loyaltyFields.balance],
    used: contact[loyaltyFields.welcomeBonusUsed],
    expired: contact[loyaltyFields.welcomeBonusExpired],
    registeredAt: contact[loyaltyFields.registeredAt],
    ordersCount: contact[loyaltyFields.ordersCount],
  });

  const fields = {
    [loyaltyFields.syncedAt]: new Date().toISOString(),
  };

  if (state.shouldAccrue) {
    fields[loyaltyFields.balance] = 300;
    return { reason: "registered without accrual and no orders -> accrue 300", fields };
  }

  if (state.shouldExpire) {
    fields[loyaltyFields.welcomeBonusExpired] = state.accrued || 300;
    return { reason: `${state.reason} -> expire welcome bonus`, fields };
  }

  return null;
}

function auditContact(contact) {
  const accrued = numberOrNull(contact[loyaltyFields.balance]);
  const used = numberOrNull(contact[loyaltyFields.welcomeBonusUsed]);
  const expired = numberOrNull(contact[loyaltyFields.welcomeBonusExpired]);
  const ordersCount = numberOrNull(contact[loyaltyFields.ordersCount]);
  const registeredAt = contact[loyaltyFields.registeredAt] || "";
  const emptyFields = accrued === null && used === null && expired === null;
  const ambiguous = [];

  if (used !== null && expired !== null && used > 0 && expired > 0) {
    ambiguous.push("both used and expired are filled");
  }
  if (accrued !== null && accrued > 0 && used !== null && used > accrued) {
    ambiguous.push("used is greater than accrued");
  }
  if (accrued !== null && accrued > 0 && expired !== null && expired > accrued) {
    ambiguous.push("expired is greater than accrued");
  }
  if (accrued !== null && accrued > 0 && !registeredAt) {
    ambiguous.push("accrued welcome bonus but registration date is empty");
  }
  if (ordersCount === null && (accrued !== null || used !== null || expired !== null || registeredAt)) {
    ambiguous.push("orders count is empty");
  }

  return {
    emptyFields,
    emptyFieldsReason: registeredAt
      ? "welcome fields empty, registered contact"
      : "welcome fields empty, no registration date",
    ambiguous,
  };
}

async function* iterateContacts() {
  if (contactId) {
    const contact = await request(`/v1/contacts/${encodeURIComponent(contactId)}`);
    if (matchesClientFilters(contact)) yield contact;
    return;
  }

  let offset = 0;
  while (true) {
    const body = {
      filter: buildFilter(),
      select: [
        "id",
        "name",
        "lastName",
        "email",
        "phone",
        loyaltyFields.balance,
        loyaltyFields.welcomeBonusUsed,
        loyaltyFields.welcomeBonusExpired,
        loyaltyFields.ordersCount,
        loyaltyFields.registeredAt,
        loyaltyFields.syncedAt,
      ],
      sort: { id: "ASC" },
      limit,
      offset,
    };
    const raw = await request("/v1/contacts/search", {
      method: "POST",
      body: JSON.stringify(body),
    });
    const items = asArray(raw);
    if (!items.length) break;
    for (const item of items) {
      if (matchesClientFilters(item)) yield item;
    }
    if (items.length < limit) break;
    offset += items.length;
  }
}

function buildFilter() {
  return {};
}

function matchesClientFilters(contact) {
  if (!registeredFrom) return true;
  const registeredAt = String(contact[loyaltyFields.registeredAt] || "");
  return Boolean(registeredAt) && registeredAt.slice(0, 10) >= registeredFrom;
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

async function writeText(filePath, text) {
  await fs.promises.writeFile(filePath, text, "utf8");
}

async function append(filePath, text) {
  await fs.promises.appendFile(filePath, text, "utf8");
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(String(value).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(number) ? number : null;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
