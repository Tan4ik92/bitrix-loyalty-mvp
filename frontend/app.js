let catalogProducts = [];
let catalogProductsByName = new Map();
const productSearchTimers = new WeakMap();

const demoProducts = [
  { id: "1", name: "Товар 1", price: 2500 },
  { id: "2", name: "Товар 2", price: 4700 },
  { id: "3", name: "Товар 3", price: 9900 },
];

const state = {
  register: { clientId: null, totalPurchases: 0, bonusBalance: 300, discountPercent: 0 },
  find: { clientId: null, totalPurchases: 0, bonusBalance: 0, discountPercent: 0 },
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
document.querySelectorAll('input[id$="UseBonuses"], input[id$="BonusesToUse"]').forEach((input) => {
  input.addEventListener("input", calculateTotals);
  input.addEventListener("change", calculateTotals);
});
document.getElementById("registerForm").addEventListener("submit", registerClient);
document.getElementById("searchForm").addEventListener("submit", findClient);
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
    const payload = await response.json();
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
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Не удалось выполнить поиск");
    if (!payload.contact) {
      resetFoundClient();
      setSearchMessage("Контакт не найден.", "error");
      return;
    }

    renderContact(payload.contact);
    setSearchMessage(
      payload.matches > 1 ? `Найдено совпадений: ${payload.matches}. Показан наиболее точный контакт.` : "Контакт найден.",
      "success",
    );
  } catch (error) {
    resetFoundClient();
    setSearchMessage(error.message, "error");
  } finally {
    button.disabled = false;
  }
}

function renderContact(contact) {
  state.find.clientId = contact.id;
  state.find.totalPurchases = contact.loyalty.purchaseSum || 0;
  state.find.bonusBalance = contact.loyalty.balance || 0;
  state.find.discountPercent = contact.loyalty.discountPercent || 0;

  document.getElementById("findClientName").textContent = contact.fullName || `Контакт #${contact.id}`;
  document.getElementById("findClientContact").textContent =
    [contact.phone, contact.email].filter(Boolean).join(" · ") || "Телефон и email не указаны";
  document.getElementById("findClientId").textContent = `ID ${contact.id}`;
  document.getElementById("findClientId").hidden = false;
  document.getElementById("findDiscountCard").textContent = `${state.find.discountPercent}%`;
  document.getElementById("findPurchasesCard").textContent = `${formatMoney(state.find.totalPurchases)} ₽`;
  document.getElementById("findBonusesCard").textContent = `${formatMoney(state.find.bonusBalance)} ₽`;
  document.getElementById("findOrdersCount").textContent = contact.loyalty.ordersCount ?? "—";
  document.getElementById("findAccruedTotal").textContent = moneyOrDash(contact.loyalty.accruedTotal);
  document.getElementById("findSpentTotal").textContent = moneyOrDash(contact.loyalty.spentTotal);
  document.getElementById("findLastOrder").textContent = contact.loyalty.lastOrderNumber || "—";
  document.getElementById("findLastOrderDate").textContent = formatDate(contact.loyalty.lastOrderDate);
  document.getElementById("findLastOrderSum").textContent = moneyOrDash(contact.loyalty.lastOrderSum);
  document.getElementById("findSyncedAt").textContent = formatDateTime(contact.loyalty.syncedAt);
  calculateTotals();
}

function renderRegisteredContact(contact) {
  state.register.clientId = contact.id;
  state.register.totalPurchases = contact.loyalty.purchaseSum || 0;
  state.register.bonusBalance = contact.loyalty.balance || 300;
  state.register.discountPercent = contact.loyalty.discountPercent || 0;

  document.getElementById("registerClientName").textContent = contact.fullName || `Контакт #${contact.id}`;
  document.getElementById("registerClientContact").textContent =
    [contact.phone, contact.email].filter(Boolean).join(" · ") || `ID ${contact.id}`;
  document.getElementById("registerDiscountCard").textContent = `${state.register.discountPercent}%`;
  document.getElementById("registerPurchasesCard").textContent = `${formatMoney(state.register.totalPurchases)} ₽`;
  document.getElementById("registerBonusesCard").textContent = `${formatMoney(state.register.bonusBalance)} ₽`;
  calculateTotals();
}

