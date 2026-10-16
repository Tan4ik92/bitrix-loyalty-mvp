(function () {
  const DEFAULT_API_BASE = "http://127.0.0.1:3100";
  const API_BASE = String(window.V2SD_BITRIX_ACCOUNT_API || DEFAULT_API_BASE).replace(/\/$/, "");
  const PROJECT_ID = document.getElementById("allrecords")?.getAttribute("data-tilda-project-id") || "";
  const PROFILE_KEYS = [PROJECT_ID ? `tilda_members_profile${PROJECT_ID}` : "", "memberarea_profile"].filter(Boolean);
  const BONUS_OPTIONS = [300, 500, 800];
  const LOYALTY_PROMO_CODES = {
    5: "LOYALTY5",
    7: "LOYALTY7",
    10: "LOYALTY10",
    ...(window.V2SD_LOYALTY_PROMO_CODES || {}),
  };

  const STATE = {
    account: null,
    loading: false,
    loadedFor: "",
    selectedBonus: 0,
    loyaltyCodeApplied: "",
    lastRenderSignature: "",
    delegatedClicksAttached: false,
  };

  function ready(callback) {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", callback);
    else callback();
  }

  function roundMoney(value) {
    const number = Number(value) || 0;
    if (typeof window.tcart_ceil === "function") return Number(window.tcart_ceil(number)) || 0;
    return Math.round(number * 100) / 100;
  }

  function formatMoney(value) {
    return `${Math.round(Number(value) || 0).toLocaleString("ru-RU")} \u20bd`;
  }

  function normalizePromoCode(value) {
    return String(value || "").replace(/\s+/g, "").trim().toUpperCase();
  }

  function getMemberProfile() {
    for (const key of PROFILE_KEYS) {
      try {
        const value = localStorage.getItem(key);
        if (value) return JSON.parse(value);
      } catch (error) {
        console.warn("V2SD safe cart profile parse failed:", key, error);
      }
    }
    return {};
  }

  function memberEmail(profile) {
    return String(profile.login || profile.email || profile.mail || "").trim().toLowerCase();
  }

  function cartEmail() {
    const input = document.querySelector('.t706 input[type="email"], .t706 input[name="email"], input[type="email"], input[name="email"]');
    return String(input?.value || "").trim().toLowerCase();
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

  function getBonusBalance(loyalty = {}) {
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
    return Math.max(balance, computed);
  }

  async function loadAccount(profile = getMemberProfile()) {
    const email = memberEmail(profile) || cartEmail();
    const contactId = memberContactId(profile, email);
    const key = contactId || email;
    if (!key || STATE.loadedFor === key || STATE.loading) return STATE.account;

    STATE.loading = true;
    try {
      const params = new URLSearchParams({ includeOrders: "false" });
      if (contactId) params.set("contactId", contactId);
      if (email) params.set("email", email);
      const response = await fetch(`${API_BASE}/api/account/profile?${params}`, {
        headers: { Accept: "application/json" },
      });
      const payload = await response.json();
      if (!response.ok || !payload.contact) throw new Error(payload.error || "Bitrix contact was not found.");
      STATE.account = payload;
      STATE.loadedFor = key;
      return payload;
    } catch (error) {
      console.warn("V2SD safe cart:", error.message);
      return null;
    } finally {
      STATE.loading = false;
    }
  }

  function getLoyaltyPercent() {
    return Math.max(0, Math.min(100, Number(STATE.account?.contact?.loyalty?.discountPercent || 0)));
  }

  function getLoyaltyPromoCode() {
    const percent = Math.round(getLoyaltyPercent());
    return normalizePromoCode(LOYALTY_PROMO_CODES[percent] || (percent > 0 ? `LOYALTY${percent}` : ""));
  }

  function findPromoInput() {
    const inputs = [...document.querySelectorAll('.t706 input, input')];
    return inputs.find((input) => {
      const text = `${input.name || ""} ${input.placeholder || ""} ${input.getAttribute("data-tilda-name") || ""}`.toLowerCase();
      return /promo|\u043f\u0440\u043e\u043c\u043e\u043a\u043e\u0434|gift|\u043f\u043e\u0434\u0430\u0440\u043e\u0447/.test(text);
    }) || null;
  }

  function findPromoApplyButton() {
    const input = findPromoInput();
    if (!input) return null;
    const roots = [
      input.closest?.(".t-inputpromocode__wrapper"),
      input.parentElement,
      input.closest?.(".t706"),
    ].filter(Boolean);
    const candidates = [];
    for (const root of roots) {
      candidates.push(...(root.querySelectorAll?.("button, input[type='button']") || []));
    }
    return candidates.find((element) => {
      if (element === input) return false;
      const text = `${element.textContent || ""} ${element.value || ""} ${element.getAttribute?.("aria-label") || ""}`.toLowerCase();
      return /\u043f\u0440\u0438\u043c\u0435\u043d|apply/.test(text);
    }) || null;
  }

  function getCurrentPromoCode() {
    const inputCode = normalizePromoCode(findPromoInput()?.value);
    const cartPromo = window.tcart?.promocode;
    const cartCode = normalizePromoCode(
      typeof cartPromo === "object" ? (cartPromo.promocode || cartPromo.code) : cartPromo,
    );
    return inputCode || cartCode;
  }

  function refreshTildaCartTotals() {
    const names = [
      "tcart__updateTotalProductsinCartObj",
      "tcart__reDrawTotal",
      "tcart__reDrawProducts",
      "tcart__reDrawCartIcon",
      "tcart__saveLocalObj",
    ];
    for (const name of names) {
      const fn = window[name];
      if (typeof fn !== "function") continue;
      try {
        fn(window.tcart);
      } catch {
        try {
          fn();
        } catch {
          // Tilda builds expose different helper signatures.
        }
      }
    }
  }

  function clearLoyaltyPromocode() {
    const code = getLoyaltyPromoCode();
    if (!code || getCurrentPromoCode() !== code) return false;
    restoreBonusBaseAmount();
    const input = findPromoInput();
    if (input) {
      input.value = "";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }
    const cart = window.tcart;
    const cartPromo = cart?.promocode;
    const cartCode = normalizePromoCode(
      typeof cartPromo === "object" ? (cartPromo.promocode || cartPromo.code) : cartPromo,
    );
    if (cart && cartCode === code) {
      delete cart.promocode;
      delete cart.discountsum;
      delete cart.discountpercent;
      delete cart.prodamount_discountsum;
      delete cart.prodamount_withdiscount;
      delete cart.amount_withoutdiscount;
    }
    STATE.loyaltyCodeApplied = "";
    refreshTildaCartTotals();
    setTimeout(refreshTildaCartTotals, 120);
    setTimeout(() => {
      applySelectedBonus("after loyalty promocode clear");
      STATE.lastRenderSignature = "";
      render();
    }, 450);
    return true;
  }

  function applyLoyaltyPromocode() {
    const code = getLoyaltyPromoCode();
    const input = findPromoInput();
    if (!code || !input) return;
    if (getCurrentPromoCode() === code && clearLoyaltyPromocode()) return;
    restoreBonusBaseAmount();
    input.value = code;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    const button = findPromoApplyButton();
    if (button && typeof button.click === "function") button.click();
    STATE.loyaltyCodeApplied = code;
    setTimeout(() => applySelectedBonus("after loyalty promocode"), 450);
    setTimeout(() => render(), 700);
  }

  function getCurrentTildaAmount() {
    return roundMoney(Number(window.tcart?.amount || window.tcart?.total || 0));
  }

  function getBonusBaseAmount() {
    const cart = window.tcart;
    if (!cart) return 0;
    const current = getCurrentTildaAmount();
    const base = Number(cart.v2sdBonusBaseAmount || 0);
    const applied = Number(cart.v2sdBonusAppliedAmount || 0);
    if (base > 0 && applied > 0) return roundMoney(base);
    return current;
  }

  function restoreBonusBaseAmount() {
    const cart = window.tcart;
    if (!cart) return;
    const base = Number(cart.v2sdBonusBaseAmount || 0);
    const applied = Number(cart.v2sdBonusAppliedAmount || 0);
    if (base > 0 && applied > 0) {
      cart.amount = roundMoney(base);
      cart.total = roundMoney(base);
    }
    delete cart.v2sdBonusBaseAmount;
    delete cart.v2sdBonusAppliedAmount;
    delete cart.v2sdBonusPayTotal;
  }

  function normalizeSelectedBonus(value, maxBonus) {
    const amount = Number(value) || 0;
    if (!amount) return 0;
    if (!BONUS_OPTIONS.includes(amount)) return 0;
    return amount <= roundMoney(maxBonus) ? amount : 0;
  }

  function applySelectedBonus(context = "") {
    const cart = window.tcart;
    if (!cart) return;
    try {
      const balance = roundMoney(getBonusBalance(STATE.account?.contact?.loyalty || {}));
      restoreBonusBaseAmount();
      const base = getCurrentTildaAmount();
      const bonus = normalizeSelectedBonus(STATE.selectedBonus, Math.min(balance, base));
      STATE.selectedBonus = bonus;
      if (!bonus) {
        syncHiddenFields(base, 0, context);
        return;
      }
      const payTotal = Math.max(0, roundMoney(base - bonus));
      cart.v2sdBonusBaseAmount = base;
      cart.v2sdBonusAppliedAmount = bonus;
      cart.v2sdBonusPayTotal = payTotal;
      cart.amount = payTotal;
      cart.total = payTotal;
      syncHiddenFields(payTotal, bonus, context);
      STATE.lastRenderSignature = "";
    } catch (error) {
      console.warn("V2SD safe cart bonus failed:", error);
      restoreBonusBaseAmount();
    }
  }

  function findCartForms() {
    return [...document.querySelectorAll(".t706 form")];
  }

  function setHidden(form, name, value) {
    if (!form) return;
    let input = form.querySelector(`input[name="${name}"]`);
    if (!input) {
      input = document.createElement("input");
      input.type = "hidden";
      input.name = name;
      form.appendChild(input);
    }
    input.value = value == null ? "" : String(value);
  }

  function syncHiddenFields(payTotal = getCurrentTildaAmount(), bonusUsed = STATE.selectedBonus, context = "") {
    for (const form of findCartForms()) {
      setHidden(form, "v2sd_contact_id", STATE.account?.contact?.id || "");
      setHidden(form, "v2sd_final_amount", roundMoney(payTotal));
      setHidden(form, "v2sd_bonus_balance", roundMoney(getBonusBalance(STATE.account?.contact?.loyalty || {})));
      setHidden(form, "v2sd_bonus_used", roundMoney(bonusUsed));
      setHidden(form, "v2sd_safe_cart_context", context);
    }
  }

  function ensurePanel() {
    let panel = document.getElementById("v2sd-loyalty-cart-safe");
    if (panel) return panel;
    const target = document.querySelector(".t706__cartwin-totalamount-wrap") ||
      document.querySelector(".t706__cartwin-prodamount-wrap") ||
      document.querySelector(".t706 .t-form__submit") ||
      document.querySelector(".t706");
    if (!target) return null;
    panel = document.createElement("div");
    panel.id = "v2sd-loyalty-cart-safe";
    panel.style.cssText = "margin:16px 0;text-align:right;font-family:inherit;font-size:15px;";
    target.insertAdjacentElement(target.classList?.contains("t706__cartwin-totalamount-wrap") ? "beforebegin" : "afterend", panel);
    return panel;
  }

  function renderBonusButtons(balance, baseAmount) {
    const maxBonus = Math.min(balance, baseAmount);
    return [0, ...BONUS_OPTIONS].map((amount) => {
      const disabled = amount > 0 && amount > maxBonus;
      const active = amount === STATE.selectedBonus;
      const label = amount > 0 ? formatMoney(amount) : "\u041d\u0435 \u0438\u0441\u043f\u043e\u043b\u044c\u0437\u043e\u0432\u0430\u0442\u044c";
      return `<button type="button" data-v2sd-safe-bonus="${amount}" ${disabled ? "disabled" : ""} style="margin:4px;padding:7px 12px;border:1px solid #ddd;border-radius:18px;background:${active ? "#c9ff4d" : "#fff"};cursor:${disabled ? "default" : "pointer"};">${label}</button>`;
    }).join("");
  }

  function render() {
    if (!window.tcart || !STATE.account) return;
    const panel = ensurePanel();
    if (!panel) return;
    const loyaltyPercent = getLoyaltyPercent();
    const loyaltyCode = getLoyaltyPromoCode();
    const loyaltyApplied = loyaltyCode && getCurrentPromoCode() === loyaltyCode;
    const balance = roundMoney(getBonusBalance(STATE.account.contact?.loyalty || {}));
    const baseAmount = getBonusBaseAmount();
    const payTotal = getCurrentTildaAmount();
    const signature = JSON.stringify({ loyaltyPercent, loyaltyCode, loyaltyApplied, balance, baseAmount, payTotal, selectedBonus: STATE.selectedBonus });
    if (signature === STATE.lastRenderSignature) return;
    STATE.lastRenderSignature = signature;
    panel.innerHTML = `
      ${loyaltyPercent > 0 ? `<div style="margin:6px 0;">\u041b\u043e\u044f\u043b\u044c\u043d\u043e\u0441\u0442\u044c ${loyaltyPercent}%: <button type="button" data-v2sd-safe-loyalty="1" style="padding:7px 12px;border:1px solid #ddd;border-radius:18px;background:${loyaltyApplied ? "#f2f2f2" : "#c9ff4d"};cursor:pointer;">${loyaltyApplied ? "\u041e\u0442\u043c\u0435\u043d\u0438\u0442\u044c" : "\u041f\u0440\u0438\u043c\u0435\u043d\u0438\u0442\u044c"} ${loyaltyCode}</button></div>` : ""}
      ${balance > 0 ? `<div style="margin:6px 0;">\u0411\u043e\u043d\u0443\u0441\u044b \u0434\u043e\u0441\u0442\u0443\u043f\u043d\u044b: <strong>${formatMoney(balance)}</strong></div><div>${renderBonusButtons(balance, baseAmount)}</div>` : ""}
      <div style="margin-top:10px;font-weight:700;">\u0418\u0442\u043e\u0433: ${formatMoney(payTotal)}</div>
    `;
  }

  function attachDelegatedClicks() {
    if (STATE.delegatedClicksAttached) return;
    STATE.delegatedClicksAttached = true;
    document.addEventListener("click", (event) => {
      const bonusButton = event.target?.closest?.("[data-v2sd-safe-bonus]");
      if (bonusButton) {
        STATE.selectedBonus = Number(bonusButton.getAttribute("data-v2sd-safe-bonus") || 0);
        applySelectedBonus("bonus selected delegated");
        render();
        return;
      }
      const loyaltyButton = event.target?.closest?.("[data-v2sd-safe-loyalty]");
      if (loyaltyButton) {
        applyLoyaltyPromocode();
        setTimeout(render, 900);
      }
    }, true);
  }

  function scheduleRender(delay = 250) {
    setTimeout(() => {
      try {
        render();
        syncHiddenFields();
      } catch (error) {
        console.warn("V2SD safe cart render failed:", error);
      }
    }, delay);
  }

  function attachObservers() {
    document.addEventListener("click", (event) => {
      if (event.target?.closest?.(".t706 .t-submit, .t706 button[type='submit'], .t706 input[type='submit']")) {
        applySelectedBonus("before payment click");
        return;
      }
      if (event.target?.closest?.(".t706")) scheduleRender(350);
    }, true);
    document.addEventListener("submit", (event) => {
      if (event.target?.closest?.(".t706")) applySelectedBonus("before form submit");
    }, true);
    document.addEventListener("tildaform:beforesend", (event) => {
      if (event.target?.closest?.(".t706")) applySelectedBonus("before Tilda send");
    }, true);
    document.addEventListener("change", (event) => {
      if (event.target?.closest?.(".t706")) {
        restoreBonusBaseAmount();
        scheduleRender(500);
        setTimeout(() => applySelectedBonus("after cart change"), 800);
      }
    }, true);
    document.addEventListener("input", (event) => {
      if (event.target === findPromoInput()) {
        restoreBonusBaseAmount();
        STATE.lastRenderSignature = "";
      }
    }, true);
  }

  async function init() {
    await loadAccount();
    attachDelegatedClicks();
    attachObservers();
    scheduleRender(250);
    scheduleRender(900);
    window.V2SD_SAFE_LOYALTY_CART_DEBUG = {
      state: STATE,
      applySelectedBonus,
      restoreBonusBaseAmount,
    };
  }

  ready(() => {
    init().catch((error) => console.warn("V2SD safe cart init failed:", error));
  });
}());
