import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const moduleFile = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(moduleFile), "..");
loadEnv(path.join(root, ".env"));
loadEnv(
  process.env.LEGACY_ENV_FILE ||
    path.resolve(root, "..", "api-vibecode-vibe-api-76zodj3ui3hx42zrvd1qrk8lqvszr6u4-8945d5-2", ".env"),
  new Set(["VIBECODE_API_BASE", "VIBECODE_API_KEY"]),
);

const apiBase = String(process.env.VIBECODE_API_BASE || "https://vibecode.bitrix24.tech").replace(/\/$/, "");
const apiKey = process.env.VIBECODE_API_KEY || "";
const outDir = path.resolve(root, "logs", "portal-audit-2026-08-05");

if (!apiKey) throw new Error("VIBECODE_API_KEY is not configured.");

await fs.promises.mkdir(outDir, { recursive: true });

const results = {};
await capture("me", () => request("/v1/me"));
await capture("guide", () => request("/v1/guide"));
await capture("dealFields", () => request("/v1/deals/fields"));
await capture("leadFields", () => request("/v1/leads/fields"));
await capture("contactFields", () => request("/v1/contacts/fields"));
await capture("dealCategories", () => listAll("/v1/deal-categories/search", { filter: {}, select: ["*"], sort: { id: "ASC" }, limit: 100 }));
await capture("dealStatuses", () => listAll("/v1/statuses/search", { filter: {}, select: ["*"], sort: { sort: "ASC" }, limit: 500 }));
await capture("bizprocTemplateFields", () => request("/v1/bizproc-templates/fields"));
await capture("bizprocRobotFields", () => request("/v1/bizproc-robots/fields"));
await capture("bizprocTemplates", () => listAll("/v1/bizproc-templates/search", { filter: {}, select: ["*"], sort: { id: "ASC" }, limit: 100 }));
await capture("bizprocRobots", () => listAll("/v1/bizproc-robots", { limit: 500 }));
await capture("recentDeals", () => listAll("/v1/deals/search", {
  filter: {},
  select: [
    "id", "title", "createdAt", "updatedAt", "stageId", "stageName", "stageSemanticId", "categoryId", "contactId",
    "sourceId", "sourceDescription", "opportunity", "amount", "currency",
    "ufCrm_692EB51A171A6", "ufCrm_692EB518D7FD7", "ufCrm_692EB518ADC14", "ufCrm_692EB5195A5CE",
    "ufCrm_V2SD_ORDER_BONUS_USED", "ufCrm_V2SD_ORDER_DISCOUNT_PERCENT",
  ],
  sort: { id: "DESC" },
  limit: 100,
}, 500));
await capture("recentLeads", () => listAll("/v1/leads/search", {
  filter: {},
  select: ["id", "title", "createdAt", "statusId", "statusName", "sourceId", "sourceDescription", "opportunity", "currency"],
  sort: { id: "DESC" },
  limit: 100,
}, 300));

await writeJson("summary.json", {
  capturedAt: new Date().toISOString(),
  files: Object.fromEntries(Object.entries(results).map(([key, value]) => [key, value.file])),
  counts: Object.fromEntries(Object.entries(results).map(([key, value]) => [key, Array.isArray(value.data) ? value.data.length : null])),
  errors: Object.fromEntries(Object.entries(results).filter(([, value]) => value.error).map(([key, value]) => [key, value.error])),
});

console.log(JSON.stringify({
  outDir,
  counts: Object.fromEntries(Object.entries(results).map(([key, value]) => [key, Array.isArray(value.data) ? value.data.length : null])),
  errors: Object.fromEntries(Object.entries(results).filter(([, value]) => value.error).map(([key, value]) => [key, value.error])),
}, null, 2));

async function capture(name, fn) {
  try {
    const data = await fn();
    const file = `${name}.json`;
    await writeJson(file, data);
    results[name] = { data, file };
  } catch (error) {
    results[name] = { data: null, file: null, error: error.message };
    await writeJson(`${name}.error.json`, { error: error.stack || error.message });
  }
}

async function listAll(apiPath, body, max = 5000) {
  const result = [];
  let offset = Number(body.offset || 0);
  const limit = Number(body.limit || 100);
  while (result.length < max) {
    const raw = await request(apiPath, {
      method: "POST",
      body: JSON.stringify({ ...body, limit, offset }),
    });
    const items = asArray(raw);
    result.push(...items);
    if (items.length < limit) break;
    offset += items.length;
  }
  return result;
}

async function request(apiPath, options = {}) {
  const response = await fetch(`${apiBase}${apiPath}`, {
    ...options,
    headers: {
      "X-Api-Key": apiKey,
      "Content-Type": "application/json; charset=utf-8",
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
  if (Array.isArray(value?.result)) return value.result;
  if (Array.isArray(value?.templates)) return value.templates;
  if (Array.isArray(value?.robots)) return value.robots;
  return [];
}

async function writeJson(file, data) {
  await fs.promises.writeFile(path.join(outDir, file), JSON.stringify(data, null, 2), "utf8");
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
