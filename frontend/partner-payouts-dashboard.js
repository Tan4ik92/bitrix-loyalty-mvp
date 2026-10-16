const controls = {
  month: document.getElementById("payoutMonth"),
  type: document.getElementById("payoutType"),
  stage: document.getElementById("payoutStage"),
  dealStage: document.getElementById("payoutDealStage"),
  branch: document.getElementById("payoutBranch"),
  paid: document.getElementById("payoutPaid"),
  search: document.getElementById("payoutSearch"),
  refresh: document.getElementById("payoutRefresh"),
  markPaid: document.getElementById("payoutMarkPaid"),
  selectAll: document.getElementById("payoutSelectAll"),
  selectionCount: document.getElementById("payoutSelectionCount"),
  message: document.getElementById("payoutMessage"),
  groups: document.getElementById("payoutGroups"),
};
let currentGroups = [];

controls.month.value = new Date().toISOString().slice(0, 7);
controls.refresh.addEventListener("click", loadReport);
controls.markPaid.addEventListener("click", markSelectedPaid);
controls.selectAll.addEventListener("change", () => {
  for (const checkbox of controls.groups.querySelectorAll(".group-selector:not(:disabled)")) checkbox.checked = controls.selectAll.checked;
  updateSelectionState();
});
for (const control of [controls.month, controls.type, controls.stage, controls.dealStage, controls.branch, controls.paid]) {
  control.addEventListener("change", loadReport);
}
controls.search.addEventListener("keydown", (event) => {
  if (event.key === "Enter") loadReport();
});

loadReport();

async function loadReport() {
  setMessage("Загружаем выплаты из Bitrix24...");
  controls.refresh.disabled = true;
  try {
    const params = new URLSearchParams({
      month: controls.month.value,
      type: controls.type.value,
      stage: controls.stage.value,
      dealStage: controls.dealStage.value,
      branch: controls.branch.value,
      paid: controls.paid.value,
      q: controls.search.value.trim(),
    });
    const response = await fetch(`/api/partner-payouts/report?${params}`, { headers: { Accept: "application/json" } });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "Не удалось загрузить отчет.");
    renderOptions(payload.options || {});
    renderMetrics(payload.totals || {});
    renderGroups(payload.groups || []);
    setMessage(`Обновлено: ${formatDateTime(payload.generatedAt)}`, "success");
  } catch (error) {
    setMessage(error.message, "error");
  } finally {
    controls.refresh.disabled = false;
  }
}

function renderOptions(options) {
  fillSelect(controls.type, options.types || [], controls.type.value);
  fillSelect(controls.stage, options.stages || [], controls.stage.value);
  fillSelect(controls.dealStage, options.dealStages || [], controls.dealStage.value);
}

function fillSelect(select, values, selected) {
  const current = selected || select.value;
  select.textContent = "";
  select.append(new Option("Все", ""));
  for (const value of values) select.append(new Option(value, value));
  select.value = [...select.options].some((option) => option.value === current) ? current : "";
}

function renderMetrics(totals) {
  document.getElementById("metricGroups").textContent = formatNumber(totals.groups);
  document.getElementById("metricOrders").textContent = formatNumber(totals.orders);
  document.getElementById("metricOrderAmount").textContent = formatMoney(totals.orderAmount);
  document.getElementById("metricPayoutAmount").textContent = formatMoney(totals.payoutAmount);
  document.getElementById("metricUnpaidAmount").textContent = formatMoney(totals.unpaidAmount);
  document.getElementById("metricPaidAmount").textContent = formatMoney(totals.paidAmount);
}

function renderGroups(groups) {
  currentGroups = groups;
  controls.groups.textContent = "";
  controls.selectAll.checked = false;
  controls.selectAll.indeterminate = false;
  updateSelectionState();
  if (!groups.length) {
    const row = document.createElement("tr");
    row.innerHTML = `<td colspan="10" class="empty-cell">За выбранный период выплат не найдено.</td>`;
    controls.groups.append(row);
    return;
  }

  for (const group of groups) {
    const payableIds = (group.days || []).filter(isPayableRow).map((row) => String(row.id));
    const summary = document.createElement("tr");
    summary.className = "group-row";
    summary.innerHTML = `
      <td class="selection-column"><input class="group-selector" type="checkbox" aria-label="Выбрать выплаты ${escapeHtml(group.code || "")}" ${payableIds.length ? "" : "disabled"}></td>
      <td><button class="row-toggle" type="button">+</button><b>${escapeHtml(group.code || "-")}</b></td>
      <td>${renderLink(group.partnerName || "-", group.partnerUrl)}</td>
      <td>${escapeHtml(group.partnershipTypeLabel || "-")}</td>
      <td>${formatNumber(group.totals.orders)}</td>
      <td>${formatMoney(group.totals.orderAmount)}</td>
      <td>${formatPercent(group.rewardPercent)}</td>
      <td><b>${formatMoney(group.totals.payoutAmount)}</b></td>
      <td>${formatMoney(group.totals.managerRemainder)}</td>
      <td>${formatMoney(group.totals.unpaidAmount)}</td>
    `;
    const details = document.createElement("tbody");
    details.innerHTML = renderDays(group.days || []);
    const detailRows = [...details.children];
    detailRows.forEach((row) => { row.hidden = true; });
    const selector = summary.querySelector(".group-selector");
    selector.dataset.ids = payableIds.join(",");
    selector.addEventListener("change", updateSelectionState);
    summary.querySelector(".row-toggle").addEventListener("click", (event) => {
      const opening = detailRows[0]?.hidden;
      detailRows.forEach((row) => { row.hidden = !opening; });
      event.currentTarget.textContent = opening ? "-" : "+";
    });
    controls.groups.append(summary, ...detailRows);
  }
}

