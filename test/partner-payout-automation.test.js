import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPartnerPayoutCreationKey,
  buildPartnerPayoutGroups,
  extractEnumerationOptions,
  getMonthKey,
  getPreviousMonthKey,
  getDealStageEntityId,
  isFirstDayOfMonth,
  isLastDayOfMonth,
  mapPartnerPayoutDeal,
  mapPartnerPayoutReportItem,
  mapPartnerPayoutReturnDeal,
  matchesPartnerPayoutDealStage,
  matchesPartnerPayoutBranch,
  sumPartnerPayoutRows,
  isDeliveredPartnerPayoutDeal,
  withPartnerPayoutCreationLock,
} from "../backend/server.js";

test("includes offline payouts without a deal in the report totals", () => {
  const row = mapPartnerPayoutReportItem({
    id: 2777,
    title: "Выплата партнеру: Маша Осипчук",
    begindate: "2026-10-06T00:00:00.000Z",
    opportunity: 300,
    parentId1046: 13,
    ufCrm9_1777549836072: "10000|RUB",
    ufCrm9_1777549859828: 3,
    ufCrm9_1777628079640: "MARIO",
    ufCrm9_1783967051: "Заказ через форму без регистрации.",
    ufCrm9_1791286316223: "9700|RUB",
  });
  assert.equal(row.monthKey, "2026-10");
  assert.equal(row.offlineWithoutRegistration, true);
  assert.equal(row.dealId, null);
  assert.equal(matchesPartnerPayoutBranch(row, ""), true);
  assert.equal(matchesPartnerPayoutBranch(row, "belka"), false);
  assert.equal(matchesPartnerPayoutBranch(row, "unassigned"), true);
  assert.equal(buildPartnerPayoutGroups([row])[0].totals.orders, 1);
  assert.equal(sumPartnerPayoutRows([row]).orderAmount, 10000);
  assert.equal(sumPartnerPayoutRows([row]).payoutAmount, 300);
  assert.equal(row.managerRemainder, 9700);
  assert.equal(buildPartnerPayoutGroups([row])[0].totals.managerRemainder, 9700);
  assert.equal(sumPartnerPayoutRows([row]).managerRemainder, 9700);

  const assignedRow = mapPartnerPayoutReportItem({
    id: 2778,
    begindate: "2026-10-06T00:00:00.000Z",
    opportunity: 300,
    ufCrm9_1777549836072: "10000|RUB",
    ufCrm9_1777628079640: "MARIO",
    ufCrm9_1783967051: "Заказ через форму без регистрации.",
    ufCrm_9_V2SD_BRANCH: "Белка",
  });
  assert.equal(assignedRow.branch, "belka");
  assert.equal(matchesPartnerPayoutBranch(assignedRow, "belka"), true);
  assert.equal(matchesPartnerPayoutBranch(assignedRow, "unassigned"), false);
});

test("reads partnership types dynamically from Bitrix field metadata", () => {
  assert.deepEqual(
    extractEnumerationOptions({
      type: "enumeration",
      items: [
        { ID: "97", VALUE: "Эксперт" },
        { ID: "193", VALUE: "Тренера" },
      ],
    }),
    [
      { id: "97", label: "Эксперт" },
      { id: "193", label: "Тренера" },
    ],
  );
});

test("detects the last calendar day of regular months", () => {
  assert.equal(isLastDayOfMonth(new Date(2026, 3, 29, 12)), false);
  assert.equal(isLastDayOfMonth(new Date(2026, 3, 30, 12)), true);
  assert.equal(isLastDayOfMonth(new Date(2026, 6, 30, 12)), false);
  assert.equal(isLastDayOfMonth(new Date(2026, 6, 31, 12)), true);
});

test("detects February month-end in leap and non-leap years", () => {
  assert.equal(isLastDayOfMonth(new Date(2025, 1, 28, 12)), true);
  assert.equal(isLastDayOfMonth(new Date(2026, 1, 28, 12)), true);
  assert.equal(isLastDayOfMonth(new Date(2028, 1, 28, 12)), false);
  assert.equal(isLastDayOfMonth(new Date(2028, 1, 29, 12)), true);
});

