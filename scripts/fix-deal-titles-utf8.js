import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadEnv(path.join(root, ".env"));
loadEnv(
  process.env.LEGACY_ENV_FILE ||
    path.resolve(root, "..", "api-vibecode-vibe-api-76zodj3ui3hx42zrvd1qrk8lqvszr6u4-8945d5-2", ".env"),
  new Set(["VIBECODE_API_BASE", "VIBECODE_API_KEY"]),
);

const apiBase = String(process.env.VIBECODE_API_BASE || "https://vibecode.bitrix24.tech").replace(/\/$/, "");
const apiKey = process.env.VIBECODE_API_KEY || "";
const ids = process.argv.slice(2).filter(Boolean);
const outIndex = ids.findIndex((value) => value.startsWith("--out="));
const outFile = outIndex >= 0 ? ids.splice(outIndex, 1)[0].slice("--out=".length) : "";
const verifyOnly = ids[0] === "--verify";
if (verifyOnly) ids.shift();

if (!apiKey) throw new Error("VIBECODE_API_KEY is not configured.");
if (!ids.length) throw new Error("Pass deal ids.");

const rows = [];
for (const id of ids) {
  const deal = await request(`/v1/deals/${encodeURIComponent(id)}`);
  const orderNumber = deal.ufCrm_692EB51A171A6;
  const city = deal.ufCrm_692EB518D7FD7;
  if (!orderNumber || !city) {
    rows.push({ id, status: "skipped", title: deal.title, orderNumber, city });
    continue;
  }
  const title = `Заказ ${orderNumber} | ${city}`;
  if (!verifyOnly) {
    await request(`/v1/deals/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ title }),
    });
  }
  const checked = verifyOnly ? deal : await request(`/v1/deals/${encodeURIComponent(id)}`);
  rows.push({ id: Number(id), status: verifyOnly ? "verified" : "updated", title: checked.title, expected: title, orderNumber, city });
}

const output = JSON.stringify(rows, null, 2);
if (outFile) {
  await fs.promises.writeFile(path.resolve(root, outFile), output, "utf8");
} else {
  console.log(output);
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