function resetFoundClient() {
  state.find = { clientId: null, totalPurchases: 0, bonusBalance: 0, discountPercent: 0 };
  document.getElementById("findClientName").textContent = "Клиент не выбран";
  document.getElementById("findClientContact").textContent = "Введите телефон или email";
  document.getElementById("findClientId").hidden = true;
  ["findDiscountCard", "findPurchasesCard", "findBonusesCard"].forEach((id, index) => {
    document.getElementById(id).textContent = index === 0 ? "0%" : "0 ₽";
  });
  ["findOrdersCount", "findAccruedTotal", "findSpentTotal", "findLastOrder", "findLastOrderDate", "findLastOrderSum", "findSyncedAt"]
    .forEach((id) => { document.getElementById(id).textContent = "—"; });
  calculateTotals();
}

function moneyOrDash(value) {
  return value === null || value === undefined || value === "" ? "—" : `${formatMoney(value)} ₽`;
}

function setSearchMessage(message, kind = "") {
  const element = document.getElementById("searchMessage");
  element.textContent = message;
  element.className = `form-message ${kind}`.trim();
}

function setRegisterMessage(message, kind = "") {
  const element = document.getElementById("registerMessage");
  element.textContent = message;
  element.className = `form-message ${kind}`.trim();
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
    const payload = await response.json();
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
  const discountPercent = Number(state[mode].discountPercent || 0);
  const discountAmount = subtotal * discountPercent / 100;
  const useBonuses = document.getElementById(`${mode}UseBonuses`).checked;
  const requested = Number(document.getElementById(`${mode}BonusesToUse`).value || 0);
  const bonusAmount = useBonuses
    ? Math.min(requested, state[mode].bonusBalance, Math.max(subtotal - discountAmount, 0))
    : 0;

  document.getElementById(`${mode}Subtotal`).textContent = formatMoney(subtotal);
  document.getElementById(`${mode}DiscountPercent`).textContent = discountPercent;
  document.getElementById(`${mode}DiscountAmount`).textContent = formatMoney(discountAmount);
  document.getElementById(`${mode}BonusAmount`).textContent = formatMoney(bonusAmount);
  document.getElementById(`${mode}PayTotal`).textContent = formatMoney(subtotal - discountAmount - bonusAmount);
}

function calculateTotals() {
  calculateMode("register");
  calculateMode("find");
}

function createOrder() {
  window.alert("Создание заказа подключим после завершения поиска и карточки клиента.");
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
    input.dataset.productId = product.id;
    priceInput.value = Number(product.price) || 0;
  } else {
    delete input.dataset.productId;
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
      `<span>${escapeHtml(product.name)}</span>` +
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
  input.dataset.productId = product.id;
  priceInput.value = Number(product.price) || 0;
  closeProductSuggestions(row);
  calculateTotals();
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
  const localMatches = findMatchingProducts(query).slice(0, 30);
  if (localMatches.length) renderProductSuggestions(row, localMatches);
  else {
    box.innerHTML = '<button class="product-suggestion" type="button" disabled>Ищем...</button>';
    box.hidden = false;
  }

  try {
    const products = await fetchProductSuggestions(query);
    if (row.dataset.productSearchSequence !== String(sequence)) return;
    mergeCatalogProducts(products);
    renderProductSuggestions(row, products.slice(0, 30));
  } catch (error) {
    if (row.dataset.productSearchSequence !== String(sequence)) return;
    console.error(error);
    box.innerHTML = '<button class="product-suggestion" type="button" disabled>Не удалось загрузить товары</button>';
    box.hidden = false;
  }
};

function findMatchingProducts(query) {
  return catalogProducts.filter((product) => normalizeProductName(product.name).includes(query));
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
      `<span>${escapeHtml(product.name)}</span>` +
      `<span class="product-suggestion-price">${formatMoney(product.price)} ₽</span>` +
    `</button>`
  )).join("");
  box.hidden = false;
  box.querySelectorAll(".product-suggestion[data-product-id]").forEach((button) => {
    button.addEventListener("mousedown", (event) => event.preventDefault());
    button.addEventListener("click", () => selectSuggestedProduct(row, button.dataset.productId));
  });
}

function normalizeProductName(value) {
  return String(value || "").trim().toLowerCase();
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
    catalogProducts = Array.isArray(payload.products) ? payload.products : [];
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
  const matches = query
    ? catalogProducts.filter((product) => normalizeProductName(product.name).includes(query))
    : catalogProducts;
  renderProductSuggestions(row, matches);
};

addOrderRow("register");
addOrderRow("find");
loadCatalogProducts();
checkApi();
