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
const previousLogDir = path.resolve(root, args["previous-log-dir"] || "");
const limit = Math.min(Math.max(Number(args.limit || 200), 1), 500);
const maxId = Number(args["max-id"] || 0);
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const logDir = path.resolve(root, args["log-dir"] || path.join("logs", `welcome-bonus-no-action-${runId}`));

if (!apiKey) {
  console.error("VIBECODE_API_KEY is not configured.");
  process.exit(1);
}

if (!args["previous-log-dir"]) {
  console.error("Pass --previous-log-dir=logs/<previous-run> to exclude updated/error and ambiguous contacts from that run.");
  process.exit(1);
}

const previousActions = readIds(path.join(previousLogDir, "actions.csv"));
const previousAmbiguous = readIds(path.join(previousLogDir, "ambiguous.csv"));
const excluded = new Set([...previousActions, ...previousAmbiguous]);
const summary = {
  scanned: 0,
  excludedFromPreviousActions: previousActions.size,
  excludedFromPreviousAmbiguous: previousAmbiguous.size,
  noAction: 0,
  wouldUpdateNow: 0,
  skippedByMaxId: 0,
  reasons: {},
};

await fs.promises.mkdir(logDir, { recursive: true });
const logs = {
  noAction: path.join(logDir, "no-action.csv"),
  wouldUpdateNow: path.join(logDir, "would-update-now.csv"),
  summary: path.join(logDir, "summary.json"),
};
await writeText(logs.noAction, "id,name,email,phone,registeredAt,ordersCount,accrued,used,expired,reason\n");
await writeText(logs.wouldUpdateNow, "id,name,email,phone,registeredAt,ordersCount,accrued,used,expired,reason\n");

console.log("Mode: NO ACTION AUDIT");
console.log(`Previous log dir: ${previousLogDir}`);
console.log(`Log dir: ${logDir}`);
if (maxId) console.log(`Max ID: ${maxId}`);

for await (const contact of iterateContacts()) {
  summary.scanned += 1;
  const id = String(contact.id || contact.ID || "");
  const numericId = Number(id);
  if (maxId && numericId > maxId) {
    summary.skippedByMaxId += 1;
    continue;
  }
  if (!id || excluded.has(id)) continue;

  const action = buildContactWelcomeBonusPatch(contact);
  if (action) {
    summary.wouldUpdateNow += 1;
    await appendCsv(logs.wouldUpdateNow, contact, [action.reason]);
    continue;
  }

  const reason = getNoActionReason(contact);
  summary.noAction += 1;
  summary.reasons[reason] = (summary.reasons[reason] || 0) + 1;
  await appendCsv(logs.noAction, contact, [reason]);
}

await writeText(logs.summary, JSON.stringify({ ...summary, previousLogDir, maxId, limit, logDir }, null, 2));
console.log(JSON.stringify(summary, null, 2));

function buildContactWelcomeBonusPatch(contact) {
  const state = getWelcomeState(contact);
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

function getWelcomeState(contact) {
  return buildWelcomeBonusState({
    accrued: contact[loyaltyFields.balance],
    used: contact[loyaltyFields.welcomeBonusUsed],
    expired: contact[loyaltyFields.welcomeBonusExpired],
    registeredAt: contact[loyaltyFields.registeredAt],
    ordersCount: contact[loyaltyFields.ordersCount],
  });
}

function getNoActionReason(contact) {
  const state = getWelcomeState(contact);
  if (state.reason === "used") return "already used";
  if (state.reason === "expired") return "already expired";
  if (state.reason === "first_order") return "welcome bonus available for first order";
  if (state.reason === "not_registered") return "not registered / no welcome bonus fields";
  if (state.reason === "registered_missing_accrual") return "registered without accrual and no orders";
  if (state.reason === "registered_after_first_order") return "registered after first order";
  if (state.reason === "orders_exist") return "orders exist";
  return state.reason || "no action";
}

async function* iterateContacts() {
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
      }),
    });
    const items = asArray(raw);
    if (!items.length) break;
    for (const item of items) yield item;
    if (items.length < limit) break;
    offset += items.length;
  }
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
  await fs.promises.appendFile(filePath, [...contactRow(contact), ...extraColumns].map(csvCell).join(",") + "\n", "utf8");
}

function readIds(filePath) {
  if (!fs.existsSync(filePath)) return new Set();
  return new Set(
    fs.readFileSync(filePath, "utf8")
      .split(/\r?\n/)
      .slice(1)
      .map((line) => line.split(",")[0].trim())
      .filter(Boolean),
  );
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

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.items)) return value.items;
  if (Array.isArray(value?.contacts)) return value.contacts;
  if (Array.isArray(value?.result)) return value.result;
  return [];
}

async function writeText(filePath, text) {
  await fs.promises.writeFile(filePath, text, "utf8");
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
