import fs from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const env = Object.fromEntries((await fs.readFile(path.join(root, ".env"), "utf8")).split(/\r?\n/).map((line) => line.match(/^\s*([^#][^=]*)=(.*)$/)).filter(Boolean).map((m) => [m[1].trim(), m[2].trim().replace(/^(['"])(.*)\1$/, "$2")]));
const base = (env.VIBECODE_API_BASE || "https://vibecode.bitrix24.tech").replace(/\/$/, "");
const key = env.VIBECODE_API_KEY;
if (!key) throw new Error("VIBECODE_API_KEY is missing");
const f = { amount: "ufCrm9_1777549836072", percent: "ufCrm9_1777549859828", code: "ufCrm9_1777628079640", paid: "ufCrm9_1777630121769", partner: "parentId1046", deal: "parentId2", dealCode: env.BITRIX_DEAL_PROMOCODE_FIELD || "ufCrm_692EB9B815AE9" };

async function api(url) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    try {
      const response = await fetch(base + url, { headers: { "X-Api-Key": key, Accept: "application/json" }, signal: controller.signal });
      const payload = await response.json();
      if (!response.ok) throw new Error(`${response.status} ${JSON.stringify(payload)}`);
      return payload?.data ?? payload?.items ?? payload;
    } catch (error) {
      if (attempt === 3) throw error;
    } finally { clearTimeout(timer); }
  }
}

const cards = await api("/v1/items/1042?limit=5000");
const dealIds = [...new Set(cards.map((x) => +x[f.deal]).filter(Boolean))];
const deals = new Map(), failures = new Map(), queue = [...dealIds];
await Promise.all(Array.from({ length: 20 }, async () => {
  while (queue.length) {
    const id = queue.shift();
    try { deals.set(id, await api(`/v1/deals/${id}`)); } catch (error) { failures.set(id, error.message); }
  }
}));

const clean = (v) => String(v ?? "").trim();
const num = (v) => Number.isFinite(+v) ? +v : 0;
const money = (v) => num(clean(v).split("|")[0].replace(",", "."));
const round = (v) => Math.round((num(v) + Number.EPSILON) * 100) / 100;
const code = (v) => clean(v).toUpperCase().replace(/\s+/g, "");
const rows = cards.map((c) => {
  const dealId = num(c[f.deal]), deal = deals.get(dealId), orderAmount = money(c[f.amount]), dealAmount = money(deal?.amount ?? deal?.opportunity), percent = num(c[f.percent]), payout = money(c.opportunity ?? c.amount), expected = round(orderAmount * percent / 100), cardCode = code(c[f.code]), dealCode = code(deal?.[f.dealCode]), anomalies = [];
  if (!dealId) anomalies.push("NO_LINKED_DEAL"); else if (!deal) anomalies.push("DEAL_NOT_LOADED");
  if (!(orderAmount > 0)) anomalies.push("EMPTY_ORDER_AMOUNT");
  if (!(percent > 0)) anomalies.push("EMPTY_REWARD_PERCENT");
  if (Math.abs(payout - expected) > .01) anomalies.push("PAYOUT_FORMULA_MISMATCH");
  if (deal && Math.abs(orderAmount - dealAmount) > .01) anomalies.push("ORDER_AMOUNT_VS_DEAL_MISMATCH");
  if (!cardCode) anomalies.push("EMPTY_PROMO_CODE");
  if (deal && cardCode && dealCode && cardCode !== dealCode) anomalies.push("PROMO_CODE_MISMATCH");
  if (deal && cardCode && !dealCode) anomalies.push("DEAL_PROMO_CODE_EMPTY");
  return { id: c.id, title: c.title, createdTime: c.createdTime, stageId: c.stageId, dealId, dealTitle: deal?.title || "", dealCategoryId: num(deal?.categoryId), dealStageId: deal?.stageId || "", dealStageSemanticId: deal?.stageSemanticId || "", dealClosed: deal?.closed ?? null, dealIsWon: deal?.isWon ?? null, dealIsLose: deal?.isLose ?? null, cardCode, dealCode, partnerId: num(c[f.partner]), contactId: num(c.contactId), orderAmount, dealAmount, amountDifference: round(orderAmount - dealAmount), percent, payout, expected, payoutDifference: round(payout - expected), paid: clean(c[f.paid]), anomalies };
});
const anomalyCounts = {};
for (const row of rows) for (const a of row.anomalies) anomalyCounts[a] = (anomalyCounts[a] || 0) + 1;
const groups = new Map();
for (const row of rows.filter((r) => r.dealId)) { if (!groups.has(row.dealId)) groups.set(row.dealId, []); groups.get(row.dealId).push(row.id); }
const duplicateDeals = [...groups.entries()].filter(([, ids]) => ids.length > 1).map(([dealId, ids]) => ({ dealId, ids }));
const sum = (rs, field) => round(rs.reduce((s, r) => s + num(r[field]), 0));
const report = { generatedAt: new Date().toISOString(), counts: { cards: rows.length, uniqueLinkedDeals: dealIds.length, loadedDeals: deals.size, loadFailures: failures.size, cardsWithoutDeal: rows.filter((r) => !r.dealId).length, cardsWithAnomalies: rows.filter((r) => r.anomalies.length).length, duplicateDealGroups: duplicateDeals.length }, totals: { cardOrderAmount: sum(rows, "orderAmount"), linkedDealAmount: sum(rows.filter((r) => deals.has(r.dealId)), "dealAmount"), payout: sum(rows, "payout"), expectedPayout: sum(rows, "expected") }, anomalyCounts, duplicateDeals, failures: Object.fromEntries(failures), dealSamples: [...deals.entries()].slice(0, 3).map(([id, d]) => ({ id, amount: d.amount, opportunity: d.opportunity, code: d[f.dealCode], title: d.title })), anomalousRows: rows.filter((r) => r.anomalies.length), rows };
const out = path.join(root, "logs", `partner-payout-audit-${new Date().toISOString().slice(0,10)}`);
await fs.mkdir(out, { recursive: true });
await fs.writeFile(path.join(out, "report.json"), JSON.stringify(report, null, 2));
const cols = ["id","dealId","title","dealTitle","cardCode","dealCode","orderAmount","dealAmount","amountDifference","percent","payout","expected","payoutDifference","paid","stageId","dealStageId","anomalies"];
await fs.writeFile(path.join(out, "anomalies.csv"), [cols.join(";"), ...report.anomalousRows.map((r) => cols.map((k) => `"${String(k === "anomalies" ? r[k].join(",") : r[k] ?? "").replace(/"/g,'""')}"`).join(";"))].join("\n"));
console.log(JSON.stringify({ out, counts: report.counts, totals: report.totals, anomalyCounts, duplicateDeals, failures: report.failures, anomalySample: report.anomalousRows.slice(0, 30) }, null, 2));
