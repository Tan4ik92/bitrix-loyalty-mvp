(function () {
  "use strict";

  if (window.V2SD_GIFT_PACKAGING_LOADED) return;
  window.V2SD_GIFT_PACKAGING_LOADED = true;

  const CONFIG = {
    fieldName: "typepack",
    standardIndex: 0,
    products: [
      {
        inputIndex: 1,
        key: "small",
        name: "Пакет маленький крафтовый",
        displayName: "Маленький подарочный пакет (35×25×15)",
        price: 50,
        externalId: "2p8AQPJFhkOdzuQ5QDfyY3",
        image: "https://static.tildacdn.com/tild6661-3566-4761-a334-383330333131/d142af77-cb5f-4d84-b.jpg",
      },
      {
        inputIndex: 2,
        key: "large",
        name: "Пакет большой крафтовый",
        displayName: "Большой подарочный пакет (40×30×15)",
        price: 100,
        externalId: "jjBIe389hY-R62VLIA4nw0",
        image: "https://static.tildacdn.com/tild3438-3339-4636-a532-396562373731/bb786be1-048a-4d0c-8.jpg",
      },
    ],
  };

  const PRODUCT_EXTERNAL_IDS = new Set(CONFIG.products.map((product) => product.externalId));
  const PRODUCT_NAMES = new Set(CONFIG.products.flatMap((product) => [product.name, product.displayName]));
  let syncing = false;
  let observer = null;
  let fieldObserver = null;
  let initialized = false;
  let scheduledTimer = 0;

  function clean(value) {
    return String(value == null ? "" : value).replace(/\s+/g, " ").trim();
  }

  function cartProducts() {
    return Array.isArray(window.tcart && window.tcart.products) ? window.tcart.products : [];
  }

  function productExternalId(product) {
    const value = clean(product && (product.externalid || product.externalId || product.sku || product.SKU));
    return value.split("#")[0];
  }

  function productName(product) {
    return clean(product && (product.name || product.title || product.product || product.product_name));
  }

  function isPackagingProduct(product) {
    return PRODUCT_EXTERNAL_IDS.has(productExternalId(product)) || PRODUCT_NAMES.has(productName(product));
  }

  function packagingConfigForProduct(product) {
    const externalId = productExternalId(product);
    const name = productName(product);
    return CONFIG.products.find((candidate) => (
      candidate.externalId === externalId || candidate.name === name || candidate.displayName === name
    )) || null;
  }

  function hasOrdinaryProducts() {
    return cartProducts().some((product) => !isPackagingProduct(product) && product && product.deleted !== "yes");
  }

  function selectedInput() {
    return document.querySelector(`input[name="${CONFIG.fieldName}"]:checked`);
  }

  function allInputs() {
    return Array.from(document.querySelectorAll(`input[name="${CONFIG.fieldName}"]`));
  }

  function selectedConfig() {
    const inputs = allInputs();
    const selected = selectedInput();
    const index = selected ? inputs.indexOf(selected) : CONFIG.standardIndex;
    return CONFIG.products.find((product) => product.inputIndex === index) || null;
  }

  function selectInput(index) {
    const input = allInputs()[index];
    if (input) input.checked = true;
  }

  function refreshCart() {
    const functions = [
      "tcart__updateTotalProductsinCartObj",
      "tcart__reDrawProducts",
      "tcart__reDrawTotal",
      "tcart__reDrawCartIcon",
      "tcart__saveLocalObj",
    ];
    functions.forEach((name) => {
      if (typeof window[name] !== "function") return;
      try {
        window[name](window.tcart);
      } catch (_error) {
        try { window[name](); } catch (_ignored) { /* Different Tilda builds use different signatures. */ }
      }
    });
  }

  function removePackagingProducts({ keepExternalId = "" } = {}) {
    const products = cartProducts();
    let changed = false;
    let keptDesiredProduct = false;
    for (let index = products.length - 1; index >= 0; index -= 1) {
      const product = products[index];
      if (!isPackagingProduct(product)) continue;
      if (keepExternalId && productExternalId(product) === keepExternalId && !keptDesiredProduct) {
        keptDesiredProduct = true;
        continue;
      }
      products.splice(index, 1);
      changed = true;
    }
    if (changed) refreshCart();
    return changed;
  }

  function buildOrderHref(product) {
    const imagePart = product.image ? `:::image=${product.image}` : "";
    return `#order:${product.name}=${product.price}${imagePart}`;
  }

  function ensureOrderLinks() {
    let container = document.querySelector(".v2sd-packaging-links");
    if (!container) {
      container = document.createElement("div");
      container.className = "v2sd-packaging-links";
      container.hidden = true;
      document.body.appendChild(container);
    }
    CONFIG.products.forEach((product) => {
      let link = container.querySelector(`[data-v2sd-packaging="${product.key}"]`);
      if (!link) {
        link = document.createElement("a");
        link.dataset.v2sdPackaging = product.key;
        link.textContent = product.name;
        container.appendChild(link);
      }
      link.href = buildOrderHref(product);
    });
    return container;
  }

  function patchAddedProduct(product) {
    const candidates = cartProducts().filter((item) => {
      const name = productName(item);
      return name === product.name || name === product.displayName || productExternalId(item) === product.externalId;
    });
    const item = candidates[candidates.length - 1];
    if (!item) return false;

    item.externalid = product.externalId;
    item.externalId = product.externalId;
    item.sku = product.externalId;
    item.name = product.name;
    item.price = product.price;
    item.quantity = 1;
    item.amount = product.price;
    item.v2sdGiftPackaging = product.key;
    item.v2sdDiscountEligible = false;
    item.v2sdBonusEligible = false;
    return true;
  }

  function addPackagingProduct(product) {
    // Use Tilda's own cart API when available. Dynamically created #order links
    // can sit outside the record where Tilda installed its click listener.
    if (typeof window.tcart__addProduct === "function") {
      try {
        window.tcart__addProduct({
          name: product.name,
          price: product.price,
          quantity: 1,
          amount: product.price,
          externalid: product.externalId,
          externalId: product.externalId,
          sku: product.externalId,
          uid: `v2sd-gift-packaging-${product.key}`,
          img: product.image,
          image: product.image,
          v2sdGiftPackaging: product.key,
          v2sdDiscountEligible: false,
          v2sdBonusEligible: false,
        });
        if (patchAddedProduct(product)) {
          removePackagingProducts({ keepExternalId: product.externalId });
          refreshCart();
          return Promise.resolve(true);
        }
      } catch (error) {
        console.warn("V2SD: штатное добавление упаковки Tilda не сработало", error);
      }
    }

    ensureOrderLinks();
    const link = document.querySelector(`[data-v2sd-packaging="${product.key}"]`);
    if (!link) return Promise.resolve(false);
    link.click();

    return new Promise((resolve) => {
      let attempts = 0;
      const timer = window.setInterval(() => {
        attempts += 1;
        if (patchAddedProduct(product)) {
          window.clearInterval(timer);
          removePackagingProducts({ keepExternalId: product.externalId });
          refreshCart();
          resolve(true);
        } else if (attempts >= 30) {
          window.clearInterval(timer);
          console.warn("V2SD: не удалось добавить упаковку в корзину", product.name);
          resolve(false);
        }
      }, 100);
    });
  }

  async function applySelectedPackaging() {
    // The field is currently installed only in the account checkout. Never
    // change a shared Tilda cart from a page that has no packaging selector.
    if (!allInputs().length) return;
    if (syncing) return;
    syncing = true;
    try {
      const desired = selectedConfig();
      if (!hasOrdinaryProducts()) {
        removePackagingProducts();
        selectInput(CONFIG.standardIndex);
        return;
      }

      if (!desired) {
        removePackagingProducts();
        return;
      }

      const matching = cartProducts().filter((product) => productExternalId(product) === desired.externalId);
      removePackagingProducts({ keepExternalId: desired.externalId });
      if (matching.length === 0) await addPackagingProduct(desired);
      else {
        patchAddedProduct(desired);
        refreshCart();
      }
    } finally {
      syncing = false;
      markPackagingRows();
    }
  }

  function restoreSelectionFromCart() {
    const packageItem = cartProducts().find(isPackagingProduct);
    const matched = packageItem ? packagingConfigForProduct(packageItem) : null;
    selectInput(matched ? matched.inputIndex : CONFIG.standardIndex);
  }

  function markPackagingRows() {
    document.querySelectorAll(".t706__product").forEach((row) => {
      const title = clean(row.querySelector(".t706__product-title")?.textContent);
      row.classList.toggle("v2sd-packaging-product", PRODUCT_NAMES.has(title));
    });
  }

  function scheduleSync() {
    window.clearTimeout(scheduledTimer);
    scheduledTimer = window.setTimeout(() => {
      if (syncing) return;
      if (!hasOrdinaryProducts() && cartProducts().some(isPackagingProduct)) {
        selectInput(CONFIG.standardIndex);
        applySelectedPackaging();
      }
      markPackagingRows();
    }, 120);
  }

  function installStyles() {
    if (document.getElementById("v2sd-packaging-style")) return;
    const style = document.createElement("style");
    style.id = "v2sd-packaging-style";
    style.textContent = `
      .v2sd-packaging-product .t706__product-plusminus,
      .v2sd-packaging-product .t706__product-del {
        opacity: 0 !important;
        pointer-events: none !important;
      }
    `;
    document.head.appendChild(style);
  }

  function init() {
    if (initialized) return;
    if (!allInputs().length) {
      // Tilda can render the cart popup after the T123 block has already run.
      // Wait for typepack without touching carts on pages where this field is absent.
      if (!fieldObserver && document.body && typeof MutationObserver === "function") {
        fieldObserver = new MutationObserver(() => {
          if (!allInputs().length) return;
          fieldObserver.disconnect();
          fieldObserver = null;
          init();
        });
        fieldObserver.observe(document.body, { childList: true, subtree: true });
      }
      return;
    }
    initialized = true;
    installStyles();
    ensureOrderLinks();
    restoreSelectionFromCart();
    markPackagingRows();

    document.addEventListener("change", (event) => {
      if (event.target && event.target.matches(`input[name="${CONFIG.fieldName}"]`)) {
        applySelectedPackaging();
      }
    });

    document.addEventListener("click", (event) => {
      if (event.target?.closest?.(".v2sd-packaging-product .t706__product-del, .v2sd-packaging-product .t706__product-minus")) {
        event.preventDefault();
        event.stopPropagation();
      }
    }, true);

    const target = document.querySelector(".t706") || document.body;
    if (target && typeof MutationObserver === "function") {
      observer = new MutationObserver(scheduleSync);
      observer.observe(target, { childList: true, subtree: true });
    }

    window.V2SD_GIFT_PACKAGING = {
      config: CONFIG,
      apply: applySelectedPackaging,
      restore: restoreSelectionFromCart,
      isPackagingProduct,
    };
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
