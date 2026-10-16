let catalogProducts = [];
let catalogProductsByName = new Map();
const amountAdjustmentProduct = {
  id: "v2sd-amount-adjustment",
  name: "Выравнивание суммы покупок",
  price: 0,
  currency: "RUB",
  source: "manual-adjustment",
  manualPrice: true,
};
const employeesByBranch = new Map();
const productSearchTimers = new WeakMap();

const demoProducts = [
  { id: "1", name: "Товар 1", price: 2500 },
  { id: "2", name: "Товар 2", price: 4700 },
  { id: "3", name: "Товар 3", price: 9900 },
];

const state = {
  register: { clientId: null, totalPurchases: 0, bonusBalance: 300, discountPercent: 0, promo: null, certificate: null, certificate2: null },
  find: { clientId: null, totalPurchases: 0, bonusBalance: 0, discountPercent: 0, promo: null, certificate: null, certificate2: null },
  messenger: { clientId: null, totalPurchases: 0, bonusBalance: 0, discountPercent: 0, promo: null, certificate: null, certificate2: null },
  preorder: { clientId: null, totalPurchases: 0, bonusBalance: 0, discountPercent: 0, promo: null, certificate: null, certificate2: null },
};

document.querySelectorAll(".tab").forEach((button) => {
  button.addEventListener("click", () => openTab(button.dataset.tab));
});
document.querySelectorAll("[data-add-row]").forEach((button) => {
  button.addEventListener("click", () => addOrderRow(button.dataset.addRow));
});
document.querySelectorAll("[data-create-order]").forEach((button) => {
  button.addEventListener("click", () => createOrder(button.dataset.createOrder));
});
document.querySelectorAll("[data-apply-promo]").forEach((button) => {
  button.addEventListener("click", () => applyPromocode(button.dataset.applyPromo));
});
document.querySelectorAll("[data-apply-certificate]").forEach((button) => {
  button.addEventListener("click", () => applyCertificate(button.dataset.applyCertificate, Number(button.dataset.certificateSlot || 1)));
});
document.querySelectorAll("[data-add-certificate]").forEach((button) => {
  button.addEventListener("click", () => showSecondCertificate(button.dataset.addCertificate));
});
["register", "find", "messenger", "preorder"].forEach((mode) => {
  document.getElementById(`${mode}Branch`)?.addEventListener("change", () => loadResponsibleEmployees(mode));
  document.getElementById(`${mode}PromoCode`)?.addEventListener("input", () => clearPromocode(mode));
  document.getElementById(`${mode}CertificateCodeInput`)?.addEventListener("input", () => clearCertificate(mode, 1));
  document.getElementById(`${mode}CertificateAmount`)?.addEventListener("input", calculateTotals);
  document.getElementById(`${mode}Certificate2CodeInput`)?.addEventListener("input", () => clearCertificate(mode, 2));
  document.getElementById(`${mode}Certificate2Amount`)?.addEventListener("input", calculateTotals);
});
document.querySelectorAll('input[id$="UseBonuses"], input[id$="BonusesToUse"]').forEach((input) => {
  input.addEventListener("input", calculateTotals);
  input.addEventListener("change", calculateTotals);
});
document.getElementById("registerForm").addEventListener("submit", registerClient);
document.getElementById("searchForm").addEventListener("submit", findClient);
document.getElementById("messengerSearchForm")?.addEventListener("submit", findMessengerClient);
document.getElementById("partnerPayoutButton")?.addEventListener("click", createPartnerPayout);
document.getElementById("partnerPayoutBranch")?.addEventListener("change", () => loadResponsibleEmployees("partnerPayout"));
document.addEventListener("mousedown", (event) => {
  document.querySelectorAll(".product-row").forEach((row) => {
    if (!row.contains(event.target)) closeProductSuggestions(row);
  });
});

function openTab(tabName) {
  document.querySelectorAll(".tab-content").forEach((item) => item.classList.toggle("active", item.id === tabName));
  document.querySelectorAll(".tab").forEach((item) => item.classList.toggle("active", item.dataset.tab === tabName));
  calculateTotals();
}

function formatMoney(value) {
  return Math.round(Number(value) || 0).toLocaleString("ru-RU");
}

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString("ru-RU");
}

function formatDateTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString("ru-RU");
}

async function registerClient(event) {
  event.preventDefault();
  const button = document.getElementById("registerButton");
  const firstName = document.getElementById("regFirstName").value.trim();
  const lastName = document.getElementById("regLastName").value.trim();
  const phone = document.getElementById("regPhone").value.trim();
  const email = document.getElementById("regEmail").value.trim();
  hideSiteCompletionLink();

  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    setRegisterMessage("Введите корректный email, например client@mail.ru.", "error");
    return;
  }

  setRegisterMessage("Создаём контакт в Bitrix24...");
  button.disabled = true;

  try {
    const response = await fetch("/api/contacts", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ firstName, lastName, phone, email }),
    });
    const payload = await readApiResponse(response, "\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u0441\u043e\u0437\u0434\u0430\u0442\u044c \u043a\u043e\u043d\u0442\u0430\u043a\u0442");
    if (!response.ok) throw new Error(payload.error || "Не удалось создать контакт");
    renderRegisteredContact(payload.contact);
    const siteMessage = formatSiteRegistrationMessage(payload.siteRegistration);
    renderSiteCompletionLink(payload.siteRegistration);
    setRegisterMessage(
      `${payload.action === "created_contact" ? "Контакт создан в Bitrix24." : "Контакт уже был в Bitrix24, данные обновлены."}${siteMessage}`,
      payload.siteRegistration && !payload.siteRegistration.ok ? "error" : "success",
    );
  } catch (error) {
    setRegisterMessage(error.message, "error");
  } finally {
    button.disabled = false;
  }
}

async function findClient(event) {
  event.preventDefault();
  const query = document.getElementById("searchValue").value.trim();
  const button = document.getElementById("searchButton");
  setSearchMessage("Ищем контакт в Bitrix24…");
  button.disabled = true;

  try {
    const response = await fetch(`/api/contacts/search?q=${encodeURIComponent(query)}`, {
      headers: { Accept: "application/json" },
    });
    const payload = await readApiResponse(response, "\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u0432\u044b\u043f\u043e\u043b\u043d\u0438\u0442\u044c \u043f\u043e\u0438\u0441\u043a");
    if (!response.ok) throw new Error(payload.error || "Не удалось выполнить поиск");
    const contacts = Array.isArray(payload.contacts) && payload.contacts.length
      ? payload.contacts.filter(Boolean)
      : payload.contact ? [payload.contact] : [];
    if (!contacts.length) {
      resetFoundClient();
      setSearchMessage("Контакт не найден.", "error");
      return;
    }

    renderContact(contacts[0]);
    renderContactMatches(contacts);
    setSearchMessage(
      contacts.length > 1 ? `Найдено совпадений: ${contacts.length}. Выберите нужный контакт.` : "Контакт найден.",
      "success",
    );
  } catch (error) {
    resetFoundClient();
    setSearchMessage(error.message, "error");
  } finally {
    button.disabled = false;
  }
}

async function findMessengerClient(event) {
  event.preventDefault();
  const query = document.getElementById("messengerSearchValue").value.trim();
  const button = document.getElementById("messengerSearchButton");
  setSearchMessage("Ищем контакт в Bitrix24…", "", "messenger");
  button.disabled = true;
  try {
    const response = await fetch(`/api/contacts/search?q=${encodeURIComponent(query)}`, { headers: { Accept: "application/json" } });
    const payload = await readApiResponse(response, "Не удалось выполнить поиск");
    if (!response.ok) throw new Error(payload.error || "Не удалось выполнить поиск");
    const contacts = Array.isArray(payload.contacts) && payload.contacts.length ? payload.contacts.filter(Boolean) : payload.contact ? [payload.contact] : [];
    if (!contacts.length) {
      resetMessengerClient();
      setSearchMessage("Контакт не найден.", "error", "messenger");
      return;
    }
    renderContact(contacts[0]);
    renderContactMatches(contacts, "messenger");
    setSearchMessage(contacts.length > 1 ? `Найдено совпадений: ${contacts.length}. Выберите нужный контакт.` : "Контакт найден.", "success", "messenger");
  } catch (error) {
    resetMessengerClient();
    setSearchMessage(error.message, "error", "messenger");
  } finally {
    button.disabled = false;
  }
}

