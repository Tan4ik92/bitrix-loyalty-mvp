import fs from "node:fs";

loadEnv(".env");

const apiBase = String(process.env.VIBECODE_API_BASE || "https://vibecode.bitrix24.tech").replace(/\/$/, "");
const apiKey = process.env.VIBECODE_API_KEY || "";
const entityTypeId = Number(process.env.BITRIX_PARTNER_PAYOUT_ENTITY_TYPE_ID || 1042);
const orderAmountField = process.env.BITRIX_PARTNER_PAYOUT_ORDER_AMOUNT_FIELD || "ufCrm9_1777549836072";
const managerRemainderField = process.env.BITRIX_PARTNER_PAYOUT_MANAGER_REMAINDER_FIELD || "ufCrm9_1791286316223";
const logPath = process.env.MANAGER_REMAINDER_BACKFILL_LOG || "data/manager-remainder-backfill-20261007.json";

if (!apiKey) throw new Error("VIBECODE_API_KEY is not configured");

const summary = {
  startedAt: new Date().toISOString(),
  entityTypeId,
  formula: `${orderAmountField} - opportunity`,
  scanned: 0,
  updated: 0,
  unchanged: 0,
  errors: [],
};

try {
  const items = asArray(await request(`/v1/items/${entityTypeId}?limit=5000`));
  summary.scanned = items.length;
  for (const listedItem of items) {
    const id = String(listedItem?.id ?? listedItem?.ID ?? "");
    if (!id) continue;
    let item;
    try {
      item = await request(`/v1/items/${entityTypeId}/${encodeURIComponent(id)}`);
    } catch (error) {
      summary.errors.push({ id, error: `READ_FAILED: ${error.message}` });
      continue;
    }
    let orderAmount;
    let partnerReward;
    try {
      orderAmount = requiredMoney(item[orderAmountField], "Сумма заказа со скидкой");
      partnerReward = requiredMoney(item.opportunity ?? item.OPPORTUNITY ?? item.amount ?? item.AMOUNT, "Сумма вознаграждения");
    } catch (error) {
      summary.errors.push({ id, error: error.message });
      continue;
    }
    const expected = roundMoney(orderAmount - partnerReward);
    if (expected < 0) {
      summary.errors.push({ id, error: "NEGATIVE_RESULT_BLOCKED", orderAmount, partnerReward });
      continue;
    }
    const current = money(item[managerRemainderField]);
    if (current === expected) {
      summary.unchanged += 1;
      continue;
    }
    try {
      await request(`/v1/items/${entityTypeId}/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify({ [managerRemainderField]: expected }),
      });
      summary.updated += 1;
    } catch (error) {
      summary.errors.push({ id, error: error.message });
    }
    await delay(120);
  }
} catch (error) {
  summary.fatalError = error.message;
} finally {
  summary.finishedAt = new Date().toISOString();
  summary.ok = !summary.fatalError && summary.errors.length === 0;
  fs.mkdirSync("data", { recursive: true });
  fs.writeFileSync(logPath, JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary));
  if (!summary.ok) process.exitCode = 1;
}

async function request(apiPath, options = {}) {
  const response = await fetch(`${apiBase}${apiPath}`, {
    ...options,
    signal: AbortSignal.timeout(30000),
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "X-Api-Key": apiKey,
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  let payload;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = text; }
  if (!response.ok || payload?.success === false) throw new Error(`Bitrix API ${response.status}: ${JSON.stringify(payload)}`);
  return payload?.data ?? payload;
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.items)) return value.items;
  if (Array.isArray(value?.result)) return value.result;
  return [];
}

function money(value) {
  if (value === null || value === undefined || value === "") return 0;
  const parsed = Number(String(value).split("|")[0].replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(parsed) ? roundMoney(parsed) : 0;
}

function requiredMoney(value, label) {
  if (value === null || value === undefined || value === "") throw new Error(`${label}: поле не заполнено`);
  const parsed = Number(String(value).split("|")[0].replace(/\s/g, "").replace(",", "."));
  if (!Number.isFinite(parsed)) throw new Error(`${label}: некорректное значение`);
  return roundMoney(parsed);
}

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const rawLine of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const index = line.indexOf("=");
    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim().replace(/^["']|["']$/g, "");
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}
