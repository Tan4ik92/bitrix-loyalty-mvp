(function () {
  const DEFAULT_API_BASE = "http://127.0.0.1:3100";
  const API_BASE = String(window.V2SD_BITRIX_ACCOUNT_API || DEFAULT_API_BASE).replace(/\/$/, "");
  const PROJECT_ID = document.getElementById("allrecords")?.getAttribute("data-tilda-project-id") || "";
  const PROFILE_KEYS = [PROJECT_ID ? `tilda_members_profile${PROJECT_ID}` : "", "memberarea_profile"].filter(Boolean);

  function ready(callback) { if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", callback); else callback(); }
  function getMemberProfile() {
    for (const key of PROFILE_KEYS) {
      try { const value = localStorage.getItem(key); if (value) return JSON.parse(value); } catch (error) { console.warn("V2SD profile parse failed:", key, error); }
    }
    return {};
  }
  function waitForCurrentTildaProfile() {
    return new Promise((resolve) => {
      const startedAt = Date.now();
      const timer = setInterval(() => {
        if (window.tildaMembers?.is_get_profile || Date.now() - startedAt > 4000) { clearInterval(timer); resolve(getMemberProfile()); }
      }, 100);
    });
  }
  function memberEmail(profile) { return String(profile.login || profile.email || profile.mail || "").trim().toLowerCase(); }
  function memberContactId(profile, email) {
    return String(profile.bitrixContactId || profile.bitrix_contact_id || (email ? localStorage.getItem(`v2sd_bitrix_contact_id:${email}`) : "") || new URLSearchParams(window.location.search).get("bitrixContactId") || new URLSearchParams(window.location.search).get("contactId") || "").trim();
  }
  async function loadAccount(profile = getMemberProfile()) {
    const email = memberEmail(profile);
    const contactId = memberContactId(profile, email);
    if (!email && !contactId) throw new Error("Не найден email пользователя Tilda Members.");
    const params = new URLSearchParams({ limit: "50" });
    if (contactId) params.set("contactId", contactId);
    if (email) params.set("email", email);
    const response = await fetch(`${API_BASE}/api/account/profile?${params}`, { headers: { Accept: "application/json" } });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Bitrix не вернул историю заказов.");
    if (!payload.contact) throw new Error("Контакт не найден в Bitrix.");
    return payload;
  }
  function formatMoney(value) { return `${Math.round(Number(value) || 0).toLocaleString("ru-RU")} ₽`; }
  function formatDate(value) { const date = new Date(value); return !value || Number.isNaN(date.getTime()) ? String(value || "") : date.toLocaleDateString("ru-RU"); }
  function findHeading(text) {
    const expected = text.toLowerCase();
    return [...document.querySelectorAll("h1,h2,h3,.t-title,.t-heading,.t-name")].find((node) => node.textContent.trim().toLowerCase().includes(expected));
  }
  function findOrdersTable() {
    const heading = findHeading("история заказов");
    if (heading) {
      let node = heading;
      for (let i = 0; i < 8 && node; i += 1) {
        node = node.nextElementSibling || node.parentElement?.nextElementSibling;
        const table = node?.querySelector?.("table") || (node?.tagName === "TABLE" ? node : null);
        if (table) return table;
      }
    }
    return document.querySelector(".t431__table table, .t431 table, table");
  }
  function renderOrders(account, attempt = 0) {
    const table = findOrdersTable();
    if (!table) { if (attempt < 50) setTimeout(() => renderOrders(account, attempt + 1), 100); return; }
    let tbody = table.querySelector("tbody");
    if (!tbody) { tbody = document.createElement("tbody"); table.appendChild(tbody); }
    const template = tbody.querySelector("tr")?.cloneNode(true) || null;
    tbody.innerHTML = "";
    const history = buildAccountHistory(account);
    if (!history.length) {
      const row = template || document.createElement("tr");
      const cell = row.cells?.[0] || row.insertCell();
      cell.colSpan = 3;
      cell.textContent = "Заказов пока нет";
      while (row.cells.length > 1) row.deleteCell(1);
      tbody.appendChild(row);
      return;
    }
    history.forEach((order) => {
      const row = template ? template.cloneNode(true) : document.createElement("tr");
      while (row.cells.length < 3) row.insertCell();
      row.cells[0].textContent = formatDate(order.date);
      row.cells[1].textContent = order.composition || order.title || "";
      row.cells[2].textContent = formatMoney(order.sum);
      tbody.appendChild(row);
    });
  }
  function buildAccountHistory(account) {
    const orders = Array.isArray(account.orders) ? account.orders : [];
    const registeredAt = account.contact?.loyalty?.registeredAt;
    const registrationBonus = registeredAt ? [{ id: "registration-bonus", date: registeredAt, composition: "Бонусные баллы за регистрацию", sum: 0 }] : [];
    return [...orders, ...registrationBonus].sort((left, right) => new Date(right.date || 0).getTime() - new Date(left.date || 0).getTime());
  }
  function renderError(error) { console.error("V2SD orders adapter:", error); }
  async function renderAccount(profile) { const account = await loadAccount(profile); renderOrders(account); window.v2sdOrdersAccount = account; window.dispatchEvent(new CustomEvent("v2sd:orders-loaded", { detail: account })); }
  ready(async () => {
    try {
      const firstProfile = getMemberProfile();
      const firstEmail = memberEmail(firstProfile);
      await renderAccount(firstProfile);
      waitForCurrentTildaProfile().then((profile) => {
        if (memberEmail(profile) && memberEmail(profile) !== firstEmail) return renderAccount(profile);
      }).catch(renderError);
    } catch (error) { renderError(error); }
  });
})();