function renderContact(contact) {
  applyContactToMode("find", contact);
  applyContactToMode("messenger", contact);
  applyContactToMode("preorder", contact);

  renderBitrixLink(document.getElementById("findClientName"), contact.fullName || `Контакт #${contact.id}`, contact.url);
  document.getElementById("findClientContact").textContent = formatContactCommunications(contact)
    || "Телефон и email не указаны";
  renderBitrixLink(document.getElementById("findClientId"), `ID ${contact.id}`, contact.url);
  document.getElementById("findClientId").hidden = false;
  document.getElementById("findDiscountCard").textContent = `${state.find.discountPercent}%`;
  document.getElementById("findPurchasesCard").textContent = `${formatMoney(state.find.totalPurchases)} ₽`;
  document.getElementById("findBonusesCard").textContent = `${formatMoney(state.find.bonusBalance)} ₽`;
  document.getElementById("findOrdersCount").textContent = contact.loyalty.ordersCount ?? "—";
  document.getElementById("findPurchaseSum").textContent = moneyOrDash(contact.loyalty.purchaseSum);
  document.getElementById("findLastOrder").textContent = contact.loyalty.lastOrderNumber || "—";
  document.getElementById("findLastOrderDate").textContent = formatDate(contact.loyalty.lastOrderDate);
  document.getElementById("findLastOrderSum").textContent = moneyOrDash(contact.loyalty.lastOrderSum);
  document.getElementById("findAvailableBonusTotal").textContent = moneyOrDash(state.find.bonusBalance);
  document.getElementById("findWelcomeBonusAvailable").textContent = moneyOrDash(contact.loyalty.welcomeBonus?.available ?? 0);
  document.getElementById("findBirthdayBonusAvailable").textContent = moneyOrDash(contact.loyalty.birthdayBonus?.available ?? 0);
  const birthdayExpiresAt = contact.loyalty.birthdayBonus?.expiresAt || null;
  const birthdayExpiresRow = document.getElementById("findBirthdayBonusExpiresRow");
  birthdayExpiresRow.hidden = !birthdayExpiresAt;
  document.getElementById("findBirthdayBonusExpiresAt").textContent = birthdayExpiresAt ? formatDate(birthdayExpiresAt) : "—";
  renderClientMode("messenger", contact);
  renderPreorderClient(contact);
  calculateTotals();
}

function renderClientMode(mode, contact) {
  renderBitrixLink(document.getElementById(`${mode}ClientName`), contact.fullName || `Контакт #${contact.id}`, contact.url);
  document.getElementById(`${mode}ClientContact`).textContent = formatContactCommunications(contact) || "Телефон и email не указаны";
  renderBitrixLink(document.getElementById(`${mode}ClientId`), `ID ${contact.id}`, contact.url);
  document.getElementById(`${mode}ClientId`).hidden = false;
  document.getElementById(`${mode}DiscountCard`).textContent = `${state[mode].discountPercent}%`;
  document.getElementById(`${mode}PurchasesCard`).textContent = `${formatMoney(state[mode].totalPurchases)} ₽`;
  document.getElementById(`${mode}BonusesCard`).textContent = `${formatMoney(state[mode].bonusBalance)} ₽`;
  document.getElementById(`${mode}OrdersCount`).textContent = contact.loyalty.ordersCount ?? "—";
  document.getElementById(`${mode}AccruedTotal`).textContent = moneyOrDash(contact.loyalty.accruedTotal);
  document.getElementById(`${mode}SpentTotal`).textContent = moneyOrDash(contact.loyalty.spentTotal);
  document.getElementById(`${mode}LastOrder`).textContent = contact.loyalty.lastOrderNumber || "—";
  document.getElementById(`${mode}LastOrderDate`).textContent = formatDate(contact.loyalty.lastOrderDate);
  document.getElementById(`${mode}LastOrderSum`).textContent = moneyOrDash(contact.loyalty.lastOrderSum);
}

function applyContactToMode(mode, contact) {
  state[mode].clientId = contact.id;
  state[mode].totalPurchases = contact.loyalty.purchaseSum || 0;
  state[mode].bonusBalance = getAvailableBonusBalance(contact.loyalty);
  state[mode].discountPercent = contact.loyalty.discountPercent || 0;
  state[mode].promo = null;
}

function renderPreorderClient(contact) {
  renderBitrixLink(document.getElementById("preorderClientName"), contact.fullName || `Контакт #${contact.id}`, contact.url);
  const contactNode = document.getElementById("preorderClientContact");
  if (contactNode) contactNode.textContent = formatContactCommunications(contact) || "Телефон и email не указаны";
  renderBitrixLink(document.getElementById("preorderClientId"), `ID ${contact.id}`, contact.url);
  const idNode = document.getElementById("preorderClientId");
  if (idNode) idNode.hidden = false;
}

function renderContactMatches(contacts, mode = "find") {
  const box = document.getElementById(mode === "find" ? "contactMatches" : `${mode}ContactMatches`);
  if (!box) return;
  box.textContent = "";
  if (!Array.isArray(contacts) || contacts.length <= 1) {
    box.hidden = true;
    return;
  }

  const title = document.createElement("div");
  title.className = "contact-matches-title";
  title.textContent = "Найдено несколько контактов";
  box.append(title);

  contacts.forEach((contact, index) => {
    const row = document.createElement("div");
    row.className = "contact-match";
    if (index === 0) row.classList.add("selected");

    const summary = document.createElement("div");
    summary.className = "contact-match-summary";

    const name = document.createElement("a");
    name.className = "bitrix-link contact-match-name";
    name.href = contact.url || "#";
    name.target = "_blank";
    name.rel = "noopener";
    name.textContent = contact.fullName || `Контакт #${contact.id}`;
    if (!contact.url) name.removeAttribute("href");

    const details = document.createElement("span");
    details.textContent = [
      `ID ${contact.id}`,
      formatContactCommunications(contact).replace(/\n/g, " · "),
      contact.loyalty?.discountPercent ? `скидка ${contact.loyalty.discountPercent}%` : "",
      contact.loyalty?.purchaseSum ? `покупки ${formatMoney(contact.loyalty.purchaseSum)} ₽` : "",
    ].filter(Boolean).join(" · ");

    summary.append(name, details);

    const choose = document.createElement("button");
    choose.type = "button";
    choose.className = "contact-match-button";
    choose.textContent = index === 0 ? "Выбран" : "Выбрать";
    choose.addEventListener("click", () => {
      renderContact(contact);
      box.querySelectorAll(".contact-match").forEach((item) => item.classList.remove("selected"));
      box.querySelectorAll(".contact-match-button").forEach((button) => { button.textContent = "Выбрать"; });
      row.classList.add("selected");
      choose.textContent = "Выбран";
      setSearchMessage(`Выбран контакт #${contact.id}.`, "success", mode);
    });

    row.append(summary, choose);
    box.append(row);
  });

  box.hidden = false;
}

function renderRegisteredContact(contact) {
  state.register.clientId = contact.id;
  state.register.totalPurchases = contact.loyalty.purchaseSum || 0;
  state.register.bonusBalance = getAvailableBonusBalance(contact.loyalty) || 300;
  state.register.discountPercent = contact.loyalty.discountPercent || 0;
  state.register.promo = null;

  document.getElementById("registerClientName").textContent = contact.fullName || `Контакт #${contact.id}`;
  document.getElementById("registerClientContact").textContent = formatContactCommunications(contact) || `ID ${contact.id}`;
  document.getElementById("registerDiscountCard").textContent = `${state.register.discountPercent}%`;
  document.getElementById("registerPurchasesCard").textContent = `${formatMoney(state.register.totalPurchases)} ₽`;
  document.getElementById("registerBonusesCard").textContent = `${formatMoney(state.register.bonusBalance)} ₽`;
  calculateTotals();
}

