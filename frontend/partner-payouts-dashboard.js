const controls = {
  month: document.getElementById("payoutMonth"),
  type: document.getElementById("payoutType"),
  stage: document.getElementById("payoutStage"),
  dealStage: document.getElementById("payoutDealStage"),
  branch: document.getElementById("payoutBranch"),
  paid: document.getElementById("payoutPaid"),
  search: document.getElementById("payoutSearch"),
  refresh: document.getElementById("payoutRefresh"),
  message: document.getElementById("payoutMessage"),
  groups: document.getElementById("payoutGroups"),
};

controls.month.value = new Date().toISOString().slice(0, 7);
controls.refresh.addEventListener("click", loadReport);
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
  controls.groups.textContent = "";
  if (!groups.length) {
    const row = document.createElement("tr");
    row.innerHTML = `<td colspan="9" class="empty-cell">За выбранный период выплат не найдено.</td>`;
    controls.groups.append(row);
    return;
  }

  for (const group of groups) {
    const summary = document.createElement("tr");
    summary.className = "group-row";
    summary.innerHTML = `
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
    const details = document.createElement("tr");
    details.className = "details-row";
    details.hidden = true;
    details.innerHTML = `<td colspan="9">${renderDays(group.days || [])}</td>`;
    summary.querySelector(".row-toggle").addEventListener("click", (event) => {
      details.hidden = !details.hidden;
      event.currentTarget.textContent = details.hidden ? "+" : "-";
    });
    controls.groups.append(summary, details);
  }
}

function renderDays(days) {
  const rows = days.map((row) => `
    <tr>
      <td>${formatDate(row.date)}</td>
      <td>${renderLink(row.title || `#${row.id}`, row.url)}</td>
      <td>${renderDealWithReturns(row)}</td>
      <td>${formatMoney(row.orderAmount)}</td>
      <td>${formatPercent(row.rewardPercent)}</td>
      <td>${formatMoney(row.payoutAmount)}</td>
      <td>${formatMoney(row.managerRemainder)}</td>
      <td>${escapeHtml(row.dealStageLabel || "-")}</td>
      <td>${escapeHtml(row.paidLabel || "-")}</td>
    </tr>
  `).join("");
  return `
    <table class="details-table">
      <colgroup>
        <col class="details-date"><col class="details-payout"><col class="details-deal">
        <col class="details-amount"><col class="details-percent"><col class="details-reward">
        <col class="details-manager-remainder"><col class="details-stage"><col class="details-paid">
      </colgroup>
      <thead><tr><th>Дата</th><th>Карточка выплаты</th><th>Сделка</th><th>Сумма</th><th>%</th><th>ЗП партнеру</th><th>Остаток для менеджера</th><th>Стадия сделки</th><th>Оплачено</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function renderDealWithReturns(row) {
  const deal = row.dealUrl
    ? renderLink(row.dealTitle || `Сделка #${row.dealId}`, row.dealUrl)
    : row.offlineWithoutRegistration
      ? '<span class="offline-sale-label"><span>Без сделки</span><small>Продажа офлайн без регистрации</small></span>'
      : "Без сделки";
  const returns = (row.returnDeals || []).map((item) => `
    <div class="linked-return">
      <span class="linked-return-label">Возврат:</span>
      ${renderLink(item.title || `Сделка #${item.id}`, item.url)}
      <span class="linked-return-stage">${escapeHtml(item.stageLabel || item.stageId || "Стадия не указана")}</span>
      ${Number(item.amount || 0) ? `<span class="linked-return-amount">${formatMoney(item.amount)}</span>` : ""}
    </div>
  `).join("");
  return `${deal}${returns}`;
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
