(function () {
  const DEFAULT_API_BASE = "http://127.0.0.1:3100";
  const API_BASE = String(window.V2SD_BITRIX_ACCOUNT_API || DEFAULT_API_BASE).replace(/\/$/, "");
  const PROJECT_ID = document.getElementById("allrecords")?.getAttribute("data-tilda-project-id") || "";
  const PROFILE_KEYS = [
    PROJECT_ID ? `tilda_members_profile${PROJECT_ID}` : "",
    "memberarea_profile",
  ].filter(Boolean);

  function ready(callback) {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", callback);
    else callback();
  }

  function getMemberProfile() {
    for (const key of PROFILE_KEYS) {
      try {
        const value = localStorage.getItem(key);
        if (value) return JSON.parse(value);
      } catch (error) {
        console.warn("V2SD profile parse failed:", key, error);
      }
    }
    return {};
  }

  function waitForCurrentTildaProfile() {
    return new Promise((resolve) => {
      const startedAt = Date.now();
      const timer = setInterval(() => {
        if (window.tildaMembers?.is_get_profile || Date.now() - startedAt > 4000) {
          clearInterval(timer);
          resolve(getMemberProfile());
        }
      }, 100);
    });
  }

  function memberEmail(profile) {
    return String(profile.login || profile.email || profile.mail || "").trim().toLowerCase();
  }

  function memberContactId(profile, email) {
    return String(
      profile.bitrixContactId ||
      profile.bitrix_contact_id ||
      (email ? localStorage.getItem(`v2sd_bitrix_contact_id:${email}`) : "") ||
      new URLSearchParams(window.location.search).get("bitrixContactId") ||
      new URLSearchParams(window.location.search).get("contactId") ||
      "",
    ).trim();
  }

  async function loadAccount(profile = getMemberProfile()) {
    const email = memberEmail(profile);
    const contactId = memberContactId(profile, email);
    if (!email && !contactId) throw new Error("Не найден email пользователя Tilda Members.");

    const params = new URLSearchParams({ limit: "50" });
    if (contactId) params.set("contactId", contactId);
    if (email) params.set("email", email);

    const response = await fetch(`${API_BASE}/api/account/profile?${params.toString()}`, {
      headers: { Accept: "application/json" },
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Bitrix не вернул данные личного кабинета.");
    if (!payload.contact) throw new Error("Контакт не найден в Bitrix.");
    return payload;
  }

  function formatMoney(value) {
    return `${Math.round(Number(value) || 0).toLocaleString("ru-RU")} ₽`;
  }

  function formatDate(value) {
    if (!value) return "";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString("ru-RU");
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function findHeading(text) {
    const expected = text.toLowerCase();
    return [...document.querySelectorAll("h1,h2,h3,.t-title,.t-heading,.t-name")]
      .find((node) => node.textContent.trim().toLowerCase().includes(expected));
  }

  function renderSummary(account) {
    const contact = account.contact;
    const loyalty = contact.loyalty || {};
    const heading = findHeading("личный кабинет") || document.querySelector("h1,h2,.t-title");
    let summary = document.getElementById("v2sd-account-summary");
    if (!summary) {
      summary = document.createElement("div");
      summary.id = "v2sd-account-summary";
      summary.style.cssText = "margin:22px auto 70px;text-align:center;font-size:24px;line-height:1.45;font-weight:400;";
      (heading?.parentNode || document.body).insertBefore(summary, heading?.nextSibling || null);
    }

    const styleSource = findLegacyProfileStyleSource(summary) || findOrdersTable();
    const sourceStyle = styleSource ? getComputedStyle(styleSource) : null;
    summary.style.fontFamily = sourceStyle?.fontFamily || "Arial, sans-serif";
    summary.style.fontSize = sourceStyle?.fontSize || "22px";
    summary.style.lineHeight = sourceStyle?.lineHeight || "1.45";
    summary.style.fontWeight = sourceStyle?.fontWeight || "400";
    summary.style.letterSpacing = sourceStyle?.letterSpacing || "normal";

    summary.innerHTML = [
      contact.email ? `<div>Почта: ${escapeHtml(contact.email)}</div>` : "",
      contact.birthdate
        ? `<div id="v2sd-birthday-row">День рождения: <span id="v2sd-birthday-value">${escapeHtml(formatDate(contact.birthdate))}</span> <button id="v2sd-birthday-edit" type="button" style="margin-left:8px;border:0;background:transparent;color:inherit;text-decoration:underline;cursor:pointer;font:inherit;font-size:.8em;">Изменить</button></div>`
        : `<div id="v2sd-birthday-row">День рождения: <button id="v2sd-birthday-edit" type="button" style="margin-left:4px;border:0;background:transparent;color:inherit;text-decoration:underline;cursor:pointer;font:inherit;padding:0;">Указать</button></div>`,
      `<div>Общая сумма покупок: ${formatMoney(loyalty.purchaseSum)}</div>`,
      `<div>Процент скидки: ${Number(loyalty.discountPercent || 0)}%</div>`,
      `<div>Бонусные баллы: ${Math.round(Number(loyalty.balance) || 0)}</div>`,
    ].filter(Boolean).join("");

    bindBirthdateEditor(account);

    if (contact.email) localStorage.setItem(`v2sd_bitrix_contact_id:${contact.email.toLowerCase()}`, String(contact.id || ""));
    localStorage.setItem("v2sd_loyalty_balance", String(loyalty.balance || 0));
    localStorage.setItem("v2sd_discount_percent", String(loyalty.discountPercent || 0));
    if (account.promo?.code) localStorage.setItem("v2sd_promocode", account.promo.code);
  }

  function toDateInputValue(value) {
    return value ? String(value).slice(0, 10) : "";
  }

  function bindBirthdateEditor(account) {
    const button = document.getElementById("v2sd-birthday-edit");
    if (!button) return;
    button.addEventListener("click", () => openBirthdateModal(account));
  }

  function openBirthdateModal(account) {
    document.getElementById("v2sd-birthday-modal")?.remove();
    const modal = document.createElement("div");
    modal.id = "v2sd-birthday-modal";
    modal.style.cssText = "position:fixed;inset:0;z-index:999999;display:grid;place-items:center;padding:20px;background:rgba(0,0,0,.42);font-family:Arial,sans-serif;";
    modal.innerHTML = `<div role="dialog" aria-modal="true" aria-labelledby="v2sd-birthday-title" style="width:min(420px,100%);padding:28px;border-radius:16px;background:#fff;color:#111;box-shadow:0 16px 48px rgba(0,0,0,.22);"><h3 id="v2sd-birthday-title" style="margin:0 0 18px;font-size:22px;">День рождения</h3><label style="display:grid;gap:8px;font-size:16px;">Выберите дату<input id="v2sd-birthday-input" type="date" value="${toDateInputValue(account.contact?.birthdate)}" max="${new Date().toISOString().slice(0, 10)}" style="padding:10px;border:1px solid #bbb;border-radius:6px;font:inherit;"></label><div id="v2sd-birthday-status" style="min-height:22px;margin-top:10px;font-size:14px;color:#c21f39;"></div><div style="display:flex;justify-content:flex-end;gap:10px;margin-top:18px;"><button id="v2sd-birthday-cancel" type="button" style="padding:10px 16px;border:1px solid #111;border-radius:5px;background:#fff;color:#111;cursor:pointer;font:inherit;">Отмена</button><button id="v2sd-birthday-save" type="button" style="padding:10px 16px;border:0;border-radius:5px;background:#cdf564;color:#111;cursor:pointer;font:inherit;font-weight:700;">Сохранить</button></div></div>`;
    document.body.appendChild(modal);
    document.getElementById("v2sd-birthday-cancel").addEventListener("click", () => modal.remove());
    modal.addEventListener("click", (event) => { if (event.target === modal) modal.remove(); });
    document.getElementById("v2sd-birthday-save").addEventListener("click", () => saveBirthdate(account, modal));
    document.getElementById("v2sd-birthday-input").focus();
  }

  async function saveBirthdate(account, modal) {
    const input = modal.querySelector("#v2sd-birthday-input");
    const status = modal.querySelector("#v2sd-birthday-status");
    const birthdate = input.value || "";
    if (!birthdate) {
      status.textContent = " Укажите дату.";
      return;
    }
    status.textContent = " Сохраняем...";
    try {
      const response = await fetch(`${API_BASE}/api/account/profile/birthdate`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          contactId: account.contact.id,
          email: account.contact.email,
          birthdate,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Не удалось сохранить дату рождения.");
      account.contact = payload.contact;
      modal.remove();
      renderSummary(account);
    } catch (error) {
      status.textContent = error.message;
    }
  }

  function findLegacyProfileStyleSource(summary) {
    return [...document.querySelectorAll("p,div,.t-text,.t-descr")].find((node) => {
      if (node === summary || summary.contains(node)) return false;
      const text = node.textContent.replace(/\s+/g, " ").trim().toLowerCase();
      return text.startsWith("почта:") && text.includes("бонусные баллы:");
    }) || null;
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

  function ensureOrdersTable() {
    return findOrdersTable();
  }

  function renderOrders(account, attempt = 0) {
    const table = ensureOrdersTable();
    if (!table) {
      if (attempt < 50) setTimeout(() => renderOrders(account, attempt + 1), 100);
      return;
    }
    let tbody = table.querySelector("tbody");
    if (!tbody) {
      tbody = document.createElement("tbody");
      table.appendChild(tbody);
    }
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
    const registrationBonus = registeredAt ? [{
      id: "registration-bonus",
      date: registeredAt,
      composition: "Бонусные баллы за регистрацию",
      sum: 0,
    }] : [];

    return [...orders, ...registrationBonus].sort((left, right) => {
      return new Date(right.date || 0).getTime() - new Date(left.date || 0).getTime();
    });
  }

  function renderPromo(account) {
    window.v2sdAccount = account;
    window.dispatchEvent(new CustomEvent("v2sd:account-loaded", { detail: account }));
  }

  function renderError(error) {
    console.error("V2SD account adapter:", error);
    const heading = findHeading("личный кабинет") || document.body;
    let box = document.getElementById("v2sd-account-error");
    if (!box) {
      box = document.createElement("div");
      box.id = "v2sd-account-error";
      box.style.cssText = "max-width:900px;margin:20px auto;text-align:center;color:#d72525;font-size:18px;";
      (heading.parentNode || document.body).insertBefore(box, heading.nextSibling || null);
    }
    box.textContent = error.message || "Не удалось загрузить данные личного кабинета.";
  }

  async function renderAccount(profile) {
    const account = await loadAccount(profile);
    renderSummary(account);
    renderOrders(account);
    renderPromo(account);
    return account;
  }

  ready(async function () {
    try {
      const firstProfile = getMemberProfile();
      const firstEmail = memberEmail(firstProfile);
      await renderAccount(firstProfile);

      waitForCurrentTildaProfile().then(async (currentProfile) => {
        if (memberEmail(currentProfile) && memberEmail(currentProfile) !== firstEmail) {
          await renderAccount(currentProfile);
        }
      }).catch((error) => console.warn("V2SD Tilda profile refresh failed:", error));
    } catch (error) {
      renderError(error);
    }
  });
})();