function formatContactCommunications(contact) {
  const phones = uniqueStrings(contact.phones && contact.phones.length ? contact.phones : [contact.phone]);
  const emails = uniqueStrings(contact.emails && contact.emails.length ? contact.emails : [contact.email]);
  return [
    phones.length ? `Телефоны: ${phones.join(", ")}` : "",
    emails.length ? `Email: ${emails.join(", ")}` : "",
  ].filter(Boolean).join("\n");
}

function uniqueStrings(values) {
  const seen = new Set();
  return (values || [])
    .map((value) => String(value || "").trim())
    .filter((value) => {
      const key = value.toLowerCase();
      if (!value || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function resetFoundClient() {
  state.find = { clientId: null, totalPurchases: 0, bonusBalance: 0, discountPercent: 0, promo: null };
  state.preorder = { clientId: null, totalPurchases: 0, bonusBalance: 0, discountPercent: 0, promo: null };
  document.getElementById("findClientName").textContent = "Клиент не выбран";
  document.getElementById("findClientContact").textContent = "Введите телефон или email";
  document.getElementById("findClientId").hidden = true;
  clearContactMatches();
  resetPreorderClient();
  ["findDiscountCard", "findPurchasesCard", "findBonusesCard"].forEach((id, index) => {
    document.getElementById(id).textContent = index === 0 ? "0%" : "0 ₽";
  });
  ["findOrdersCount", "findPurchaseSum", "findLastOrder", "findLastOrderDate", "findLastOrderSum", "findAvailableBonusTotal",
    "findWelcomeBonusAvailable", "findBirthdayBonusAvailable", "findBirthdayBonusExpiresAt"]
    .forEach((id) => { document.getElementById(id).textContent = "—"; });
  document.getElementById("findBirthdayBonusExpiresRow").hidden = true;
  calculateTotals();
}

function resetMessengerClient() {
  state.messenger = { clientId: null, totalPurchases: 0, bonusBalance: 0, discountPercent: 0, promo: null, certificate: null, certificate2: null };
  document.getElementById("messengerClientName").textContent = "Клиент не выбран";
  document.getElementById("messengerClientContact").textContent = "Введите телефон или email";
  document.getElementById("messengerClientId").hidden = true;
  const matches = document.getElementById("messengerContactMatches");
  if (matches) { matches.textContent = ""; matches.hidden = true; }
  ["messengerDiscountCard", "messengerPurchasesCard", "messengerBonusesCard"].forEach((id, index) => {
    document.getElementById(id).textContent = index === 0 ? "0%" : "0 ₽";
  });
  ["messengerOrdersCount", "messengerAccruedTotal", "messengerSpentTotal", "messengerLastOrder", "messengerLastOrderDate", "messengerLastOrderSum"]
    .forEach((id) => { document.getElementById(id).textContent = "—"; });
  calculateTotals();
}

function resetPreorderClient() {
  const name = document.getElementById("preorderClientName");
  const contact = document.getElementById("preorderClientContact");
  const id = document.getElementById("preorderClientId");
  if (name) name.textContent = "Клиент не выбран";
  if (contact) contact.textContent = "Выберите клиента во вкладке поиска";
  if (id) id.hidden = true;
}

function clearContactMatches() {
  const box = document.getElementById("contactMatches");
  if (!box) return;
  box.textContent = "";
  box.hidden = true;
}

function moneyOrDash(value) {
  return value === null || value === undefined || value === "" ? "—" : `${formatMoney(value)} ₽`;
}

function getAvailableBonusBalance(loyalty = {}) {
  const welcome = loyalty.welcomeBonus && typeof loyalty.welcomeBonus === "object"
    ? Number(loyalty.welcomeBonus.available || 0)
    : null;
  const birthday = loyalty.birthdayBonus && typeof loyalty.birthdayBonus === "object"
    ? Number(loyalty.birthdayBonus.available || 0)
    : null;
  if (welcome !== null || birthday !== null) {
    return Math.max(0, (welcome || 0) + (birthday || 0));
  }
  const balance = Number(loyalty.balance || 0);
  const computed = Math.max(0, Number(loyalty.accruedTotal || 0) - Number(loyalty.spentTotal || 0));
  return balance > 0 ? balance : computed;
}

function setSearchMessage(message, kind = "", mode = "find") {
  const element = document.getElementById(mode === "find" ? "searchMessage" : `${mode}SearchMessage`);
  element.textContent = message;
  element.className = `form-message ${kind}`.trim();
}

function setRegisterMessage(message, kind = "") {
  const element = document.getElementById("registerMessage");
  element.textContent = message;
  element.className = `form-message ${kind}`.trim();
}

async function readApiResponse(response, fallbackMessage) {
  const text = await response.text();
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    try {
      return normalizeApiPayload(text ? JSON.parse(text) : {}, fallbackMessage);
    } catch {
      return { error: fallbackMessage };
    }
  }
  if (text && !text.trim().startsWith("<")) return { error: text.trim() };
  if (response.status === 401) return { error: "\u0421\u0435\u0441\u0441\u0438\u044f \u0434\u043e\u0441\u0442\u0443\u043f\u0430 \u043a \u0444\u043e\u0440\u043c\u0435 \u0438\u0441\u0442\u0435\u043a\u043b\u0430. \u041e\u0431\u043d\u043e\u0432\u0438\u0442\u0435 \u0441\u0442\u0440\u0430\u043d\u0438\u0446\u0443 \u0438 \u0432\u043e\u0439\u0434\u0438\u0442\u0435 \u0441\u043d\u043e\u0432\u0430." };
  if (response.status >= 500) return { error: "\u0421\u0435\u0440\u0432\u0435\u0440 \u0432\u0440\u0435\u043c\u0435\u043d\u043d\u043e \u043d\u0435 \u043e\u0442\u0432\u0435\u0447\u0430\u0435\u0442. \u041f\u043e\u043f\u0440\u043e\u0431\u0443\u0439\u0442\u0435 \u0435\u0449\u0435 \u0440\u0430\u0437." };
  return { error: fallbackMessage };
}

function normalizeApiPayload(payload, fallbackMessage) {
  if (!payload || typeof payload !== "object") return {};
  if (payload.error && typeof payload.error !== "string") {
    payload.error = payload.error.message || payload.error.code || fallbackMessage;
  }
  return payload;
}

function setOrderMessage(mode, message, kind = "", link = null) {
  const element = document.getElementById(`${mode}OrderMessage`);
  if (!element) return;
  setLinkedMessage(element, message, kind, link);
}

function setPartnerPayoutMessage(message, kind = "", link = null) {
  const element = document.getElementById("partnerPayoutMessage");
  if (!element) return;
  setLinkedMessage(element, message, kind, link);
}

function setLinkedMessage(element, message, kind = "", link = null) {
  element.textContent = message;
  element.className = `form-message order-message ${kind}`.trim();
  if (!link?.href) return;
  element.append(" ");
  const anchor = document.createElement("a");
  anchor.href = link.href;
  anchor.target = "_blank";
  anchor.rel = "noopener";
  anchor.className = "bitrix-link";
  anchor.textContent = link.text || "\u041e\u0442\u043a\u0440\u044b\u0442\u044c";
  element.append(anchor);
}

function renderBitrixLink(element, text, href) {
  if (!element) return;
  element.textContent = "";
  if (!href) {
    element.textContent = text;
    return;
  }
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.target = "_blank";
  anchor.rel = "noopener";
  anchor.className = "bitrix-link";
  anchor.textContent = text;
  element.append(anchor);
}

async function createPartnerPayout() {
  const button = document.getElementById("partnerPayoutButton");
  const result = document.getElementById("partnerPayoutResult");
  const amount = Number(document.getElementById("partnerPayoutAmount")?.value || 0);
  const code = document.getElementById("partnerPayoutCode")?.value.trim() || "";
  const branch = document.getElementById("partnerPayoutBranch")?.value || "";
  const assignedById = Number(document.getElementById("partnerPayoutResponsible")?.value || 0);
  const comment = document.getElementById("partnerPayoutComment")?.value.trim() || "";

  if (!(amount > 0)) {
    setPartnerPayoutMessage("\u0423\u043a\u0430\u0436\u0438\u0442\u0435 \u0441\u0443\u043c\u043c\u0443 \u0437\u0430\u043a\u0430\u0437\u0430.", "error");
    if (result) result.hidden = true;
    return;
  }
  if (!code) {
    setPartnerPayoutMessage("\u0412\u0432\u0435\u0434\u0438\u0442\u0435 \u043f\u0440\u043e\u043c\u043e\u043a\u043e\u0434.", "error");
    if (result) result.hidden = true;
    return;
  }
  if (!branch || !assignedById) {
    setPartnerPayoutMessage("Выберите филиал и ответственного сотрудника.", "error");
    if (result) result.hidden = true;
    return;
  }

  setPartnerPayoutMessage("\u0421\u043e\u0437\u0434\u0430\u0451\u043c \u0432\u044b\u043f\u043b\u0430\u0442\u0443 \u0432 Bitrix24...");
  if (button) button.disabled = true;
  if (result) result.hidden = true;

  try {
    const response = await fetch("/api/partner-payouts/offline", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ orderAmount: amount, code, branch, assignedById, comment }),
    });
    const payload = await readApiResponse(response, "\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u0441\u043e\u0437\u0434\u0430\u0442\u044c \u0432\u044b\u043f\u043b\u0430\u0442\u0443 \u0432 Bitrix24.");
    if (!response.ok) {
      setPartnerPayoutMessage(
        payload.error || "\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u0441\u043e\u0437\u0434\u0430\u0442\u044c \u0432\u044b\u043f\u043b\u0430\u0442\u0443 \u0432 Bitrix24.",
        "error",
        payload.duplicate?.url ? { href: payload.duplicate.url, text: "\u041e\u0442\u043a\u0440\u044b\u0442\u044c \u043a\u0430\u0440\u0442\u043e\u0447\u043a\u0443" } : null,
      );
      return;
    }

    const partnerName = payload.partner?.name || payload.partner?.code || "\u043f\u0430\u0440\u0442\u043d\u0435\u0440";
    const payoutId = payload.payout?.id || "";
    const payoutUrl = payload.payout?.url || "";
    document.getElementById("partnerPayoutPartner").textContent = partnerName;
    renderBitrixLink(document.getElementById("partnerPayoutId"), payoutId || "-", payoutUrl);
    if (result) result.hidden = false;
    setPartnerPayoutMessage(
      `\u0412\u044b\u043f\u043b\u0430\u0442\u0430 \u0431\u044b\u043b\u0430 \u0441\u043e\u0437\u0434\u0430\u043d\u0430. \u041f\u0430\u0440\u0442\u043d\u0435\u0440: ${partnerName}. ID \u043a\u0430\u0440\u0442\u043e\u0447\u043a\u0438: ${payoutId}.${payload.commentWarning ? ` Комментарий не записан: ${payload.commentWarning}` : ""}`,
      payload.commentWarning ? "error" : "success",
      payoutUrl ? { href: payoutUrl, text: "\u041e\u0442\u043a\u0440\u044b\u0442\u044c \u043a\u0430\u0440\u0442\u043e\u0447\u043a\u0443" } : null,
    );
  } catch (error) {
    setPartnerPayoutMessage(error.message, "error");
  } finally {
    if (button) button.disabled = false;
  }
}

