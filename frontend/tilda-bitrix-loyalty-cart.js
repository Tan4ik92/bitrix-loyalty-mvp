(function () {
  const DEFAULT_API_BASE = "http://127.0.0.1:3100";
  const API_BASE = String(window.V2SD_BITRIX_ACCOUNT_API || DEFAULT_API_BASE).replace(/\/$/, "");
  const PROJECT_ID = document.getElementById("allrecords")?.getAttribute("data-tilda-project-id") || "";
  const PROFILE_KEYS = [PROJECT_ID ? `tilda_members_profile${PROJECT_ID}` : "", "memberarea_profile"].filter(Boolean);
  const STATE = {
    account: null,
    loading: false,
    loadedFor: "",
    loyaltyEnabled: false,
    selectedBonus: 0,
    lastAppliedBonusAmount: 0,
    lastBonusSignature: "",
    lastSignature: "",
    lastCalc: null,
    promo: null,
    promoLoading: false,
    promoCode: "",
    promoMessage: "",
    promoSignature: "",
    lastAppliedTildaCode: "",
    lastPromoLookupCode: "",
    paymentHookInstalled: false,
    visibleTotalsObserver: null,
    visibleTotalsTimer: null,
    refreshSyncTimer: null,
  };
  const LOYALTY_PROMO_CODES = {
    5: "LOYALTY5",
    7: "LOYALTY7",
    10: "LOYALTY10",
    ...(window.V2SD_LOYALTY_PROMO_CODES || {}),
  };
  const BONUS_OPTIONS = [300, 500, 800];

  function ready(callback) {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", callback);
    else callback();
  }

  function hasCartContext() {
    return Boolean(window.tcart || document.querySelector(".t706"));
  }

  function isCartEvent(event) {
    const target = event?.target;
    return Boolean(target?.closest?.(".t706") || document.body.classList.contains("t706__body_cartwinshowed"));
  }

  function getMemberProfile() {
    for (const key of PROFILE_KEYS) {
      try {
        const value = localStorage.getItem(key);
        if (value) return JSON.parse(value);
      } catch (error) {
        console.warn("V2SD loyalty cart profile parse failed:", key, error);
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
      if (!response.ok) throw new Error(payload.error || "Bitrix Ð½Ðµ Ð²ÐµÑ€Ð½ÑƒÐ» Ð´Ð°Ð½Ð½Ñ‹Ðµ Ð»Ð¾ÑÐ»ÑŒÐ½Ð¾ÑÑ‚Ð¸.");
      if (!payload.contact) throw new Error("ÐšÐ¾Ð½Ñ‚Ð°ÐºÑ‚ Ð½Ðµ Ð½Ð°Ð¹Ð´ÐµÐ½ Ð² Bitrix.");
      STATE.account = payload;
      STATE.loadedFor = key;
      const loyalty = payload.contact.loyalty || {};
      localStorage.setItem("v2sd_loyalty_balance", String(getBonusBalance(loyalty)));
      localStorage.setItem("v2sd_discount_percent", String(Number(loyalty.discountPercent || 0)));
      if (payload.contact.email) {
        localStorage.setItem(`v2sd_bitrix_contact_id:${payload.contact.email.toLowerCase()}`, String(payload.contact.id || ""));
      }
      window.dispatchEvent(new CustomEvent("v2sd:cart-loyalty-loaded", { detail: payload }));
      return payload;
    } catch (error) {
      console.warn("V2SD loyalty cart:", error.message);
      return null;
    } finally {
      STATE.loading = false;
    }
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

  function getSourceBonusAvailable(loyalty = {}, source) {
    const value = loyalty[source] && typeof loyalty[source] === "object"
      ? Number(loyalty[source].available || 0)
      : 0;
    return Math.max(0, value);
  }

  function roundMoney(value) {
    const number = Number(value) || 0;
    if (typeof window.tcart_ceil === "function") return Number(window.tcart_ceil(number)) || 0;
    return Math.round(number * 100) / 100;
  }

  function formatMoney(value) {
    const number = Number(value) || 0;
    const rounded = roundMoney(number);
    const hasFraction = Math.abs(rounded - Math.round(rounded)) > 0.001;
    return `${rounded.toLocaleString("ru-RU", {
      minimumFractionDigits: hasFraction ? 1 : 0,
      maximumFractionDigits: 2,
    })} \u20bd`;
  }

  function numberFromText(value) {
    const normalized = String(value || "").replace(/[^\d,.-]/g, "").replace(/\s+/g, "").replace(",", ".");
    const number = Number(normalized);
    return Number.isFinite(number) ? number : 0;
  }

  function getCartProducts() {
    return Array.isArray(window.tcart?.products) ? window.tcart.products : [];
  }

  function cleanupLegacyCartState() {
    const cart = window.tcart;
    if (!cart) return;
    delete cart.v2sdLoyalty;
    delete cart.v2sdLoyaltyApplied;
    delete cart.v2sdLoyaltyAppliedAmount;
    delete cart.v2sdLoyaltyOriginalAmount;
  }

  function normalizePromoCode(value) {
    return String(value || "").replace(/\s+/g, "").trim().toUpperCase();
  }

  function getLoyaltyPromoCode(percent) {
    const value = Math.round(Number(percent) || 0);
    return normalizePromoCode(LOYALTY_PROMO_CODES[value] || (value > 0 ? `LOYALTY${value}` : ""));
  }

  function isLoyaltyPromoCode(code) {
    const normalized = normalizePromoCode(code);
    return normalized.startsWith("LOYALTY") ||
      Object.values(LOYALTY_PROMO_CODES).some((value) => normalizePromoCode(value) === normalized);
  }

  function findPromoInput() {
    const inputs = [...document.querySelectorAll('.t706 input, input')];
    return inputs.find((input) => {
      const text = `${input.name || ""} ${input.placeholder || ""} ${input.getAttribute("data-tilda-name") || ""}`.toLowerCase();
      return /promo|Ð¿Ñ€Ð¾Ð¼Ð¾ÐºÐ¾Ð´|gift|Ð¿Ð¾Ð´Ð°Ñ€Ð¾Ñ‡/.test(text);
    }) || null;
  }

  async function lookupPromocode(code) {
    const normalized = normalizePromoCode(code);
    STATE.promoCode = normalized;
    STATE.promo = null;
    STATE.promoMessage = "";
    if (!normalized) return null;

    STATE.promoLoading = true;
    STATE.promoMessage = "ÐŸÑ€Ð¾Ð²ÐµÑ€ÑÐµÐ¼ Ð¿Ñ€Ð¾Ð¼Ð¾ÐºÐ¾Ð´...";
    try {
      const response = await fetch(`${API_BASE}/api/promocodes/lookup?code=${encodeURIComponent(normalized)}`, {
        headers: { Accept: "application/json" },
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "ÐŸÑ€Ð¾Ð¼Ð¾ÐºÐ¾Ð´ Ð½Ðµ Ð½Ð°Ð¹Ð´ÐµÐ½.");
      STATE.promo = payload.promo;
      STATE.promoCode = normalizePromoCode(payload.promo?.code || normalized);
      STATE.promoMessage = `ÐŸÑ€Ð¾Ð¼Ð¾ÐºÐ¾Ð´ Ð¿Ñ€Ð¸Ð¼ÐµÐ½Ñ‘Ð½: ÑÐºÐ¸Ð´ÐºÐ° ${Number(payload.promo?.discountPercent || 0)}%.`;
      return STATE.promo;
    } catch (error) {
      STATE.promo = null;
      STATE.promoMessage = "";
      console.warn("V2SD loyalty cart promocode lookup failed:", error);
      return null;
    } finally {
      STATE.promoLoading = false;
    }
  }

  function getCurrentPromoCode() {
    const input = findPromoInput();
    if (input) return normalizePromoCode(input.value);
    return normalizePromoCode(STATE.promoCode);
  }

  function setPromoInputValue(code) {
    const input = findPromoInput();
    if (!input) return;
    input.value = code || "";
    try {
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    } catch {
      // Older browsers can ignore synthetic events here; Tilda reads tcart too.
    }
  }

  function getAppliedTildaPromo({ includeLoyalty = false } = {}) {
    const cartPromo = window.tcart?.promocode;
    if (cartPromo && typeof cartPromo === "object") {
      const exclusionPromo = window.tcart?.v2sdNonDiscountableOriginalPromo;
      if (exclusionPromo && typeof exclusionPromo === "object") {
        const code = normalizePromoCode(exclusionPromo.code);
        const discountPercent = Math.max(0, Math.min(100, Number(exclusionPromo.discountPercent || 0)));
        const discountAmount = roundMoney(Number(exclusionPromo.discountAmount || 0));
        if (code && !includeLoyalty && isLoyaltyPromoCode(code)) return null;
        if (code && (discountPercent || discountAmount) && (includeLoyalty || !isLoyaltyPromoCode(code))) {
          return { code, discountPercent, discountAmount };
        }
      }
      const combinedPromo = window.tcart?.v2sdCombinedDiscountPromo;
      if (combinedPromo && typeof combinedPromo === "object") {
        const code = normalizePromoCode(combinedPromo.code);
        const discountPercent = Math.max(0, Math.min(100, Number(combinedPromo.discountPercent || 0)));
        const discountAmount = roundMoney(Number(combinedPromo.discountAmount || 0));
        if (code && !includeLoyalty && isLoyaltyPromoCode(code)) return null;
        if (code && (discountPercent || discountAmount) && (includeLoyalty || !isLoyaltyPromoCode(code))) {
          return { code, discountPercent, discountAmount };
        }
        return null;
      }
      const code = normalizePromoCode(cartPromo.promocode || cartPromo.code);
      const discountPercent = Math.max(0, Math.min(100, Number(cartPromo.discountpercent || 0)));
      const discountAmount = roundMoney(Number(cartPromo.discountsum || cartPromo.prodamount_discountsum || 0));
      if (code && !includeLoyalty && isLoyaltyPromoCode(code)) return null;
      if (code && (discountPercent || discountAmount) && (includeLoyalty || !isLoyaltyPromoCode(code))) {
        return { code, discountPercent, discountAmount };
      }
    }
    const cart = document.querySelector(".t706");
    if (!cart) return null;
    const lines = getVisibleTextLines(cart);
    const allText = lines.join("\n");
    const activatedWord = "\u0430\u043a\u0442\u0438\u0432\u0438\u0440\u043e\u0432\u0430\u043d";
    const promocodeWord = "\u043f\u0440\u043e\u043c\u043e\u043a\u043e\u0434";
    const discountLabel = "\u0432\u0430\u0448\u0430 \u0441\u043a\u0438\u0434\u043a\u0430";
    const codeSource = lines.find((line) => {
      const lower = line.toLowerCase();
      return lower.includes(activatedWord) && lower.includes(promocodeWord);
    }) || allText;
    const percentSource = lines.find((line) => line.toLowerCase().includes(discountLabel)) || allText;
    const codePattern = promocodeWord + "\\s+([a-z\\u0430-\\u044f\\u04510-9_-]{2,40})\\s+" + activatedWord;
    const percentPattern = discountLabel.replace(" ", "\\s+") + ":\\s*([\\d.,]+)\\s*%";
    const amountPattern = discountLabel.replace(" ", "\\s+") + ":\\s*([\\d\\s.,]+)\\s*(?:\u20bd|р|руб)";
    const codeMatch = codeSource.match(new RegExp(codePattern, "i"));
    const percentMatch = percentSource.match(new RegExp(percentPattern, "i"));
    const amountMatch = percentSource.match(new RegExp(amountPattern, "i"));
    const code = normalizePromoCode(codeMatch?.[1]);
    const discountPercent = Math.max(0, Math.min(100, Number(String(percentMatch?.[1] || "").replace(",", ".")) || 0));
    const discountAmount = roundMoney(numberFromText(amountMatch?.[1]));
    if (!code || (!discountPercent && !discountAmount) || (!includeLoyalty && isLoyaltyPromoCode(code))) return null;
    return {
      code,
      discountPercent,
      discountAmount: discountAmount || roundMoney(getSubtotal() * discountPercent / 100),
    };
  }

  function syncVisibleTildaPromoState() {
    const visiblePromo = getAppliedTildaPromo();
    if (!visiblePromo) return null;
    const code = normalizePromoCode(visiblePromo.code);
    if (!code) return visiblePromo;
    STATE.promo = visiblePromo;
    STATE.promoCode = code;
    STATE.lastPromoLookupCode = code;
    STATE.promoLoading = false;
    STATE.promoMessage = "";
    return visiblePromo;
  }

  function getVisibleTextLines(root) {
    const lines = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const text = String(node.nodeValue || "").replace(/\s+/g, " ").trim();
        if (!text) return NodeFilter.FILTER_REJECT;
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        const style = window.getComputedStyle(parent);
        if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    while (walker.nextNode()) {
      const text = String(walker.currentNode.nodeValue || "").replace(/\s+/g, " ").trim();
      if (text) lines.push(text);
    }
    return lines;
  }

  function ensurePromocodeLookupStarted() {
    const code = getCurrentPromoCode();
    if (!code) {
      STATE.promo = null;
      STATE.promoCode = "";
      STATE.lastPromoLookupCode = "";
      STATE.promoMessage = "";
      return;
    }
    if (isLoyaltyPromoCode(code)) {
      STATE.promo = null;
      STATE.promoCode = code;
      STATE.promoMessage = "";
      return;
    }
    if (STATE.promoLoading) return;
    const visiblePromo = syncVisibleTildaPromoState();
    if (visiblePromo && code === normalizePromoCode(visiblePromo.code)) return;
    if (code === normalizePromoCode(STATE.promo?.code)) return;
    if (code === STATE.lastPromoLookupCode) return;
    STATE.lastPromoLookupCode = code;
    lookupPromocode(code).then(scheduleApply);
  }

  function getSubtotal() {
    const direct = Number(window.tcart?.prodamount);
    if (Number.isFinite(direct) && direct > 0) return direct;
    const productsTotal = getCartProducts().reduce((sum, product) => {
      const amount = Number(product.amount);
      const quantity = Number(product.quantity || product.qty || 1);
      const price = Number(product.price || 0);
      return sum + (Number.isFinite(amount) && amount > 0 ? amount : price * quantity);
    }, 0);
    if (productsTotal > 0) return productsTotal;
    return numberFromText(document.querySelector(".t706__cartwin-prodamount")?.textContent);
  }

  const NON_DISCOUNTABLE_PRODUCT_IDS = new Set([
    "2p8AQPJFhkOdzuQ5QDfyY3",
    "jjBIe389hY-R62VLIA4nw0",
  ]);
  const NON_DISCOUNTABLE_PRODUCT_NAMES = new Set([
    "Пакет маленький крафтовый",
    "Пакет большой крафтовый",
    "Маленький подарочный пакет (35×25×15)",
    "Большой подарочный пакет (40×30×15)",
  ]);

  function getProductAmount(product) {
    const amount = Number(product?.amount);
    const quantity = Number(product?.quantity || product?.qty || 1);
    const price = Number(product?.price || 0);
    return roundMoney(Number.isFinite(amount) && amount >= 0 ? amount : price * quantity);
  }

  function isDiscountEligibleProduct(product) {
    if (product?.v2sdDiscountEligible === false || product?.v2sdBonusEligible === false) return false;
    if (product?.v2sdGiftPackaging) return false;
    const externalId = String(product?.externalid || product?.externalId || product?.sku || product?.SKU || "").trim();
    const name = String(product?.name || product?.title || product?.product || product?.product_name || "")
      .replace(/\s+/g, " ").trim();
    return !NON_DISCOUNTABLE_PRODUCT_IDS.has(externalId.split("#")[0]) && !NON_DISCOUNTABLE_PRODUCT_NAMES.has(name);
  }

  function getDiscountEligibleSubtotal(subtotal = getSubtotal()) {
    const products = getCartProducts();
    if (!products.length) return roundMoney(subtotal);
    return Math.min(roundMoney(subtotal), roundMoney(products.reduce((sum, product) => (
      sum + (isDiscountEligibleProduct(product) ? getProductAmount(product) : 0)
    ), 0)));
  }

  function getExternalCartAmount(subtotal) {
    const cart = window.tcart || {};
    const current = Number(cart.v2sdBonusBaseAmount || cart.amount);
    return Number.isFinite(current) && current > 0 ? current : subtotal;
  }

  function ensureStyle() {
    if (document.getElementById("v2sd-loyalty-cart-style")) return;
    const style = document.createElement("style");
    style.id = "v2sd-loyalty-cart-style";
    style.textContent = `
      .v2sd-loyalty-cart {
        margin: 16px 0 8px;
        font-family: var(--t-text-font, Arial), Arial, sans-serif;
        font-size: 14px;
        line-height: 1.35;
        color: #000;
        text-align: right;
      }
      .v2sd-loyalty-cart__line {
        display: flex;
        justify-content: flex-end;
        gap: 12px;
        margin: 4px 0;
      }
      .v2sd-loyalty-cart__bonus {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: 10px;
        margin-top: 10px;
      }
      .v2sd-loyalty-cart__bonus-options {
        display: flex;
        justify-content: flex-end;
        flex-wrap: wrap;
        gap: 6px;
        margin-top: 8px;
      }
      .v2sd-loyalty-cart__bonus-button {
        border: 1px solid #d8d8d8;
        background: #fff;
        color: #000;
        border-radius: 999px;
        padding: 6px 12px;
        font: inherit;
        line-height: 1;
        cursor: pointer;
      }
      .v2sd-loyalty-cart__bonus-button_active {
        border-color: #cdf564;
        background: #cdf564;
        font-weight: 700;
      }
      .v2sd-loyalty-cart__bonus-button:disabled {
        opacity: 0.45;
        cursor: not-allowed;
      }
      .v2sd-loyalty-cart__total {
        margin-top: 8px;
        font-weight: 700;
        text-transform: uppercase;
      }
      .v2sd-loyalty-cart__message {
        margin-top: 4px;
        color: #008000;
      }
      .v2sd-loyalty-cart__message_error {
        color: #c00;
      }
      @media screen and (max-width: 560px) {
        .v2sd-loyalty-cart { text-align: left; }
        .v2sd-loyalty-cart__line,
        .v2sd-loyalty-cart__bonus,
        .v2sd-loyalty-cart__bonus-options { justify-content: space-between; }
      }
    `;
    document.head.appendChild(style);
  }

  function findCartForm() {
    return document.querySelector(".t706 form, form");
  }

  function findCartForms() {
    const cartForms = [...document.querySelectorAll(".t706 form")];
    if (cartForms.length > 0) return cartForms;
    const fallback = findCartForm();
    return fallback ? [fallback] : [];
  }

  function findCartInsertTarget() {
    return document.querySelector(".t706__cartwin-totalamount-wrap") ||
      document.querySelector(".t706__cartwin-prodamount-wrap") ||
      document.querySelector(".t706__cartwin-bottom") ||
      findCartForm();
  }

  function ensurePanel() {
    ensureStyle();
    let panel = document.getElementById("v2sd-loyalty-cart");
    if (panel) return panel;
    const target = findCartInsertTarget();
    if (!target) return null;
    panel = document.createElement("div");
    panel.id = "v2sd-loyalty-cart";
    panel.className = "v2sd-loyalty-cart";
    target.insertAdjacentElement(target.classList?.contains("t706__cartwin-totalamount-wrap") ? "beforebegin" : "afterend", panel);
    return panel;
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

  function normalizeSelectedBonus(value, maxBonus) {
    const amount = Number(value) || 0;
    if (!amount) return 0;
    if (!BONUS_OPTIONS.includes(amount)) return 0;
    return amount <= roundMoney(maxBonus) ? amount : 0;
  }

  function renderBonusOptions(calc) {
    if (!(calc.bonusBalance > 0)) return "";
    const buttons = [0, ...BONUS_OPTIONS].map((amount) => {
      const disabled = amount > 0 && amount > calc.maxBonus;
      const active = amount === calc.bonusUsed;
      const label = amount > 0 ? formatMoney(amount) : "\u041d\u0435 \u0438\u0441\u043f\u043e\u043b\u044c\u0437\u043e\u0432\u0430\u0442\u044c";
      return `
        <button
          type="button"
          class="v2sd-loyalty-cart__bonus-button ${active ? "v2sd-loyalty-cart__bonus-button_active" : ""}"
          data-v2sd-bonus="${amount}"
          ${disabled ? "disabled" : ""}
        >${label}</button>`;
    }).join("");
    return `
      <div class="v2sd-loyalty-cart__bonus">
        <span>\u0421\u043f\u0438\u0441\u0430\u0442\u044c \u0431\u043e\u043d\u0443\u0441\u044b</span>
        <strong>${calc.bonusUsed > 0 ? `-${formatMoney(calc.bonusUsed)}` : formatMoney(0)}</strong>
      </div>
      <div class="v2sd-loyalty-cart__bonus-options">${buttons}</div>`;
  }

  function renderLoyaltyOption(calc) {
    if (!(calc.rawLoyaltyPercent > 0)) return "";
    return `
      <div class="v2sd-loyalty-cart__bonus-options">
        <button
          type="button"
          class="v2sd-loyalty-cart__bonus-button ${STATE.loyaltyEnabled ? "v2sd-loyalty-cart__bonus-button_active" : ""}"
          data-v2sd-loyalty-toggle="1"
        >${STATE.loyaltyEnabled ? "\u041b\u043e\u044f\u043b\u044c\u043d\u043e\u0441\u0442\u044c \u0432\u043a\u043b\u044e\u0447\u0435\u043d\u0430" : "\u0418\u0441\u043f\u043e\u043b\u044c\u0437\u043e\u0432\u0430\u0442\u044c \u043b\u043e\u044f\u043b\u044c\u043d\u043e\u0441\u0442\u044c"}</button>
      </div>`;
  }

  function attachLoyaltyOptionHandlers(panel) {
    panel.querySelectorAll?.("[data-v2sd-loyalty-toggle]").forEach((button) => {
      button.addEventListener("click", () => {
        STATE.loyaltyEnabled = !STATE.loyaltyEnabled;
        STATE.lastSignature = "";
        STATE.promoSignature = "";
        scheduleApply();
        setTimeout(() => safeForcePaymentSync("loyalty toggle"), 180);
      });
    });
  }

  function attachBonusOptionHandlers(panel) {
    panel.querySelectorAll?.("[data-v2sd-bonus]").forEach((button) => {
      button.addEventListener("click", () => {
        const amount = Number(button.getAttribute("data-v2sd-bonus") || 0);
        STATE.selectedBonus = amount;
        STATE.lastSignature = "";
        if (!amount) {
          clearBonusAdjustment();
          refreshTildaCartTotals();
        }
        scheduleApply();
        setTimeout(() => safeForcePaymentSync("bonus change"), 140);
      });
    });
  }

  function renderPanel(calc) {
    const panel = ensurePanel();
    if (!panel) return;
    if (!calc.hasLoyalty && !calc.bonusBalance) {
      panel.innerHTML = "";
      return;
    }
    panel.innerHTML = [
      calc.hasLoyalty ? `
        <div class="v2sd-loyalty-cart__line">
          <span>\u0421\u043a\u0438\u0434\u043a\u0430 \u043f\u043e \u043f\u0440\u043e\u0433\u0440\u0430\u043c\u043c\u0435 \u043b\u043e\u044f\u043b\u044c\u043d\u043e\u0441\u0442\u0438: ${calc.rawLoyaltyPercent}%</span>
          <strong>${calc.loyaltyDiscountAmount > 0 ? `-${formatMoney(calc.loyaltyDiscountAmount)}` : formatMoney(calc.rawLoyaltyDiscountAmount)}</strong>
        </div>` : "",
      renderLoyaltyOption(calc),
      calc.promoDiscountAmount > 0 ? `
        <div class="v2sd-loyalty-cart__line">
          <span>\u041f\u0440\u043e\u043c\u043e\u043a\u043e\u0434 ${calc.promoCode}${calc.promoDiscountPercent > 0 ? `: ${calc.promoDiscountPercent}%` : ""}</span>
          <strong>-${formatMoney(calc.promoDiscountAmount)}</strong>
        </div>` : "",
      calc.bonusBalance > 0 ? `
        <div class="v2sd-loyalty-cart__line">
          <span>\u0411\u043e\u043d\u0443\u0441\u044b \u0434\u043e\u0441\u0442\u0443\u043f\u043d\u044b</span>
          <strong>${formatMoney(calc.bonusBalance)}</strong>
        </div>` : "",
      renderBonusOptions(calc),
      `
        <div class="v2sd-loyalty-cart__line v2sd-loyalty-cart__total">
          <span>\u0418\u0442\u043e\u0433\u043e\u0432\u0430\u044f \u0441\u0443\u043c\u043c\u0430 \u0431\u0435\u0437 \u0443\u0447\u0435\u0442\u0430 \u0434\u043e\u0441\u0442\u0430\u0432\u043a\u0438</span>
          <strong>${formatMoney(calc.productsPayTotal)}</strong>
        </div>`,
      STATE.promoMessage ? `
        <div class="v2sd-loyalty-cart__message ${STATE.promo && !STATE.promoLoading ? "" : "v2sd-loyalty-cart__message_error"}">
          ${STATE.promoMessage}
        </div>` : "",
    ].join("");
    attachLoyaltyOptionHandlers(panel);
    attachBonusOptionHandlers(panel);
  }
  function updateHiddenFields(calc) {
    const finalAmount = getEffectivePayTotal(calc);
    for (const form of findCartForms()) {
      setHidden(form, "v2sd_contact_id", calc.contactId);
      setHidden(form, "v2sd_final_amount", finalAmount);
      setHidden(form, "v2sd_total_discount_amount", calc.totalDiscountAmount);
      setHidden(form, "v2sd_loyalty_discount_percent", calc.loyaltyPercent);
      setHidden(form, "v2sd_loyalty_discount_amount", calc.loyaltyDiscountAmount);
      setHidden(form, "v2sd_promo_code", calc.promoCode);
      setHidden(form, "v2sd_promo_discount_percent", calc.promoDiscountPercent);
      setHidden(form, "v2sd_promo_discount_amount", calc.promoDiscountAmount);
      setHidden(form, "v2sd_bonus_balance", calc.bonusBalance);
      setHidden(form, "v2sd_bonus_used", calc.bonusUsed);
      setHidden(form, "v2sd_welcome_bonus_available", calc.welcomeBonusAvailable);
      setHidden(form, "v2sd_welcome_bonus_used", calc.welcomeBonusUsed);
      setHidden(form, "v2sd_birthday_bonus_available", calc.birthdayBonusAvailable);
      setHidden(form, "v2sd_birthday_bonus_used", calc.birthdayBonusUsed);
      setHidden(form, "v2sd_loyalty_pay_total", finalAmount);
      setHidden(form, "v2sd_loyalty_subtotal", calc.subtotal);
      setHidden(form, "v2sd_loyalty_products_pay_total", calc.productsPayTotal);
      setHidden(form, "v2sd_loyalty_base_amount", calc.baseAmount);
      setHidden(form, "v2sd_loyalty_external_amount", calc.externalAmount);
    }
    if (calc.bonusUsed > 0) scheduleVisibleTildaTotalsSync({ ...calc, payTotal: finalAmount });
  }

  function normalizeLabelText(value) {
    return String(value || "").replace(/\s+/g, " ").trim().toUpperCase();
  }

  function getTotalInfoValueNode(label) {
    if (!label) return null;
    let node = label.nextElementSibling;
    while (node) {
      if (String(node.className || "").includes("t706__cartwin-totalamount-info_value")) return node;
      node = node.nextElementSibling;
    }
    return label.parentElement?.querySelector?.(".t706__cartwin-totalamount-info_value") || null;
  }

  function syncVisibleTildaTotals(calc) {
    if (!calc) return;
    if (!(roundMoney(calc.bonusUsed) > 0)) return;
    const totalNodes = document.querySelectorAll?.(".t706__cartwin-totalamount, .t706__cartpage-order-total-value") || [];
    totalNodes.forEach((node) => {
      const value = formatMoney(calc.payTotal).replace(/\s?₽$/, "");
      if (node.textContent !== value) node.textContent = value;
    });
    const labels = document.querySelectorAll?.(".t706__cartwin-totalamount-info_label") || [];
    labels.forEach((label) => {
      const text = normalizeLabelText(label.textContent || label.innerText);
      const valueNode = getTotalInfoValueNode(label);
      if (!valueNode) return;
      if (text.includes("\u0421\u041a\u0418\u0414\u041a\u0410")) {
        const value = formatMoney(calc.totalDiscountAmount);
        if (valueNode.textContent !== value) valueNode.textContent = value;
      } else if (text.includes("\u0421\u0423\u041c\u041c\u0410 \u0421\u041e \u0421\u041a\u0418\u0414\u041a\u041e\u0419")) {
        const value = formatMoney(calc.productsPayTotal);
        if (valueNode.textContent !== value) valueNode.textContent = value;
      } else if (text.includes("\u0418\u0422\u041e\u0413\u041e\u0412\u0410\u042f \u0421\u0423\u041c\u041c\u0410")) {
        const value = formatMoney(calc.payTotal);
        if (valueNode.textContent !== value) valueNode.textContent = value;
      }
    });
  }

  function scheduleVisibleTildaTotalsSync(calc) {
    const stableCalc = calc || STATE.lastCalc;
    if (!stableCalc) return;
    clearTimeout(STATE.visibleTotalsTimer);
    STATE.visibleTotalsTimer = setTimeout(() => syncVisibleTildaTotals(stableCalc), 30);
    syncVisibleTildaTotals(stableCalc);
    setTimeout(() => syncVisibleTildaTotals(STATE.lastCalc || stableCalc), 120);
    setTimeout(() => syncVisibleTildaTotals(STATE.lastCalc || stableCalc), 450);
    setTimeout(() => syncVisibleTildaTotals(STATE.lastCalc || stableCalc), 900);
  }

  function ensureVisibleTotalsObserver() {
    if (STATE.visibleTotalsObserver || typeof MutationObserver !== "function") return;
    const target = document.querySelector(".t706") || document.body;
    if (!target) return;
    STATE.visibleTotalsObserver = new MutationObserver(() => {
      if (!STATE.lastCalc) return;
      scheduleVisibleTildaTotalsSync(STATE.lastCalc);
    });
    STATE.visibleTotalsObserver.observe(target, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  }

  function syncVisibleTildaTotalsAfterRefresh() {
    if (!STATE.lastCalc) return;
    scheduleVisibleTildaTotalsSync(STATE.lastCalc);
    setTimeout(() => scheduleVisibleTildaTotalsSync(STATE.lastCalc), 220);
    setTimeout(() => scheduleVisibleTildaTotalsSync(STATE.lastCalc), 620);
  }

  function getActiveTildaDiscountAmount(subtotal) {
    const promo = window.tcart?.promocode;
    if (!promo || typeof promo !== "object") return 0;
    const discountSum = Number(promo.prodamount_discountsum || promo.discountsum || 0);
    if (Number.isFinite(discountSum) && discountSum > 0) return roundMoney(discountSum);
    const percent = Number(promo.discountpercent || 0);
    return Number.isFinite(percent) && percent > 0 ? roundMoney(subtotal * percent / 100) : 0;
  }

  function estimateTildaPayTotal(subtotal, desiredDiscount) {
    const currentAmount = Number(window.tcart?.amount);
    const currentProductsTotal = Math.max(0, roundMoney(subtotal - getActiveTildaDiscountAmount(subtotal)));
    const externalAmount = Number.isFinite(currentAmount) && currentAmount > 0
      ? Math.max(0, roundMoney(currentAmount - currentProductsTotal))
      : 0;
    return Math.max(0, roundMoney(subtotal - desiredDiscount + externalAmount));
  }

  function buildCalculation() {
    const account = STATE.account;
    const loyalty = account?.contact?.loyalty || {};
    const subtotal = roundMoney(getSubtotal());
    const discountEligibleSubtotal = getDiscountEligibleSubtotal(subtotal);
    const nonDiscountableSubtotal = Math.max(0, roundMoney(subtotal - discountEligibleSubtotal));
    const rawLoyaltyPercent = Math.max(0, Math.min(100, Number(loyalty.discountPercent || 0)));
    const activePromo = syncVisibleTildaPromoState() || STATE.promo;
    const rawPromoPercent = Math.max(0, Math.min(100, Number(activePromo?.discountPercent || 0)));
    const rawPromoAmount = roundMoney(Number(activePromo?.discountAmount || 0));
    const hasFixedPromo = rawPromoAmount > 0 && rawPromoPercent <= 0;
    const rawLoyaltyDiscountAmount = roundMoney(discountEligibleSubtotal * rawLoyaltyPercent / 100);
    const rawPromoDiscountAmount = hasFixedPromo ? Math.min(discountEligibleSubtotal, rawPromoAmount) : roundMoney(discountEligibleSubtotal * rawPromoPercent / 100);
    const loyaltyWins = STATE.loyaltyEnabled && rawLoyaltyDiscountAmount > rawPromoDiscountAmount;
    const promoWins = rawPromoDiscountAmount > 0 && !loyaltyWins;
    const loyaltyPercent = loyaltyWins ? rawLoyaltyPercent : 0;
    const promoDiscountPercent = promoWins && !hasFixedPromo ? rawPromoPercent : 0;
    const loyaltyDiscountAmount = roundMoney(discountEligibleSubtotal * loyaltyPercent / 100);
    const promoDiscountAmount = promoWins ? rawPromoDiscountAmount : 0;
    const bonusBalance = roundMoney(getBonusBalance(loyalty));
    const welcomeBonusAvailable = roundMoney(getSourceBonusAvailable(loyalty, "welcomeBonus"));
    const birthdayBonusAvailable = roundMoney(getSourceBonusAvailable(loyalty, "birthdayBonus"));
    const eligibleAfterDiscounts = Math.max(0, roundMoney(discountEligibleSubtotal - loyaltyDiscountAmount - promoDiscountAmount));
    const productsAfterDiscounts = Math.max(0, roundMoney(subtotal - loyaltyDiscountAmount - promoDiscountAmount));
    const maxBonus = Math.max(0, Math.min(bonusBalance, eligibleAfterDiscounts));
    const bonusUsed = normalizeSelectedBonus(STATE.selectedBonus, maxBonus);
    if (bonusUsed !== STATE.selectedBonus) STATE.selectedBonus = bonusUsed;
    const productsPayTotal = Math.max(0, roundMoney(productsAfterDiscounts - bonusUsed));
    const totalDiscountAmount = Math.max(0, Math.min(subtotal, roundMoney(loyaltyDiscountAmount + promoDiscountAmount + bonusUsed)));
    const tildaDiscountAmount = Math.max(0, Math.min(subtotal, roundMoney(loyaltyDiscountAmount + promoDiscountAmount)));
    const manualAdjustmentAmount = Math.max(0, roundMoney(bonusUsed));
    const payTotalBeforeBonus = estimateTildaPayTotal(subtotal, tildaDiscountAmount);
    const payTotal = Math.max(0, roundMoney(payTotalBeforeBonus - manualAdjustmentAmount));
    const baseAmount = roundMoney(getExternalCartAmount(subtotal));
    const externalAmount = Math.max(0, roundMoney(payTotal - productsPayTotal));
    const bonusBreakdown = allocateBonusUsage(welcomeBonusAvailable, birthdayBonusAvailable, bonusUsed);
    return {
      contactId: account?.contact?.id || "",
      subtotal,
      discountEligibleSubtotal,
      nonDiscountableSubtotal,
      baseAmount,
      externalAmount,
      rawLoyaltyPercent,
      rawLoyaltyDiscountAmount,
      loyaltyEnabled: STATE.loyaltyEnabled,
      loyaltyPercent,
      loyaltyPromoCode: loyaltyPercent > 0 ? getLoyaltyPromoCode(loyaltyPercent) : "",
      loyaltyDiscountAmount,
      promoCode: activePromo?.code || "",
      promoDiscountPercent,
      promoDiscountAmount,
      rawPromoDiscountAmount,
      loyaltyWins,
      promoWins,
      hasFixedPromo,
      productsAfterDiscounts,
      manualAdjustmentAmount,
      tildaDiscountAmount,
      bonusBalance,
      welcomeBonusAvailable,
      birthdayBonusAvailable,
      welcomeBonusUsed: bonusBreakdown.welcomeUsed,
      birthdayBonusUsed: bonusBreakdown.birthdayUsed,
      maxBonus,
      bonusUsed,
      payTotalBeforeBonus,
      totalDiscountAmount,
      productsPayTotal,
      payTotal,
      hasLoyalty: rawLoyaltyPercent > 0,
    };
  }

  function allocateBonusUsage(welcomeAvailable, birthdayAvailable, bonusUsed) {
    const used = roundMoney(Math.max(0, bonusUsed));
    if (!used) return { welcomeUsed: 0, birthdayUsed: 0 };
    if (used >= roundMoney(welcomeAvailable + birthdayAvailable)) {
      return { welcomeUsed: welcomeAvailable, birthdayUsed: birthdayAvailable };
    }
    if (birthdayAvailable > 0 && used <= birthdayAvailable && (used === birthdayAvailable || welcomeAvailable <= 0)) {
      return { welcomeUsed: 0, birthdayUsed: used };
    }
    const welcomeUsed = Math.min(used, welcomeAvailable);
    return {
      welcomeUsed,
      birthdayUsed: Math.min(roundMoney(used - welcomeUsed), birthdayAvailable),
    };
  }
  function applyTildaDiscount(calc) {
    const currentCode = normalizePromoCode(window.tcart?.promocode?.promocode || window.tcart?.promocode?.code);
    const desiredCode = normalizePromoCode(calc.loyaltyPromoCode);
    const signature = JSON.stringify({
      currentCode,
      desiredCode,
      loyalty: calc.loyaltyDiscountAmount,
      promo: calc.promoDiscountAmount,
    });
    if (signature === STATE.promoSignature) {
      const appliedBonus = roundMoney(window.tcart?.v2sdBonusAppliedAmount || 0);
      if (calc.manualAdjustmentAmount && appliedBonus !== calc.manualAdjustmentAmount) scheduleBonusAdjustment(calc, "manual adjustment selected");
      if (!calc.manualAdjustmentAmount && appliedBonus) clearBonusAdjustment();
      return;
    }
    STATE.promoSignature = signature;

    try {
      if (desiredCode) {
        if (currentCode !== desiredCode) {
          clearTildaPromocode();
          setPromoInputValue(desiredCode);
          applyTildaPromocode(desiredCode, calc.loyaltyPercent);
        }
      } else if (currentCode && isLoyaltyPromoCode(currentCode)) {
        clearTildaPromocode();
        setPromoInputValue("");
      }
      applyNonDiscountableProductsAdjustment(calc);
      refreshTildaCartTotals();
      syncTildaPayAmount(calc);
      setTimeout(refreshTildaCartTotals, 120);
      setTimeout(refreshTildaCartTotals, 450);
    } catch (error) {
      console.warn("V2SD loyalty cart promocode apply failed:", error);
    }
  }

  function applyNonDiscountableProductsAdjustment(calc) {
    const cart = window.tcart;
    if (!cart || !(calc?.nonDiscountableSubtotal > 0)) return;
    const discountAmount = roundMoney(calc.tildaDiscountAmount || 0);
    if (!(discountAmount > 0)) return;
    const active = cart.promocode || {};
    const code = normalizePromoCode(active.promocode || active.code || calc.promoCode || calc.loyaltyPromoCode);
    if (!cart.v2sdNonDiscountableOriginalPromo) {
      cart.v2sdNonDiscountableOriginalPromo = {
        code,
        discountPercent: Math.max(0, Number(active.discountpercent || calc.promoDiscountPercent || calc.loyaltyPercent || 0)),
        discountAmount: Math.max(0, Number(active.discountsum || 0)),
      };
    }
    cart.promocode = {
      promocode: code || "V2SD_DISCOUNT",
      discountpercent: 0,
      discountsum: discountAmount,
      message: "OK",
    };
  }

  function applyTildaPromocode(code, percent) {
    const cart = window.tcart;
    if (!cart || !code || !(percent > 0)) return;
    cart.promocode = {
      promocode: code,
      discountpercent: percent,
      discountsum: 0,
      message: "OK",
    };
    STATE.lastAppliedTildaCode = code;
  }

  function clearTildaPromocode() {
    const cart = window.tcart;
    if (!cart) return;
    delete cart.promocode;
    delete cart.discountsum;
    delete cart.discountpercent;
    delete cart.discount;
    delete cart.prodamount_discountsum;
    delete cart.prodamount_withdiscount;
    delete cart.amount_withoutdiscount;
    delete cart.v2sdLoyaltyAppliedAmount;
    delete cart.v2sdLoyaltyPayTotal;
    delete cart.v2sdNonDiscountableOriginalPromo;
    STATE.lastAppliedTildaCode = "";
  }

  function clearSyntheticTildaDiscount() {
    const code = normalizePromoCode(window.tcart?.promocode?.promocode || window.tcart?.promocode?.code);
    if (!code || isLoyaltyPromoCode(code)) clearTildaPromocode();
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
          // Different Tilda builds expose different cart helpers.
        }
      }
    }
    scheduleFreshCalculationAfterTildaRefresh("tilda totals refresh");
  }

  function scheduleFreshCalculationAfterTildaRefresh(context = "") {
    clearTimeout(STATE.refreshSyncTimer);
    const sync = () => {
      try {
        syncFreshCalculationAfterTildaRefresh(context);
      } catch (error) {
        console.warn(`V2SD loyalty cart refresh sync ${context} failed:`, error);
      }
    };
    STATE.refreshSyncTimer = setTimeout(sync, 40);
    setTimeout(sync, 180);
    setTimeout(sync, 520);
  }

  function syncFreshCalculationAfterTildaRefresh(context = "") {
    if (!STATE.account || !window.tcart || !getSubtotal()) return;
    const calc = buildCalculation();
    STATE.lastCalc = calc;
    STATE.lastSignature = JSON.stringify(calc);
    renderPanel(calc);
    updateHiddenFields(calc);
    if (calc.bonusUsed > 0) scheduleVisibleTildaTotalsSync(calc);
    const appliedBonus = roundMoney(window.tcart?.v2sdBonusAppliedAmount || 0);
    if (calc.manualAdjustmentAmount) {
      if (appliedBonus !== calc.manualAdjustmentAmount) scheduleBonusAdjustment(calc, context);
    } else if (appliedBonus) {
      clearBonusAdjustment();
    }
    window.V2SD_LOYALTY_CART_DEBUG = {
      calc,
      tcart: window.tcart || null,
    };
  }

  function syncTildaPayAmount(calc) {
    if (!calc) return;
    const finalAmount = getEffectivePayTotal(calc);
    for (const form of findCartForms()) {
      setHidden(form, "v2sd_final_amount", finalAmount);
      setHidden(form, "v2sd_total_discount_amount", calc.totalDiscountAmount);
    }
  }

  function getEffectivePayTotal(calc) {
    if (roundMoney(calc?.bonusUsed) > 0) return roundMoney(calc.payTotal);
    const currentAmount = Number(window.tcart?.amount);
    return Number.isFinite(currentAmount) && currentAmount >= 0
      ? roundMoney(currentAmount)
      : roundMoney(calc?.payTotal || 0);
  }

  function clearBonusAdjustment() {
    const cart = window.tcart;
    if (!cart) return;
    const originalPromo = cart.v2sdCombinedDiscountPromo;
    if (originalPromo && typeof originalPromo === "object") {
      const code = normalizePromoCode(originalPromo.code);
      const discountPercent = Math.max(0, Math.min(100, Number(originalPromo.discountPercent || 0)));
      const discountAmount = roundMoney(Number(originalPromo.discountAmount || 0));
      if (code && (discountPercent > 0 || discountAmount > 0)) {
        cart.promocode = {
          promocode: code,
          discountpercent: discountPercent,
          discountsum: discountAmount,
          message: "OK",
        };
      } else {
        delete cart.promocode;
      }
    }
    delete cart.v2sdCombinedDiscountPromo;
    delete cart.v2sdBonusBaseAmount;
    delete cart.v2sdBonusAppliedAmount;
    delete cart.v2sdBonusPayTotal;
    STATE.lastAppliedBonusAmount = 0;
    STATE.lastBonusSignature = "";
    if (originalPromo) refreshTildaCartTotals();
  }

  function getBonusBaseAmount(calc) {
    const cart = window.tcart;
    if (!cart) return roundMoney(calc?.payTotalBeforeBonus || 0);
    if (calc?.hasFixedPromo) return roundMoney(calc.payTotalBeforeBonus || 0);
    const currentAmount = Number(cart.amount);
    const previousBase = Number(cart.v2sdBonusBaseAmount || 0);
    const previousBonus = Number(cart.v2sdBonusAppliedAmount || 0);
    if (previousBase > 0 && previousBonus > 0 && Number.isFinite(currentAmount)) {
      const expectedDiscounted = roundMoney(previousBase - previousBonus);
      if (Math.abs(roundMoney(currentAmount) - expectedDiscounted) < 0.02) return roundMoney(previousBase);
    }
    if (Number.isFinite(currentAmount) && currentAmount >= 0) return roundMoney(currentAmount);
    return roundMoney(calc?.payTotalBeforeBonus || 0);
  }

  function applyBonusAdjustment(calc, context = "") {
    if (!calc || !window.tcart) return;
    const bonusUsed = normalizeSelectedBonus(calc.bonusUsed, calc.maxBonus);
    const manualAdjustment = roundMoney((calc.manualAdjustmentAmount || 0) - (calc.bonusUsed || 0) + bonusUsed);
    if (!manualAdjustment) {
      clearBonusAdjustment();
      syncTildaPayAmount(calc);
      STATE.lastCalc = { ...calc, bonusUsed: 0, payTotal: calc.payTotalBeforeBonus };
      scheduleVisibleTildaTotalsSync(STATE.lastCalc);
      return;
    }
    const cart = window.tcart;
    const baseAmount = getBonusBaseAmount(calc);
    const appliedAdjustment = Math.min(manualAdjustment, calc.productsAfterDiscounts || baseAmount);
    const combinedDiscount = Math.min(calc.subtotal, roundMoney(calc.tildaDiscountAmount + appliedAdjustment));
    const payTotal = Math.max(0, roundMoney(calc.payTotalBeforeBonus - appliedAdjustment));
    const originalDiscountPercent = calc.promoDiscountPercent || calc.loyaltyPercent || 0;
    const originalPromo = cart.v2sdCombinedDiscountPromo || cart.v2sdNonDiscountableOriginalPromo || {
      code: normalizePromoCode(calc.promoCode || calc.loyaltyPromoCode || "V2SD_BONUS"),
      discountPercent: originalDiscountPercent,
      discountAmount: originalDiscountPercent > 0 ? 0 : (calc.promoDiscountAmount || 0),
    };
    const signature = JSON.stringify({ combinedDiscount, appliedAdjustment, bonusUsed, payTotal, context });
    const currentCartAmount = roundMoney(Number(cart.amount) || 0);
    if (
      signature === STATE.lastBonusSignature &&
      currentCartAmount === payTotal &&
      context !== "before send" &&
      context !== "on submit" &&
      context !== "on click"
    ) return;
    STATE.lastBonusSignature = signature;
    cart.v2sdCombinedDiscountPromo = originalPromo;
    cart.promocode = {
      promocode: originalPromo.code,
      discountpercent: 0,
      discountsum: combinedDiscount,
      message: "OK",
    };
    cart.v2sdBonusBaseAmount = baseAmount;
    cart.v2sdBonusAppliedAmount = appliedAdjustment;
    cart.v2sdBonusPayTotal = payTotal;
    STATE.lastAppliedBonusAmount = appliedAdjustment;
    STATE.lastCalc = { ...calc, bonusUsed, payTotal };
    syncTildaPayAmount(STATE.lastCalc);
    refreshTildaCartTotals();
    scheduleVisibleTildaTotalsSync(STATE.lastCalc);
  }

  function scheduleBonusAdjustment(calc, context = "") {
    if (!calc?.manualAdjustmentAmount) {
      clearBonusAdjustment();
      scheduleVisibleTildaTotalsSync(calc || STATE.lastCalc);
      return;
    }
    setTimeout(() => {
      try {
        applyBonusAdjustment(buildCalculation(), context);
      } catch (error) {
        console.warn(`V2SD loyalty bonus adjustment ${context} failed:`, error);
      }
    }, 180);
    setTimeout(() => {
      try {
        applyBonusAdjustment(buildCalculation(), context);
      } catch (error) {
        console.warn(`V2SD loyalty bonus delayed adjustment ${context} failed:`, error);
      }
    }, 520);
  }

  function patchTildaPaymentPayload() {
    // Tilda now owns the payment amount. We only keep hidden loyalty fields in sync.
  }

  function installPaymentHook() {
    STATE.paymentHookInstalled = false;
    return false;
  }

  function ensurePaymentHook() {
    // Payment hook intentionally disabled: standard Tilda checkout should run untouched.
  }
  function safeForcePaymentSync(context) {
    try {
      forcePaymentSync();
    } catch (error) {
      console.warn(`V2SD loyalty payment sync ${context} failed:`, error);
    }
  }

  function forcePaymentSync() {
    if (!window.tcart) return;
    if (!STATE.account) return;
    const calc = buildCalculation();
    STATE.lastCalc = calc;
    STATE.lastSignature = JSON.stringify(calc);
    updateHiddenFields(calc);
    applyBonusAdjustment(calc, "before send");
    window.V2SD_LOYALTY_CART_DEBUG = {
      calc,
      tcart: window.tcart || null,
    };
  }

  function applyLoyalty() {
    if (!STATE.account) {
      loadAccount().then(() => scheduleApply());
      return;
    }
    if (!window.tcart || !getSubtotal()) return;
    cleanupLegacyCartState();
    ensurePromocodeLookupStarted();
    const calc = buildCalculation();
    const signature = JSON.stringify(calc);
    if (signature !== STATE.lastSignature || !document.getElementById("v2sd-loyalty-cart")) {
      STATE.lastSignature = signature;
      STATE.lastCalc = calc;
      renderPanel(calc);
    }
    ensureVisibleTotalsObserver();
    STATE.lastCalc = calc;
    updateHiddenFields(calc);
    applyTildaDiscount(calc);
    window.V2SD_LOYALTY_CART_DEBUG = {
      calc,
      tcart: window.tcart || null,
    };
  }

  let applyTimer = null;
  let promoLookupTimer = null;
  function scheduleApply() {
    clearTimeout(applyTimer);
    applyTimer = setTimeout(applyLoyalty, 80);
  }

  function scheduleApplyBurst() {
    scheduleApply();
    setTimeout(scheduleApply, 320);
    setTimeout(scheduleApply, 900);
  }

  function schedulePromoLookup() {
    clearTimeout(promoLookupTimer);
    promoLookupTimer = setTimeout(() => {
      const code = getCurrentPromoCode();
      const visiblePromo = syncVisibleTildaPromoState();
      if (!code) {
        STATE.promo = null;
        STATE.promoCode = "";
        STATE.lastPromoLookupCode = "";
        STATE.promoMessage = "";
        scheduleApply();
        return;
      }
      if (isLoyaltyPromoCode(code)) {
        STATE.promo = null;
        STATE.promoCode = code;
        STATE.promoMessage = "";
        scheduleApply();
        return;
      }
      if ((visiblePromo && code === normalizePromoCode(visiblePromo.code)) || code === normalizePromoCode(STATE.promo?.code) || STATE.promoLoading || code === STATE.lastPromoLookupCode) return;
      STATE.lastPromoLookupCode = code;
      lookupPromocode(code).then(scheduleApply);
    }, 650);
  }

  function attachObservers() {
    document.addEventListener("click", (event) => {
      if (event.target?.closest?.(".t706 .t-submit, .t706 button[type='submit'], .t706 input[type='submit']")) {
        safeForcePaymentSync("on click");
      }
      if (isCartEvent(event)) scheduleApply();
    }, true);
    document.addEventListener("pointerdown", (event) => {
      if (event.target?.closest?.(".t706 .t-submit, .t706 button[type='submit'], .t706 input[type='submit']")) {
        safeForcePaymentSync("on pointerdown");
      }
    }, true);
    document.addEventListener("submit", (event) => {
      if (event.target?.closest?.(".t706")) safeForcePaymentSync("on submit");
    }, true);
    document.addEventListener("tildaform:beforesend", (event) => {
      if (event.target?.closest?.(".t706")) safeForcePaymentSync("before send");
    }, true);
    document.addEventListener("input", (event) => {
      if (!isCartEvent(event)) return;
      if (event.target === findPromoInput()) {
        STATE.promo = null;
        STATE.promoCode = getCurrentPromoCode();
        STATE.promoMessage = "";
        STATE.lastPromoLookupCode = "";
        schedulePromoLookup();
      }
      scheduleApplyBurst();
    }, true);
    document.addEventListener("change", (event) => {
      if (isCartEvent(event)) scheduleApplyBurst();
    }, true);
    window.addEventListener("tilda:cart:updated", scheduleApplyBurst);
    document.addEventListener("keydown", (event) => {
      if (!isCartEvent(event)) return;
      if (event.key !== "Enter" || event.target !== findPromoInput()) return;
      const code = getCurrentPromoCode();
      lookupPromocode(code).then(scheduleApplyBurst);
    }, true);
    document.addEventListener("blur", (event) => {
      if (!isCartEvent(event)) return;
      if (event.target !== findPromoInput()) return;
      const code = getCurrentPromoCode();
      if (code && code !== normalizePromoCode(STATE.promo?.code)) {
        lookupPromocode(code).then(scheduleApplyBurst);
      }
    }, true);
  }

  let initialized = false;
  async function initCartAdapter() {
    if (initialized) return;
    initialized = true;
    await loadAccount();
    attachObservers();
    ensureVisibleTotalsObserver();
    ensurePaymentHook();
    scheduleApply();
    window.addEventListener("v2sd:profile-loaded", (event) => {
      STATE.account = event.detail;
      STATE.loadedFor = String(event.detail?.contact?.id || event.detail?.contact?.email || "");
      scheduleApply();
    });
  }

  ready(() => {
    if (hasCartContext()) {
      initCartAdapter().catch((error) => console.warn("V2SD loyalty cart init failed:", error));
      return;
    }
    const observer = new MutationObserver(() => {
      if (!hasCartContext()) return;
      observer.disconnect();
      initCartAdapter().catch((error) => console.warn("V2SD loyalty cart init failed:", error));
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  });
})();
