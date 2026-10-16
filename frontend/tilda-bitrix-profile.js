(function () {
  const DEFAULT_API_BASE = "http://127.0.0.1:3100";
  const API_BASE = String(window.V2SD_BITRIX_ACCOUNT_API || DEFAULT_API_BASE).replace(/\/$/, "");
  const PROJECT_ID = document.getElementById("allrecords")?.getAttribute("data-tilda-project-id") || "";
  const PROFILE_KEYS = [PROJECT_ID ? `tilda_members_profile${PROJECT_ID}` : "", "memberarea_profile"].filter(Boolean);

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

  function memberToken(profile) {
    return String(profile.token || window.tcartAuthState?.mauser?.token || window.mauser?.token || "").trim();
  }

  function memberContactId(profile, email) {
    return String(
      profile.bitrixContactId || profile.bitrix_contact_id ||
      (email ? localStorage.getItem(`v2sd_bitrix_contact_id:${email}`) : "") ||
      new URLSearchParams(window.location.search).get("bitrixContactId") ||
      new URLSearchParams(window.location.search).get("contactId") || "",
    ).trim();
  }

  async function loadProfile(profile = getMemberProfile()) {
    const email = memberEmail(profile);
    const contactId = memberContactId(profile, email);
    if (!email && !contactId) throw new Error("Не найден email пользователя Tilda Members.");
    const params = new URLSearchParams({ includeOrders: "false" });
    if (contactId) params.set("contactId", contactId);
    if (email) params.set("email", email);
    const response = await fetch(`${API_BASE}/api/account/profile?${params}`, { headers: { Accept: "application/json" } });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Bitrix не вернул данные личного кабинета.");
    if (!payload.contact) throw new Error("Контакт не найден в Bitrix.");
    payload.memberEmail = email;
    payload.memberToken = memberToken(profile);
    payload.memberProjectId = String(profile.projectid || PROJECT_ID || "");
    return payload;
  }

  function memberAuthHeaders(account) {
    return {
      "X-Tilda-Member-Token": account.memberToken || "",
      "X-Tilda-Project-Id": account.memberProjectId || PROJECT_ID || "",
    };
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
    return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
  }


  function findHeading(text) {
    const expected = text.toLowerCase();
    return [...document.querySelectorAll("h1,h2,h3,.t-title,.t-heading,.t-name")]
      .find((node) => node.textContent.trim().toLowerCase().includes(expected));
  }

  function findLegacyProfileStyleSource(summary) {
    return [...document.querySelectorAll("p,div,.t-text,.t-descr")].find((node) => {
      if (node === summary || summary.contains(node)) return false;
      const text = node.textContent.replace(/\s+/g, " ").trim().toLowerCase();
      return text.startsWith("почта:") && text.includes("бонусные баллы:");
    }) || null;
  }

  function renderSummary(account) {
    const contact = account.contact;
    const loyalty = contact.loyalty || {};
    const loginEmail = account.memberEmail || contact.email || "";
    const heading = findHeading("личный кабинет") || document.querySelector("h1,h2,.t-title");
    let summary = document.getElementById("v2sd-account-summary");
    if (!summary) {
      summary = document.createElement("div");
      summary.id = "v2sd-account-summary";
      summary.style.cssText = "margin:22px auto 70px;text-align:center;font-size:24px;line-height:1.45;font-weight:400;";
      (heading?.parentNode || document.body).insertBefore(summary, heading?.nextSibling || null);
    }
    const styleSource = findLegacyProfileStyleSource(summary);
    const sourceStyle = styleSource ? getComputedStyle(styleSource) : null;
    summary.style.fontFamily = sourceStyle?.fontFamily || "Arial, sans-serif";
    summary.style.fontSize = sourceStyle?.fontSize || "22px";
    summary.style.lineHeight = sourceStyle?.lineHeight || "1.45";
    summary.style.fontWeight = sourceStyle?.fontWeight || "400";
    summary.style.letterSpacing = sourceStyle?.letterSpacing || "normal";
    const phones = Array.isArray(contact.phones) ? contact.phones.filter(Boolean) : (contact.phone ? [contact.phone] : []);
    summary.innerHTML = [
      `<div>ФИО: ${escapeHtml(contact.fullName || "Не указано")} <button id="v2sd-name-edit" type="button" style="margin-left:8px;border:0;background:transparent;color:inherit;text-decoration:underline;cursor:pointer;font:inherit;font-size:.8em;">Изменить</button></div>`,
      phones.length ? `<div>Телефон: ${phones.map(escapeHtml).join(", ")}</div>` : "",
      loginEmail ? `<div>Почта: ${escapeHtml(loginEmail)}</div>` : "",
      contact.birthdate
        ? `<div>День рождения: <span>${escapeHtml(formatDate(contact.birthdate))}</span></div>`
        : `<div>День рождения: <button id="v2sd-birthday-edit" type="button" style="margin-left:4px;border:0;background:transparent;color:inherit;text-decoration:underline;cursor:pointer;font:inherit;padding:0;">Указать</button></div>`,
      `<div>Общая сумма покупок: ${formatMoney(loyalty.purchaseSum)}</div>`,
      `<div>Процент скидки: ${Number(loyalty.discountPercent || 0)}%</div>`,
      `<div>Бонусные баллы: ${Math.round(Number(loyalty.balance) || 0)}</div>`,
    ].filter(Boolean).join("");
    // A birthday may be supplied once by the customer; later corrections are handled by staff.
    document.getElementById("v2sd-birthday-edit")?.addEventListener("click", () => openBirthdateModal(account));
    document.getElementById("v2sd-name-edit")?.addEventListener("click", () => openNameModal(account));
    if (loginEmail) localStorage.setItem(`v2sd_bitrix_contact_id:${loginEmail.toLowerCase()}`, String(contact.id || ""));
    window.v2sdProfileAccount = account;
    window.dispatchEvent(new CustomEvent("v2sd:profile-loaded", { detail: account }));
  }

  function openNameModal(account) {
    document.getElementById("v2sd-name-modal")?.remove();
    const contact = account.contact || {};
    const modal = document.createElement("div");
    modal.id = "v2sd-name-modal";
    modal.style.cssText = "position:fixed;inset:0;z-index:999999;display:grid;place-items:center;padding:20px;background:rgba(0,0,0,.42);font-family:Arial,sans-serif;";
    modal.innerHTML = `<div role="dialog" aria-modal="true" aria-labelledby="v2sd-name-title" style="width:min(460px,100%);padding:28px;border-radius:16px;background:#fff;color:#111;box-shadow:0 16px 48px rgba(0,0,0,.22);"><h3 id="v2sd-name-title" style="margin:0 0 18px;font-size:22px;">ФИО</h3><div style="display:grid;gap:12px;"><label style="display:grid;gap:6px;font-size:16px;">Фамилия<input id="v2sd-last-name" value="${escapeHtml(contact.lastName || "")}" maxlength="100" autocomplete="family-name" style="padding:10px;border:1px solid #bbb;border-radius:6px;font:inherit;"></label><label style="display:grid;gap:6px;font-size:16px;">Имя<input id="v2sd-first-name" value="${escapeHtml(contact.name || "")}" maxlength="100" autocomplete="given-name" style="padding:10px;border:1px solid #bbb;border-radius:6px;font:inherit;"></label><label style="display:grid;gap:6px;font-size:16px;">Отчество<input id="v2sd-second-name" value="${escapeHtml(contact.secondName || "")}" maxlength="100" autocomplete="additional-name" style="padding:10px;border:1px solid #bbb;border-radius:6px;font:inherit;"></label></div><div id="v2sd-name-status" style="min-height:22px;margin-top:10px;font-size:14px;color:#c21f39;"></div><div style="display:flex;justify-content:flex-end;gap:10px;margin-top:18px;"><button id="v2sd-name-cancel" type="button" style="padding:10px 16px;border:1px solid #111;border-radius:5px;background:#fff;color:#111;cursor:pointer;font:inherit;">Отмена</button><button id="v2sd-name-save" type="button" style="padding:10px 16px;border:0;border-radius:5px;background:#cdf564;color:#111;cursor:pointer;font:inherit;font-weight:700;">Сохранить</button></div></div>`;
    document.body.appendChild(modal);
    modal.querySelector("#v2sd-name-cancel").addEventListener("click", () => modal.remove());
    modal.addEventListener("click", (event) => { if (event.target === modal) modal.remove(); });
    modal.querySelector("#v2sd-name-save").addEventListener("click", () => saveName(account, modal));
    modal.querySelector("#v2sd-last-name").focus();
  }

  async function saveName(account, modal) {
    const lastName = modal.querySelector("#v2sd-last-name").value.trim();
    const name = modal.querySelector("#v2sd-first-name").value.trim();
    const secondName = modal.querySelector("#v2sd-second-name").value.trim();
    const status = modal.querySelector("#v2sd-name-status");
    if (!lastName || !name) { status.textContent = "Укажите фамилию и имя."; return; }
    status.textContent = "Сохраняем...";
    try {
      const response = await fetch(`${API_BASE}/api/account/profile/name`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json", ...memberAuthHeaders(account) },
        body: JSON.stringify({ contactId: account.contact.id, email: account.memberEmail, lastName, name, secondName }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Не удалось сохранить ФИО.");
      account.contact = payload.contact;
      modal.remove();
      renderSummary(account);
    } catch (error) { status.textContent = error.message; }
  }

  function openBirthdateModal(account) {
    document.getElementById("v2sd-birthday-modal")?.remove();
    const modal = document.createElement("div");
    modal.id = "v2sd-birthday-modal";
    modal.style.cssText = "position:fixed;inset:0;z-index:999999;display:grid;place-items:center;padding:20px;background:rgba(0,0,0,.42);font-family:Arial,sans-serif;";
    const current = account.contact?.birthdate ? String(account.contact.birthdate).slice(0, 10) : "";
    modal.innerHTML = `<div role="dialog" aria-modal="true" style="width:min(420px,100%);padding:28px;border-radius:16px;background:#fff;color:#111;box-shadow:0 16px 48px rgba(0,0,0,.22);"><h3 style="margin:0 0 18px;font-size:22px;">День рождения</h3><label style="display:grid;gap:8px;font-size:16px;">Выберите дату<input id="v2sd-birthday-input" type="date" value="${current}" max="${new Date().toISOString().slice(0, 10)}" style="padding:10px;border:1px solid #bbb;border-radius:6px;font:inherit;"></label><div id="v2sd-birthday-status" style="min-height:22px;margin-top:10px;font-size:14px;color:#c21f39;"></div><div style="display:flex;justify-content:flex-end;gap:10px;margin-top:18px;"><button id="v2sd-birthday-cancel" type="button" style="padding:10px 16px;border:1px solid #111;border-radius:5px;background:#fff;color:#111;cursor:pointer;font:inherit;">Отмена</button><button id="v2sd-birthday-save" type="button" style="padding:10px 16px;border:0;border-radius:5px;background:#cdf564;color:#111;cursor:pointer;font:inherit;font-weight:700;">Сохранить</button></div></div>`;
    document.body.appendChild(modal);
    modal.querySelector("#v2sd-birthday-cancel").addEventListener("click", () => modal.remove());
    modal.addEventListener("click", (event) => { if (event.target === modal) modal.remove(); });
    modal.querySelector("#v2sd-birthday-save").addEventListener("click", () => saveBirthdate(account, modal));
    modal.querySelector("#v2sd-birthday-input").focus();
  }

  async function saveBirthdate(account, modal) {
    const birthdate = modal.querySelector("#v2sd-birthday-input").value;
    const status = modal.querySelector("#v2sd-birthday-status");
    if (!birthdate) { status.textContent = "Укажите дату."; return; }
    status.textContent = "Сохраняем...";
    try {
      const response = await fetch(`${API_BASE}/api/account/profile/birthdate`, {
        method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json", ...memberAuthHeaders(account) },
        body: JSON.stringify({ contactId: account.contact.id, email: account.memberEmail, birthdate }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Не удалось сохранить дату рождения.");
      account.contact = payload.contact;
      modal.remove();
      renderSummary(account);
    } catch (error) { status.textContent = error.message; }
  }

  function renderError(error) { console.error("V2SD profile adapter:", error); }

  async function renderProfile(profile) { const account = await loadProfile(profile); renderSummary(account); }

  ready(async () => {
    try {
      const firstProfile = getMemberProfile();
      const firstEmail = memberEmail(firstProfile);
      await renderProfile(firstProfile);
      waitForCurrentTildaProfile().then((profile) => {
        if (memberEmail(profile) && memberEmail(profile) !== firstEmail) return renderProfile(profile);
      }).catch(renderError);
    } catch (error) { renderError(error); }
  });
})();