function formatSiteRegistrationMessage(siteRegistration) {
  if (!siteRegistration) return "";
  if (siteRegistration.ok) return " Регистрация на сайте отправлена.";
  if (siteRegistration.needCaptcha) return " Tilda запросила капчу, завершите регистрацию кнопкой ниже.";
  if (siteRegistration.skipped) return ` Регистрация на сайте пропущена: ${siteRegistration.error}`;
  return ` Контакт в Bitrix создан, но сайт не принял регистрацию: ${siteRegistration.error}`;
}

function renderSiteCompletionLink(siteRegistration) {
  const link = document.getElementById("registerSiteCompletionLink");
  if (!siteRegistration?.needCaptcha || !siteRegistration.completeUrl) {
    hideSiteCompletionLink();
    return;
  }
  link.href = siteRegistration.completeUrl;
  link.hidden = false;
}

function hideSiteCompletionLink() {
  const link = document.getElementById("registerSiteCompletionLink");
  link.hidden = true;
  link.href = "#";
}

addOrderRow = function addOrderRow(mode) {
  const row = document.getElementById("productRowTemplate").content.firstElementChild.cloneNode(true);
  const select = row.querySelector(".product-select");
  select.innerHTML = [
    '<option value="">Выберите товар</option>',
    ...catalogProducts.map((product) => `<option value="${escapeHtml(product.id)}" data-price="${Number(product.price) || 0}">${escapeHtml(product.name)}</option>`),
  ].join("");
  select.addEventListener("change", () => {
    row.querySelector(".product-price").value = Number(select.selectedOptions[0]?.dataset.price || 0);
    calculateTotals();
  });
  row.querySelectorAll("input").forEach((input) => input.addEventListener("input", calculateTotals));
  row.querySelector(".danger-button").addEventListener("click", () => {
    row.remove();
    calculateTotals();
  });
  document.getElementById(`${mode}OrderRows`).appendChild(row);
  calculateTotals();
};

loadCatalogProducts = async function loadCatalogProducts() {
  try {
    const response = await fetch("/api/products", { headers: { Accept: "application/json" } });
    const payload = await readApiResponse(response, "\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u0441\u043e\u0437\u0434\u0430\u0442\u044c \u0441\u0434\u0435\u043b\u043a\u0443 \u0432 Bitrix24.");
    if (!response.ok) throw new Error(payload.error || "Unable to load products");
    catalogProducts = Array.isArray(payload.products) ? payload.products : [];
    refreshProductSelects();
    return;
    /*
    document.querySelectorAll(".product-select").forEach((select) => {
      const currentValue = select.value;
      select.innerHTML = [
        '<option value="">Ð’Ñ‹Ð±ÐµÑ€Ð¸Ñ‚Ðµ Ñ‚Ð¾Ð²Ð°Ñ€</option>',
        ...catalogProducts.map((product) => `<option value="${escapeHtml(product.id)}" data-price="${Number(product.price) || 0}">${escapeHtml(product.name)}</option>`),
      ].join("");
      if (currentValue) select.value = currentValue;
    });
    */
  } catch (error) {
    console.error(error);
  }
};