function isPayableRow(row) {
  return !row.isPaid && String(row.stageId || "").toUpperCase() !== "DT1042_17:FAIL";
}

function selectedPayoutIds() {
  return [...controls.groups.querySelectorAll(".group-selector:checked")]
    .flatMap((checkbox) => checkbox.dataset.ids.split(","))
    .filter(Boolean);
}

function updateSelectionState() {
  const enabled = [...controls.groups.querySelectorAll(".group-selector:not(:disabled)")];
  const selected = enabled.filter((checkbox) => checkbox.checked);
  const payoutIds = selectedPayoutIds();
  controls.selectionCount.textContent = `Выбрано выплат: ${payoutIds.length}`;
  controls.markPaid.disabled = payoutIds.length === 0;
  controls.selectAll.disabled = enabled.length === 0;
  controls.selectAll.checked = enabled.length > 0 && selected.length === enabled.length;
  controls.selectAll.indeterminate = selected.length > 0 && selected.length < enabled.length;
}

async function markSelectedPaid() {
  const ids = selectedPayoutIds();
  if (!ids.length) return;
  if (!window.confirm(`Перенести выбранные выплаты (${ids.length}) на стадию «Выплачено»?`)) return;
  controls.markPaid.disabled = true;
  controls.refresh.disabled = true;
  setMessage("Обновляем выбранные выплаты в Bitrix24...");
  try {
    const response = await fetch("/api/partner-payouts/mark-paid", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "Не удалось обновить выплаты.");
    const moved = Array.isArray(payload.moved) ? payload.moved.length : 0;
    const failed = Array.isArray(payload.errors) ? payload.errors.length : 0;
    await loadReport();
    setMessage(failed ? `Выплачено: ${moved}. Ошибок: ${failed}.` : `Выплаты отмечены как оплаченные: ${moved}.`, failed ? "error" : "success");
  } catch (error) {
    setMessage(error.message, "error");
  } finally {
    controls.markPaid.disabled = selectedPayoutIds().length === 0;
    controls.refresh.disabled = false;
  }
}

function renderDays(days) {
  return `<tr class="detail-line detail-heading"><td></td><th>Дата</th><th>Карточка выплаты</th><th colspan="2">Сделка / Стадия</th><th>Сумма</th><th>%</th><th>ЗП партнеру</th><th>Остаток для менеджера</th><th></th></tr>` +
    days.map((row) => `
      <tr class="detail-line">
        <td></td>
        <td>${formatDate(row.date)}</td>
        <td>${renderPayoutCardLink(row)}</td>
        <td colspan="2">${renderPayoutDeal(row)}<span class="deal-stage">${escapeHtml(row.dealStageLabel || "-")}</span></td>
        <td>${formatMoney(row.orderAmount)}</td>
        <td>${formatPercent(row.rewardPercent)}</td>
        <td>${formatMoney(row.payoutAmount)}</td>
        <td>${formatMoney(row.managerRemainder)}</td>
        <td></td>
      </tr>
    `).join("");
}

function renderPayoutDeal(row) {
  if (row.dealUrl) {
    const title = row.dealTitle || `Сделка #${row.dealId}`;
    return `<a class="bitrix-link deal-link" href="${escapeHtml(row.dealUrl)}" title="${escapeHtml(title)}" target="_blank" rel="noopener">${escapeHtml(title)}</a>`;
  }
  if (row.offlineWithoutRegistration) {
    return '<span class="offline-sale-label"><span>Без сделки</span><small>Продажа офлайн без регистрации</small></span>';
  }
  return "Без сделки";
}

function renderPayoutCardLink(row) {
  if (!row.url) return "Карточка выплаты";
  return `<a class="bitrix-link payout-card-link" href="${escapeHtml(row.url)}" target="_blank" rel="noopener">Карточка выплаты</a>`;
}

function renderLink(text, href) {
  if (!href) return escapeHtml(text);
  return `<a class="bitrix-link" href="${escapeHtml(href)}" target="_blank" rel="noopener">${escapeHtml(text)}</a>`;
}

function setMessage(message, kind = "") {
  controls.message.textContent = message;
  controls.message.className = `form-message ${kind}`.trim();
}

function formatMoney(value) {
  return `${formatNumber(Number(value || 0), 2)} ₽`;
}

function formatNumber(value, digits = 0) {
  return Number(value || 0).toLocaleString("ru-RU", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function formatPercent(value) {
  return `${formatNumber(value, 2).replace(/,00$/, "")}%`;
}

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("ru-RU");
}

function formatDateTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString("ru-RU");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
