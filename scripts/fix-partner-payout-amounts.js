import fs from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const apply = process.argv.includes("--apply");
const env = Object.fromEntries((await fs.readFile(path.join(root, ".env"), "utf8")).split(/\r?\n/).map((line) => line.match(/^\s*([^#][^=]*)=(.*)$/)).filter(Boolean).map((m) => [m[1].trim(), m[2].trim().replace(/^(['"])(.*)\1$/, "$2")]));
const base = (env.VIBECODE_API_BASE || "https://vibecode.bitrix24.tech").replace(/\/$/, "");
const key = env.VIBECODE_API_KEY;
if (!key) throw new Error("VIBECODE_API_KEY is missing");
const orderAmountField = env.BITRIX_PARTNER_PAYOUT_ORDER_AMOUNT_FIELD || "ufCrm9_1777549836072";
const rewardPercentField = env.BITRIX_PARTNER_PAYOUT_REWARD_PERCENT_FIELD || "ufCrm9_1777549859828";
const dealField = env.BITRIX_PARTNER_PAYOUT_DEAL_PARENT_FIELD || "parentId2";

async function api(url, options = {}) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 45000);
    try {
      const response = await fetch(base + url, {
        ...options,
        headers: { "X-Api-Key": key, Accept: "application/json", "Content-Type": "application/json", ...(options.headers || {}) },
        signal: controller.signal,
      });
      const text = await response.text();
      const payload = text ? JSON.parse(text) : null;
      if (!response.ok) throw new Error(`${response.status} ${JSON.stringify(payload)}`);
      return payload?.data ?? payload?.items ?? payload;
    } catch (error) {
      if (attempt === 4) throw error;
    } finally { clearTimeout(timer); }
  }
}

const cards = await api("/v1/items/1042?limit=5000");
const candidates = cards.filter((card) => Number(card[dealField]) > 0);
const queue = [...candidates], checked = [], errors = [];
await Promise.all(Array.from({ length: 16 }, async () => {
  while (queue.length) {
    const card = queue.shift();
    const dealId = Number(card[dealField]);
    try {
      const deal = await api(`/v1/deals/${dealId}`);
      const currentAmount = money(card[orderAmountField]);
      const dealAmount = money(deal.amount ?? deal.opportunity);
      const percent = number(card[rewardPercentField]);
      const currentPayout = money(card.opportunity ?? card.amount);
      const nextPayout = round(dealAmount * percent / 100);
      if (Math.abs(currentAmount - dealAmount) <= 0.01 && Math.abs(currentPayout - nextPayout) <= 0.01) continue;
      checked.push({ cardId: Number(card.id), dealId, title: card.title, currentAmount, dealAmount, percent, currentPayout, nextPayout });
    } catch (error) { errors.push({ cardId: Number(card.id), dealId, error: error.message }); }
  }
}));
checked.sort((a, b) => a.cardId - b.cardId);

const backupDir = path.join(root, "logs", `partner-payout-fix-${new Date().toISOString().replace(/[:.]/g, "-")}`);
await fs.mkdir(backupDir, { recursive: true });
await fs.writeFile(path.join(backupDir, "plan.json"), JSON.stringify({ generatedAt: new Date().toISOString(), apply, checked, errors }, null, 2));

const updated = [];
if (apply) {
  for (const row of checked) {
    try {
      await api(`/v1/items/1042/${row.cardId}`, {
        method: "PATCH",
        body: JSON.stringify({ [orderAmountField]: `${row.dealAmount}|RUB`, opportunity: row.nextPayout }),
      });
      const verify = await api(`/v1/items/1042/${row.cardId}`);
      const verifiedAmount = money(verify[orderAmountField]);
      const verifiedPayout = money(verify.opportunity ?? verify.amount);
      updated.push({ ...row, verifiedAmount, verifiedPayout, ok: Math.abs(verifiedAmount - row.dealAmount) <= .01 && Math.abs(verifiedPayout - row.nextPayout) <= .01 });
    } catch (error) { errors.push({ cardId: row.cardId, dealId: row.dealId, error: error.message }); }
  }
  await fs.writeFile(path.join(backupDir, "result.json"), JSON.stringify({ finishedAt: new Date().toISOString(), updated, errors }, null, 2));
}

console.log(JSON.stringify({ apply, backupDir, candidates: checked.length, errors: errors.length, updated: updated.length, verified: updated.filter((x) => x.ok).length, checked, updateErrors: errors }, null, 2));

function clean(value) { return String(value ?? "").trim(); }
function number(value) { const result = Number(value); return Number.isFinite(result) ? result : 0; }
function money(value) { return number(clean(value).split("|")[0].replace(",", ".")); }
function round(value) { return Math.round((number(value) + Number.EPSILON) * 100) / 100; }