refreshProductSelects = function refreshProductSelects() {
  document.querySelectorAll(".product-select").forEach((select) => {
    const currentValue = select.value;
    select.innerHTML = [
      '<option value="">&#1042;&#1099;&#1073;&#1077;&#1088;&#1080;&#1090;&#1077; &#1090;&#1086;&#1074;&#1072;&#1088;</option>',
      ...catalogProducts.map((product) => `<option value="${escapeHtml(product.id)}" data-price="${Number(product.price) || 0}">${escapeHtml(product.name)}</option>`),
    ].join("");
    if (currentValue) select.value = currentValue;
  });
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function getSubtotal(mode) {
  let subtotal = 0;
  document.querySelectorAll(`#${mode}OrderRows .product-row`).forEach((row) => {
    const sum = Number(row.querySelector(".product-quantity").value || 0) *
      Number(row.querySelector(".product-price").value || 0);
    row.querySelector(".product-sum").value = Math.round(sum);
    subtotal += sum;
  });
  return subtotal;
}

function calculateMode(mode) {
  const subtotal = getSubtotal(mode);
  const rawLoyaltyPercent = Math.min(100, Math.max(0, Number(state[mode].discountPercent || 0)));
  const rawPromoPercent = Math.min(100, Math.max(0, Number(state[mode].promo?.discountPercent || 0)));
  const loyaltyPercent = rawLoyaltyPercent >= rawPromoPercent ? rawLoyaltyPercent : 0;
  const promoPercent = rawPromoPercent > rawLoyaltyPercent ? rawPromoPercent : 0;
  const discountPercent = Math.max(loyaltyPercent, promoPercent);
  const loyaltyDiscountAmount = subtotal * loyaltyPercent / 100;
  const promoDiscountAmount = subtotal * promoPercent / 100;
  const discountAmount = loyaltyDiscountAmount + promoDiscountAmount;
  renderBonusChoices(mode, Math.min(state[mode].bonusBalance, Math.max(subtotal - discountAmount, 0)));
  const useBonuses = document.getElementById(`${mode}UseBonuses`).checked;
  const requested = Number(document.getElementById(`${mode}BonusesToUse`).value || 0);
  const bonusAmount = useBonuses
    ? Math.min(requested, state[mode].bonusBalance, Math.max(subtotal - discountAmount, 0))
    : 0;
  const availableAfterBonuses = Math.max(subtotal - discountAmount - bonusAmount, 0);
  const requestedCertificate = Number(document.getElementById(`${mode}CertificateAmount`)?.value || 0);
  const certificateAmount = state[mode].certificate
    ? Math.min(Math.max(requestedCertificate, 0), state[mode].certificate.balance, availableAfterBonuses)
    : 0;
  const availableAfterCertificate = Math.max(availableAfterBonuses - certificateAmount, 0);
  const requestedCertificate2 = Number(document.getElementById(`${mode}Certificate2Amount`)?.value || 0);
  const certificate2Amount = state[mode].certificate2
    ? Math.min(Math.max(requestedCertificate2, 0), state[mode].certificate2.balance, availableAfterCertificate)
    : 0;

  document.getElementById(`${mode}Subtotal`).textContent = formatMoney(subtotal);
  document.getElementById(`${mode}DiscountPercent`).textContent = discountPercent;
  document.getElementById(`${mode}DiscountAmount`).textContent = formatMoney(discountAmount);
  document.getElementById(`${mode}BonusAmount`).textContent = formatMoney(bonusAmount);
  const certificateSummary = document.getElementById(`${mode}CertificateSummary`);
  if (certificateSummary) certificateSummary.textContent = formatMoney(certificateAmount);
  const certificate2Summary = document.getElementById(`${mode}Certificate2Summary`);
  if (certificate2Summary) certificate2Summary.textContent = formatMoney(certificate2Amount);
  document.getElementById(`${mode}PayTotal`).textContent = formatMoney(availableAfterCertificate - certificate2Amount);
}

function renderBonusChoices(mode, maximum) {
  const container = document.getElementById(`${mode}BonusChoices`);
  const checkbox = document.getElementById(`${mode}UseBonuses`);
  const input = document.getElementById(`${mode}BonusesToUse`);
  if (!container || !checkbox || !input) return;
  const available = Math.max(0, Number(maximum || 0));
  const choices = [300, 500, 800].filter((value) => value <= available);
  let selected = checkbox.checked ? Number(input.value || 0) : 0;
  if (!choices.includes(selected)) {
    selected = 0;
    checkbox.checked = false;
    input.value = "0";
  }
  const values = [0, ...choices];
  container.innerHTML = values.map((value) => (
    `<button type="button" class="bonus-choice${value === selected ? " active" : ""}" data-bonus-value="${value}">${value ? `${value} ₽` : "Не использовать"}</button>`
  )).join("");
  container.querySelectorAll("[data-bonus-value]").forEach((button) => {
    button.addEventListener("click", () => {
      const value = Number(button.dataset.bonusValue || 0);
      checkbox.checked = value > 0;
      input.value = String(value);
      calculateTotals();
    });
  });
}

function calculateTotals() {
  calculateMode("register");
  calculateMode("find");
  calculateMode("messenger");
  calculateMode("preorder");
}

function createOrder() {
  window.alert("Создание заказа подключим после завершения поиска и карточки клиента.");
}

createOrder = async function createOrder(mode) {
  calculateTotals();
  const button = document.querySelector(`[data-create-order="${mode}"]`);
  const order = collectOrderPayload(mode);

  if (!order.contactId) {
    setOrderMessage(mode, "Сначала выберите или создайте клиента.", "error");
    return;
  }
  if (!order.items.length) {
    setOrderMessage(mode, "Добавьте хотя бы один товар.", "error");
    return;
  }

  setOrderMessage(mode, "Создаём заказ в Bitrix24...");
  if (button) button.disabled = true;

  try {
    const response = await fetch("/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(order),
    });
    const payload = await readApiResponse(response, "\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u0441\u043e\u0437\u0434\u0430\u0442\u044c \u0441\u0434\u0435\u043b\u043a\u0443 \u0432 Bitrix24.");
    if (!response.ok) throw new Error(payload.error || "Не удалось создать сделку в Bitrix24.");
    const dealId = payload.deal?.id || "";
    const orderNumber = payload.orderNumber ? ` №${payload.orderNumber}` : "";
    const dealText = dealId ? ` Сделка #${dealId}.` : "";
    setOrderMessage(mode, `${mode === "preorder" ? "Предзаказ" : "Заказ"}${orderNumber} был оформлен в Bitrix24.${dealText}`, "success");
  } catch (error) {
    setOrderMessage(mode, error.message, "error");
  } finally {
    if (button) button.disabled = false;
  }
};

function collectOrderPayload(mode) {
  const rows = Array.from(document.querySelectorAll(`#${mode}OrderRows .product-row`));
  const items = rows.map((row) => {
    const productInput = row.querySelector(".product-select");
    const quantity = Number(row.querySelector(".product-quantity").value || 0);
    const price = Number(row.querySelector(".product-price").value || 0);
    return {
      productId: productInput.dataset.productId || "",
      xmlId: productInput.dataset.productId || "",
      source: productInput.dataset.productSource || "",
      preorder: productInput.dataset.productPreorder === "1",
      name: productInput.value.trim(),
      quantity,
      price,
    };
  }).filter((item) => item.name && item.quantity > 0 && item.price >= 0);

  const subtotal = getSubtotal(mode);
  const rawLoyaltyDiscountPercent = Math.min(100, Math.max(0, Number(state[mode].discountPercent || 0)));
  const rawPromoDiscountPercent = Math.min(100, Math.max(0, Number(state[mode].promo?.discountPercent || 0)));
  const loyaltyDiscountPercent = rawLoyaltyDiscountPercent >= rawPromoDiscountPercent ? rawLoyaltyDiscountPercent : 0;
  const promoDiscountPercent = rawPromoDiscountPercent > rawLoyaltyDiscountPercent ? rawPromoDiscountPercent : 0;
  const discountPercent = Math.max(loyaltyDiscountPercent, promoDiscountPercent);
  const loyaltyDiscountAmount = subtotal * loyaltyDiscountPercent / 100;
  const promoDiscountAmount = subtotal * promoDiscountPercent / 100;
  const discountAmount = loyaltyDiscountAmount + promoDiscountAmount;
  const useBonuses = document.getElementById(`${mode}UseBonuses`).checked;
  const requestedBonuses = Number(document.getElementById(`${mode}BonusesToUse`).value || 0);
  const bonusUsed = useBonuses
    ? Math.min(requestedBonuses, state[mode].bonusBalance, Math.max(subtotal - discountAmount, 0))
    : 0;
  const availableAfterBonuses = Math.max(subtotal - discountAmount - bonusUsed, 0);
  const requestedCertificate = Number(document.getElementById(`${mode}CertificateAmount`)?.value || 0);
  const certificateUsed = state[mode].certificate
    ? Math.min(Math.max(requestedCertificate, 0), state[mode].certificate.balance, availableAfterBonuses)
    : 0;
  const availableAfterCertificate = Math.max(availableAfterBonuses - certificateUsed, 0);
  const requestedCertificate2 = Number(document.getElementById(`${mode}Certificate2Amount`)?.value || 0);
  const certificate2Used = state[mode].certificate2
    ? Math.min(Math.max(requestedCertificate2, 0), state[mode].certificate2.balance, availableAfterCertificate)
    : 0;
  const payTotal = Math.max(availableAfterCertificate - certificate2Used, 0);

  return {
    kind: mode === "preorder" ? "preorder" : mode === "messenger" ? "messenger" : "order",
    sourceId: mode === "messenger" ? document.getElementById("messengerSourceId")?.value : null,
    paymentStatus: mode === "messenger" ? document.getElementById("messengerPaymentStatus")?.value : null,
    contactId: state[mode].clientId,
    branch: document.getElementById(`${mode}Branch`)?.value || "sokol",
    assignedById: Number(document.getElementById(`${mode}Responsible`)?.value || 0) || null,
    currency: "RUB",
    items,
    promo: state[mode].promo
      ? { ...state[mode].promo, discountAmount: promoDiscountAmount }
      : null,
    certificate: state[mode].certificate && certificateUsed > 0
      ? { id: state[mode].certificate.id, code: state[mode].certificate.code, amount: certificateUsed }
      : null,
    certificate2: state[mode].certificate2 && certificate2Used > 0
      ? { id: state[mode].certificate2.id, code: state[mode].certificate2.code, amount: certificate2Used }
      : null,
    totals: {
      subtotal,
      discountPercent,
      discountAmount,
      loyaltyDiscountPercent,
      loyaltyDiscountAmount,
      promoDiscountPercent,
      promoDiscountAmount,
      bonusUsed,
      certificateUsed: certificateUsed + certificate2Used,
      certificate2Used,
      payTotal,
    },
  };
}

