const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const readline = require("node:readline");
const { spawn } = require("node:child_process");

const [unit, source, userIdRaw] = process.argv.slice(2);
const userId = Number(userIdRaw || process.env.BITRIX_ALERT_USER_ID || 0);
const apiBase = String(process.env.VIBECODE_API_BASE || "https://vibecode.bitrix24.tech").replace(/\/$/, "");
const apiKey = String(process.env.VIBECODE_API_KEY || "");
const throttleMs = Number(process.env.BITRIX_ALERT_THROTTLE_MS || 6 * 60 * 60 * 1000);
const statePath = process.env.BITRIX_ALERT_STATE_PATH || path.resolve("data", `error-alert-${source || "app"}.json`);

if (!unit || !source || !userId || !apiKey) {
  console.error("Usage: node bitrix-error-alert-monitor.js <systemd-unit> <source> <userId>");
  process.exit(2);
}

const alertPatterns = [
  /UNKNOWN_(?:SELECT|FILTER|SORT)_FIELD/i,
  /(?:Invalid|expired) (?:API key|token|credentials)/i,
  /(?:401|403) .*(?:VibeCode|Bitrix|API)/i,
  /Bitrix API (?:4\d\d|5\d\d)/i,
  /VibeCode API failed: (?:4\d\d|5\d\d)/i,
  /Payment status recovery failed/i,
  /Tilda (?:paid-order|order-creation) queue failed/i,
  /Tilda (?:product )?recovery (?:startup |tick )?failed/i,
  /(?:CDEK|track|payment).*(?:failed|timeout|unavailable)/i,
  /(?:ECONNREFUSED|ENOTFOUND|ETIMEDOUT|fetch failed)/i,
];

let state;
const inFlight = new Set();
let stateWriteQueue = Promise.resolve();

async function main() {
  state = await readState();
  const journal = spawn("journalctl", ["-u", unit, "-f", "-n", "0", "-o", "cat"], {
    stdio: ["ignore", "pipe", "inherit"],
  });

  const lines = readline.createInterface({ input: journal.stdout });
  lines.on("line", (line) => void inspectLine(line));
  journal.on("exit", (code) => process.exit(code || 1));
}

if (require.main === module) main().catch((error) => {
  console.error(error);
  process.exit(1);
});

async function inspectLine(line) {
  const message = String(line || "").trim();
  if (!message || !alertPatterns.some((pattern) => pattern.test(message))) return;

  const fingerprint = crypto.createHash("sha256").update(normalize(message)).digest("hex").slice(0, 20);
  // Honor timestamps saved before canonical grouping was introduced.
  const legacyMessages = [message, message.replace(/exact (lead|deal) search failed/i, "$1 search failed"), message.replace(/(?<!exact )(lead|deal) search failed/i, "exact $1 search failed")];
  const legacyKeys = legacyMessages.map((value) => crypto.createHash("sha256").update(normalizeLegacy(value)).digest("hex").slice(0, 20));
  const lastSentAt = Math.max(0, ...[fingerprint, ...legacyKeys].map((key) => Date.parse(state[key] || "") || 0));
  if (Date.now() - lastSentAt < throttleMs) return;
  if (inFlight.has(fingerprint)) return;
  inFlight.add(fingerprint);

  try {
    await sendNotification(message, fingerprint);
    state[fingerprint] = new Date().toISOString();
    try {
      await writeState();
    } catch (error) {
      console.error(`Alert state save failed (notification already sent): ${error.message}`);
    }
  } catch (error) {
    console.error(`Alert delivery failed: ${error.message}`);
  } finally {
    inFlight.delete(fingerprint);
  }
}

async function sendNotification(message, fingerprint) {
  const response = await fetch(`${apiBase}/v1/notifications`, {
    method: "POST",
    signal: AbortSignal.timeout(15000),
    headers: {
      "X-Api-Key": apiKey,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      userId,
      type: "system",
      tag: `v2sd-error-${source}`,
      subTag: fingerprint,
      message: `[V2SD · ${source}] Обнаружена ошибка интеграции:\n${message.slice(0, 1200)}\n\nПовтор такого типа будет скрыт на 6 часов.`,
    }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.success === false) {
    throw new Error(`${response.status} ${JSON.stringify(payload?.error || payload || "")}`);
  }
}

function normalize(message) {
  const code = message.match(/UNKNOWN_(?:SELECT|FILTER|SORT)_FIELD/i)?.[0];
  const detail = message.match(/Unknown (?:select|filter|sort) fields? (.+?) for entity ['"]([^'"]+)['"]/i);
  if (code && detail) {
    const fields = [...detail[1].matchAll(/['"]([^'"]+)['"]/g)].map((match) => match[1]).sort();
    if (fields.length) return `${code.toUpperCase()}:${detail[2]}:${fields.join(",")}`;
  }
  return normalizeLegacy(message);
}

function normalizeLegacy(message) {
  return message
    .replace(/https?:\/\/\S+/gi, "<url>")
    .replace(/\b\d{5,}\b/g, "<number>")
    .replace(/\s+/g, " ")
    .slice(0, 1000);
}

async function readState() {
  try {
    const parsed = JSON.parse(await fs.readFile(statePath, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw error;
  }
}

async function writeState() {
  const write = stateWriteQueue.catch(() => {}).then(persistState);
  stateWriteQueue = write;
  return write;
}

async function persistState() {
  await fs.mkdir(path.dirname(statePath), { recursive: true });
  const tempPath = `${statePath}.tmp`;
  await fs.writeFile(tempPath, JSON.stringify(state, null, 2), "utf8");
  await fs.rename(tempPath, statePath);
}