test("builds stable month keys", () => {
  assert.equal(getMonthKey(new Date(2026, 0, 31, 23, 59, 59)), "2026-01");
  assert.equal(getMonthKey(new Date(2026, 11, 1, 0, 0, 0)), "2026-12");
  assert.equal(getPreviousMonthKey(new Date(2026, 7, 1, 12)), "2026-07");
  assert.equal(getPreviousMonthKey(new Date(2026, 0, 1, 12)), "2025-12");
});

test("detects the first day after month close", () => {
  assert.equal(isFirstDayOfMonth(new Date(2026, 6, 31, 12)), false);
  assert.equal(isFirstDayOfMonth(new Date(2026, 7, 1, 12)), true);
});

test("normalizes partner payout creation lock keys", () => {
  assert.equal(buildPartnerPayoutCreationKey(" sofia ", "4085"), "SOFIA|4085.00");
  assert.equal(buildPartnerPayoutCreationKey("SO FIA", 4085.004), "SOFIA|4085.00");
});

test("blocks concurrent partner payouts with the same promo code and amount", async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const first = withPartnerPayoutCreationLock({ code: "SOFIA", orderAmount: 4085 }, async () => {
    await gate;
    return "created";
  });

  await assert.rejects(
    withPartnerPayoutCreationLock({ code: " sofia ", orderAmount: "4085.00" }, async () => "duplicate"),
    (error) => error.status === 409 && /\u0443\u0436\u0435 \u0441\u043e\u0437\u0434\u0430\u0435\u0442\u0441\u044f/i.test(error.publicMessage),
  );

  release();
  assert.equal(await first, "created");
  assert.equal(
    await withPartnerPayoutCreationLock({ code: "SOFIA", orderAmount: 4085 }, async () => "next"),
    "next",
  );
});

test("builds the VibeCode status entity id for deal pipelines", () => {
  assert.equal(getDealStageEntityId(0), "DEAL_STAGE");
  assert.equal(getDealStageEntityId(1), "DEAL_STAGE_1");
  assert.equal(getDealStageEntityId("7"), "DEAL_STAGE_7");
});

test("maps deal stage fields returned by VibeCode", () => {
  assert.deepEqual(
    mapPartnerPayoutDeal({
      id: 26635,
      title: "Заказ 1266599611",
      stageId: "C1:WON",
      stageSemanticId: "S",
      categoryId: 1,
    }),
    {
      id: "26635",
      title: "Заказ 1266599611",
      stageId: "C1:WON",
      stageLabel: "Успешная",
      stageSemanticId: "S",
      categoryId: 1,
    },
  );
});

test("filters partner payouts by deal stage label or id", () => {
  const row = { dealStageId: "C1:WON", dealStageLabel: "Доставлен/Вручен" };
  assert.equal(matchesPartnerPayoutDealStage(row, "доставлен/вручен"), true);
  assert.equal(matchesPartnerPayoutDealStage(row, "C1:WON"), true);
  assert.equal(matchesPartnerPayoutDealStage(row, "Сборка"), false);
  assert.equal(matchesPartnerPayoutDealStage(row, ""), true);
});

test("detects delivered payout deals and maps linked returns", () => {
  assert.equal(isDeliveredPartnerPayoutDeal({ dealStageId: "C1:WON", dealStageLabel: "Доставлен/Вручен" }), true);
  assert.equal(isDeliveredPartnerPayoutDeal({ dealStageId: "C1:PREPARATION", dealStageLabel: "Сборка" }), false);
  assert.deepEqual(
    mapPartnerPayoutReturnDeal({
      id: 52617,
      title: "Заявка на возврат по заказу 1250768551",
      stageId: "C3:NEW",
      categoryId: 3,
      ufCrm_1783342704: "51541",
      ufCrm_1776772743152: "3040|RUB",
    }),
    {
      id: "52617",
      title: "Заявка на возврат по заказу 1250768551",
      stageId: "C3:NEW",
      stageLabel: "C3:NEW",
      stageSemanticId: "",
      categoryId: 3,
      mainOrderId: 51541,
      amount: 3040,
      url: "https://v2sportdress.bitrix24.ru/crm/deal/details/52617/",
    },
  );
});