async function checkApi() {
  const status = document.getElementById("apiStatus");
  try {
    const response = await fetch("/api/health");
    if (!response.ok) throw new Error();
    status.textContent = "Bitrix API подключён";
    status.className = "status status-ok";
  } catch {
    status.textContent = "API недоступен";
    status.className = "status status-error";
  }
}

async function applyPromocode(mode) {
  const input = document.getElementById(`${mode}PromoCode`);
  const button = document.querySelector(`[data-apply-promo="${mode}"]`);
  const message = document.getElementById(`${mode}PromoMessage`);
  const code = input?.value.trim();

  if (!code) {
    state[mode].promo = null;
    if (message) {
      message.textContent = "Введите промокод.";
      message.className = "form-message promo-message error";
    }
    calculateTotals();
    return;
  }

  if (button) button.disabled = true;
  if (message) {
    message.textContent = "Проверяем промокод...";
    message.className = "form-message promo-message";
  }

  try {
    const response = await fetch(`/api/promocodes/lookup?code=${encodeURIComponent(code)}`, {
      headers: { Accept: "application/json" },
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Промокод не найден.");

    state[mode].promo = payload.promo;
    if (input) input.value = payload.promo.code;
    if (message) {
      message.textContent = `Промокод применён: скидка ${payload.promo.discountPercent}%.`;
      message.className = "form-message promo-message success";
    }
  } catch (error) {
    state[mode].promo = null;
    if (message) {
      message.textContent = error.message;
      message.className = "form-message promo-message error";
    }
  } finally {
    if (button) button.disabled = false;
    calculateTotals();
  }
}

function clearPromocode(mode) {
  const input = document.getElementById(`${mode}PromoCode`);
  const current = normalizeProductName(input?.value);
  const applied = normalizeProductName(state[mode].promo?.code);
  if (!applied || current === applied) return;

  state[mode].promo = null;
  const message = document.getElementById(`${mode}PromoMessage`);
  if (message) {
    message.textContent = "";
    message.className = "form-message promo-message";
  }
  calculateTotals();
}

function certificateKey(slot) {
  return slot === 2 ? "certificate2" : "certificate";
}

function certificateIdSuffix(slot) {
  return slot === 2 ? "Certificate2" : "Certificate";
}

function showSecondCertificate(mode) {
  const section = document.getElementById(`${mode}Certificate2Section`);
  const summary = document.getElementById(`${mode}Certificate2SummaryRow`);
  const button = document.querySelector(`[data-add-certificate="${mode}"]`);
  if (section) section.hidden = false;
  if (summary) summary.hidden = false;
  if (button) button.hidden = true;
  document.getElementById(`${mode}Certificate2CodeInput`)?.focus();
}

function renderCertificate(mode, slot = 1) {
  const suffix = certificateIdSuffix(slot);
  const panel = document.getElementById(`${mode}${suffix}Panel`);
  if (!panel) return;
  const certificate = state[mode][certificateKey(slot)];
  panel.hidden = !certificate;
  const code = document.getElementById(`${mode}${suffix}Code`);
  const balance = document.getElementById(`${mode}${suffix}Balance`);
  const amount = document.getElementById(`${mode}${suffix}Amount`);
  const used = document.getElementById(`${mode}${suffix}Used`);
  const links = document.getElementById(`${mode}${suffix}Links`);
  if (code) code.textContent = certificate?.code || "";
  if (balance) balance.textContent = formatMoney(certificate?.balance || 0);
  if (used) used.textContent = formatMoney(certificate?.usedAmount || 0);
  if (amount) {
    amount.max = String(certificate?.balance || 0);
    amount.disabled = !certificate || certificate.balance <= 0;
    if (!certificate) amount.value = "0";
  }
  if (links) {
    const items = certificate
      ? [
          certificate.url ? `<a href="${certificate.url}" target="_blank" rel="noopener">Открыть сертификат</a>` : "",
          ...(certificate.orderLinks || []).map((order) => `<a href="${order.url}" target="_blank" rel="noopener">Заказ #${order.id}</a>`),
        ].filter(Boolean)
      : [];
    links.innerHTML = items.join(" · ");
  }
}

async function applyCertificate(mode, slot = 1) {
  const suffix = certificateIdSuffix(slot);
  const key = certificateKey(slot);
  const input = document.getElementById(`${mode}${suffix}CodeInput`);
  const button = document.querySelector(`[data-apply-certificate="${mode}"][data-certificate-slot="${slot}"]`) ||
    (slot === 1 ? document.querySelector(`[data-apply-certificate="${mode}"]:not([data-certificate-slot])`) : null);
  const message = document.getElementById(`${mode}${suffix}Message`);
  const code = input?.value.trim();
  if (!code) {
    state[mode][key] = null;
    renderCertificate(mode, slot);
    if (message) {
      message.textContent = "Введите код сертификата.";
      message.className = "form-message promo-message error";
    }
    calculateTotals();
    return;
  }
  const other = state[mode][certificateKey(slot === 1 ? 2 : 1)];
  if (other && normalizeProductName(other.code) === normalizeProductName(code)) {
    state[mode][key] = null;
    renderCertificate(mode, slot);
    if (message) {
      message.textContent = "Этот сертификат уже выбран в другой строке.";
      message.className = "form-message promo-message error";
    }
    calculateTotals();
    return;
  }
  if (button) button.disabled = true;
  if (message) {
    message.textContent = "Проверяем сертификат...";
    message.className = "form-message promo-message";
  }
  try {
    const response = await fetch(`/api/certificates/lookup?code=${encodeURIComponent(code)}`, { headers: { Accept: "application/json" } });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Сертификат не найден.");
    if (other && (String(other.id) === String(payload.certificate.id) || normalizeProductName(other.code) === normalizeProductName(payload.certificate.code))) {
      throw new Error("Этот сертификат уже выбран в другой строке.");
    }
    state[mode][key] = payload.certificate;
    if (input) input.value = payload.certificate.code;
    renderCertificate(mode, slot);
    if (message) {
      message.textContent = payload.certificate.balance > 0
        ? `Сертификат найден. Доступно ${formatMoney(payload.certificate.balance)} ₽, использовано ${formatMoney(payload.certificate.usedAmount)} ₽.`
        : `Сертификат полностью использован. Использовано ${formatMoney(payload.certificate.usedAmount)} ₽.`;
      message.className = "form-message promo-message success";
    }
  } catch (error) {
    state[mode][key] = null;
    renderCertificate(mode, slot);
    if (message) {
      message.textContent = error.message;
      message.className = "form-message promo-message error";
    }
  } finally {
    if (button) button.disabled = false;
    calculateTotals();
  }
}

function clearCertificate(mode, slot = 1) {
  const suffix = certificateIdSuffix(slot);
  const key = certificateKey(slot);
  const input = document.getElementById(`${mode}${suffix}CodeInput`);
  const current = normalizeProductName(input?.value);
  const applied = normalizeProductName(state[mode][key]?.code);
  if (!applied || current === applied) return;
  state[mode][key] = null;
  renderCertificate(mode, slot);
  const message = document.getElementById(`${mode}${suffix}Message`);
  if (message) {
    message.textContent = "";
    message.className = "form-message promo-message";
  }
  calculateTotals();
}

async function loadResponsibleEmployees(mode) {
  const branch = document.getElementById(`${mode}Branch`)?.value || "sokol";
  const select = document.getElementById(`${mode}Responsible`);
  if (!select) return;

  select.disabled = true;
  select.innerHTML = '<option value="">Загружаем...</option>';

  try {
    let employees = employeesByBranch.get(branch);
    if (!employees) {
      const response = await fetch(`/api/employees?branch=${encodeURIComponent(branch)}`, {
        headers: { Accept: "application/json" },
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to load employees");
      employees = Array.isArray(payload.employees) ? payload.employees : [];
      employeesByBranch.set(branch, employees);
    }

    select.innerHTML = employees.length
      ? employees.map((employee, index) => (
          `<option value="${escapeHtml(employee.id)}"${index === 0 ? " selected" : ""}>${escapeHtml(employee.name)}</option>`
        )).join("")
      : '<option value="">Нет сотрудников отдела</option>';
  } catch (error) {
    console.error(error);
    select.innerHTML = '<option value="">Не удалось загрузить</option>';
  } finally {
    select.disabled = false;
  }
}

function addOrderRow(mode) {
  const row = document.getElementById("productRowTemplate").content.firstElementChild.cloneNode(true);
  const input = row.querySelector(".product-select");
  input.removeAttribute("list");
  const suggestions = document.createElement("div");
  suggestions.className = "product-suggestions";
  suggestions.hidden = true;
  input.closest("label").appendChild(suggestions);
  input.addEventListener("input", () => {
    applyProductSelection(row);
    scheduleProductSuggestions(row);
  });
  input.addEventListener("focus", () => scheduleProductSuggestions(row));
  input.addEventListener("change", () => applyProductSelection(row));
  input.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeProductSuggestions(row);
  });
  row.querySelectorAll("input").forEach((input) => input.addEventListener("input", calculateTotals));
  row.querySelector(".danger-button").addEventListener("click", () => {
    row.remove();
    calculateTotals();
  });
  document.getElementById(`${mode}OrderRows`).appendChild(row);
  calculateTotals();
}

async function loadCatalogProducts() {
  try {
    const response = await fetch("/api/products", { headers: { Accept: "application/json" } });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Unable to load products");
    catalogProducts = Array.isArray(payload.products) ? payload.products : [];
    catalogProductsByName = new Map(catalogProducts.map((product) => [normalizeProductName(product.name), product]));
    refreshProductSelects();
    document.querySelectorAll(".product-row").forEach((row) => {
      applyProductSelection(row);
      if (document.activeElement === row.querySelector(".product-select")) showProductSuggestions(row);
    });
  } catch (error) {
    console.error(error);
  }
}

function refreshProductSelects() {
  const list = document.getElementById("productOptions");
  if (!list) return;
  list.innerHTML = catalogProducts.map((product) => (
    `<option value="${escapeHtml(product.name)}">${formatMoney(product.price)} ${escapeHtml(product.currency || "RUB")}</option>`
  )).join("");
}

function applyProductSelection(row) {
  const input = row.querySelector(".product-select");
  const priceInput = row.querySelector(".product-price");
  const product = catalogProductsByName.get(normalizeProductName(input.value));
  if (product) {
    setSelectedProductData(input, product);
    priceInput.value = Number(product.price) || 0;
  } else {
    clearSelectedProductData(input);
    if (input.value.trim()) priceInput.value = 0;
  }
  calculateTotals();
}

function showProductSuggestions(row) {
  const input = row.querySelector(".product-select");
  const box = row.querySelector(".product-suggestions");
  if (!box) return;
  const query = normalizeProductName(input.value);
  if (!query) {
    closeProductSuggestions(row);
    return;
  }
  const matches = catalogProducts
    .filter((product) => normalizeProductName(product.name).includes(query))
    .slice(0, 30);
  if (!matches.length) {
    box.innerHTML = '<button class="product-suggestion" type="button" disabled>Ничего не найдено</button>';
    box.hidden = false;
    return;
  }
  box.innerHTML = matches.map((product) => (
    `<button class="product-suggestion" type="button" data-product-id="${escapeHtml(product.id)}">` +
      `<span class="product-suggestion-name">${escapeHtml(product.name)}</span>` +
      `<span class="product-suggestion-price">${formatMoney(product.price)} ₽</span>` +
    `</button>`
  )).join("");
  box.hidden = false;
  box.querySelectorAll(".product-suggestion[data-product-id]").forEach((button) => {
    button.addEventListener("mousedown", (event) => event.preventDefault());
    button.addEventListener("click", () => selectSuggestedProduct(row, button.dataset.productId));
  });
}

function selectSuggestedProduct(row, productId) {
  const product = catalogProducts.find((item) => String(item.id) === String(productId));
  if (!product) return;
  const input = row.querySelector(".product-select");
  const priceInput = row.querySelector(".product-price");
  input.value = product.name;
  setSelectedProductData(input, product);
  priceInput.value = Number(product.price) || 0;
  closeProductSuggestions(row);
  calculateTotals();
}

function setSelectedProductData(input, product) {
  if (!input) return;
  const preorder = isPreorderProduct(product);
  if (preorder || product?.manualPrice) delete input.dataset.productId;
  else input.dataset.productId = product?.id || "";
  input.dataset.productSource = product?.source || "";
  input.dataset.productPreorder = preorder ? "1" : "0";
  input.dataset.productCount = product?.count ?? "";
  input.dataset.productManualPrice = product?.manualPrice ? "1" : "0";
}

function clearSelectedProductData(input) {
  if (!input) return;
  delete input.dataset.productId;
  delete input.dataset.productSource;
  delete input.dataset.productPreorder;
  delete input.dataset.productCount;
  delete input.dataset.productManualPrice;
}

function closeProductSuggestions(row) {
  const box = row.querySelector(".product-suggestions");
  if (box) box.hidden = true;
}

function scheduleProductSuggestions(row) {
  clearTimeout(productSearchTimers.get(row));
  productSearchTimers.set(row, setTimeout(() => showProductSuggestions(row), 180));
}

showProductSuggestions = async function showProductSuggestions(row) {
  const input = row.querySelector(".product-select");
  const box = row.querySelector(".product-suggestions");
  if (!box) return;
  const query = normalizeProductName(input.value);
  if (!query) {
    closeProductSuggestions(row);
    return;
  }

  const sequence = Number(row.dataset.productSearchSequence || 0) + 1;
  row.dataset.productSearchSequence = String(sequence);
  const mode = getProductRowMode(row);
  const localMatches = findMatchingProducts(query, mode).slice(0, 30);
  if (localMatches.length) renderProductSuggestions(row, localMatches);
  else {
    box.innerHTML = '<button class="product-suggestion" type="button" disabled>Ищем...</button>';
    box.hidden = false;
  }

  try {
    const products = await fetchProductSuggestions(query);
    if (row.dataset.productSearchSequence !== String(sequence)) return;
    mergeCatalogProducts(products);
    renderProductSuggestions(row, filterProductsForMode(products, mode).slice(0, 30));
  } catch (error) {
    if (row.dataset.productSearchSequence !== String(sequence)) return;
    console.error(error);
    box.innerHTML = '<button class="product-suggestion" type="button" disabled>Не удалось загрузить товары</button>';
    box.hidden = false;
  }
};

function findMatchingProducts(query, mode = "") {
  return filterProductsForMode(catalogProducts, mode).filter((product) => normalizeProductName(product.name).includes(query));
}

async function fetchProductSuggestions(query) {
  const response = await fetch(`/api/products?q=${encodeURIComponent(query)}`, {
    headers: { Accept: "application/json" },
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "Unable to load products");
  return Array.isArray(payload.products) ? payload.products : [];
}

function mergeCatalogProducts(products) {
  const byId = new Map(catalogProducts.map((product) => [String(product.id), product]));
  for (const product of products) byId.set(String(product.id), product);
  catalogProducts = [...byId.values()];
  catalogProductsByName = new Map(catalogProducts.map((product) => [normalizeProductName(product.name), product]));
}

function renderProductSuggestions(row, products) {
  const box = row.querySelector(".product-suggestions");
  if (!box) return;
  if (!products.length) {
    box.innerHTML = '<button class="product-suggestion" type="button" disabled>Ничего не найдено</button>';
    box.hidden = false;
    return;
  }
  box.innerHTML = products.map((product) => (
    `<button class="product-suggestion" type="button" data-product-id="${escapeHtml(product.id)}">` +
      `<span class="product-suggestion-name">${escapeHtml(product.name)}</span>` +
      `<span class="product-suggestion-meta">` +
        `<span class="product-suggestion-price">${formatMoney(product.price)} ₽</span>` +
        `<span class="${product.preorder ? "product-suggestion-stock preorder" : "product-suggestion-stock"}">${escapeHtml(productStockLabel(product))}</span>` +
      `</span>` +
    `</button>`
  )).join("");
  box.hidden = false;
  box.querySelectorAll(".product-suggestion[data-product-id]").forEach((button) => {
    button.addEventListener("mousedown", (event) => event.preventDefault());
    button.addEventListener("click", () => selectSuggestedProduct(row, button.dataset.productId));
  });
}

function isPreorderProduct(product) {
  if (!product || product.manualPrice) return false;
  if (product.preorder) return true;
  if (product.count !== null && product.count !== undefined && product.count !== "") return false;
  return !product.source || product.source !== "tilda-yml";
}

function filterProductsForMode(products, mode) {
  return mode === "preorder"
    ? products.filter(isPreorderProduct)
    : products.filter((product) => !isPreorderProduct(product));
}

function getProductRowMode(row) {
  const rows = row?.parentElement;
  if (!rows?.id) return "";
  return rows.id.replace(/OrderRows$/, "");
}

function normalizeProductName(value) {
  return String(value || "").trim().toLowerCase().replace(/\u0451/g, "\u0435");
}

function productStockLabel(product) {
  if (product?.manualPrice) return "Произвольная сумма";
  if (isPreorderProduct(product)) return product.note ? `Предзаказ · ${product.note}` : "Предзаказ";
  if (product?.count === null || product?.count === undefined || product.count === "") return "Остаток не указан";
  return `Остаток: ${formatMoney(product.count)} шт`;
}

addOrderRow = function addOrderRow(mode) {
  const row = document.getElementById("productRowTemplate").content.firstElementChild.cloneNode(true);
  const input = row.querySelector(".product-select");
  const suggestions = document.createElement("div");
  suggestions.className = "product-suggestions";
  suggestions.hidden = true;
  input.removeAttribute("list");
  input.closest("label").appendChild(suggestions);
  input.addEventListener("focus", () => showProductSuggestions(row));
  input.addEventListener("click", () => showProductSuggestions(row));
  input.addEventListener("input", () => {
    applyProductSelection(row);
    showProductSuggestions(row);
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeProductSuggestions(row);
  });
  row.querySelectorAll("input").forEach((input) => input.addEventListener("input", calculateTotals));
  row.querySelector(".danger-button").addEventListener("click", () => {
    row.remove();
    calculateTotals();
  });
  document.getElementById(`${mode}OrderRows`).appendChild(row);
  calculateTotals();
};

loadCatalogProducts = async function loadCatalogProducts() {
  try {
    const response = await fetch("/api/products", { headers: { Accept: "application/json" } });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Unable to load products");
    catalogProducts = [
      amountAdjustmentProduct,
      ...(Array.isArray(payload.products) ? payload.products : []).filter(
        (product) => normalizeProductName(product?.name) !== normalizeProductName(amountAdjustmentProduct.name),
      ),
    ];
    catalogProductsByName = new Map(catalogProducts.map((product) => [normalizeProductName(product.name), product]));
    document.querySelectorAll(".product-row").forEach(applyProductSelection);
  } catch (error) {
    console.error(error);
  }
};

showProductSuggestions = function showProductSuggestions(row) {
  const input = row.querySelector(".product-select");
  const box = row.querySelector(".product-suggestions");
  if (!box) return;
  if (!catalogProducts.length) {
    box.innerHTML = '<button class="product-suggestion" type="button" disabled>Загружаем каталог...</button>';
    box.hidden = false;
    return;
  }
  const query = normalizeProductName(input.value);
  const source = filterProductsForMode(catalogProducts, getProductRowMode(row));
  const matches = query
    ? source.filter((product) => normalizeProductName(product.name).includes(query))
    : source;
  renderProductSuggestions(row, matches);
};

createOrder = async function createOrder(mode) {
  calculateTotals();
  const button = document.querySelector(`[data-create-order="${mode}"]`);
  const order = collectOrderPayload(mode);

  if (!order.contactId) {
    setOrderMessage(mode, "\u0421\u043d\u0430\u0447\u0430\u043b\u0430 \u0432\u044b\u0431\u0435\u0440\u0438\u0442\u0435 \u0438\u043b\u0438 \u0441\u043e\u0437\u0434\u0430\u0439\u0442\u0435 \u043a\u043b\u0438\u0435\u043d\u0442\u0430.", "error");
    return;
  }
  if (!order.items.length) {
    setOrderMessage(mode, "\u0414\u043e\u0431\u0430\u0432\u044c\u0442\u0435 \u0445\u043e\u0442\u044f \u0431\u044b \u043e\u0434\u0438\u043d \u0442\u043e\u0432\u0430\u0440.", "error");
    return;
  }

  setOrderMessage(mode, "\u0421\u043e\u0437\u0434\u0430\u0451\u043c \u0437\u0430\u043a\u0430\u0437 \u0432 Bitrix24...");
  if (button) button.disabled = true;

  try {
    const response = await fetch("/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(order),
    });
    const payload = await response.json();
    if (!response.ok) {
      setOrderMessage(
        mode,
        payload.error || "\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u0441\u043e\u0437\u0434\u0430\u0442\u044c \u0441\u0434\u0435\u043b\u043a\u0443 \u0432 Bitrix24.",
        "error",
        payload.duplicate?.url ? { href: payload.duplicate.url, text: "\u041e\u0442\u043a\u0440\u044b\u0442\u044c \u0441\u0434\u0435\u043b\u043a\u0443" } : null,
      );
      return;
    }

    const dealId = payload.deal?.id || "";
    const dealUrl = payload.deal?.url || "";
    const orderNumber = payload.orderNumber ? ` \u2116${payload.orderNumber}` : "";
    const dealText = dealId ? ` \u0421\u0434\u0435\u043b\u043a\u0430 #${dealId}.` : "";
    setOrderMessage(
      mode,
      `${mode === "preorder" ? "\u041f\u0440\u0435\u0434\u0437\u0430\u043a\u0430\u0437" : "\u0417\u0430\u043a\u0430\u0437"}${orderNumber} \u0431\u044b\u043b \u043e\u0444\u043e\u0440\u043c\u043b\u0435\u043d \u0432 Bitrix24.${dealText}`,
      "success",
      dealUrl ? { href: dealUrl, text: "\u041e\u0442\u043a\u0440\u044b\u0442\u044c \u0441\u0434\u0435\u043b\u043a\u0443" } : null,
    );
  } catch (error) {
    setOrderMessage(mode, error.message, "error");
  } finally {
    if (button) button.disabled = false;
  }
};

addOrderRow("register");
addOrderRow("find");
addOrderRow("messenger");
addOrderRow("preorder");
loadResponsibleEmployees("register");
loadResponsibleEmployees("find");
loadResponsibleEmployees("messenger");
loadResponsibleEmployees("preorder");
loadResponsibleEmployees("partnerPayout");
loadCatalogProducts();
checkApi();

