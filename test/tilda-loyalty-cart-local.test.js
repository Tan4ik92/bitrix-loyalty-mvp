import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const script = fs.readFileSync(new URL("../frontend/tilda-bitrix-loyalty-cart.js", import.meta.url), "utf8");

function createElement(tagName = "div") {
  const element = {
    tagName: tagName.toUpperCase(),
    className: "",
    id: "",
    _innerHTML: "",
    textContent: "",
    style: {},
    children: [],
    bonusButtons: [],
    loyaltyButtons: [],
    attributes: {},
    classList: {
      contains() { return false; },
    },
    appendChild(child) {
      this.children.push(child);
      child.parentElement = this;
      return child;
    },
    setAttribute(name, value) {
      this.attributes[name] = String(value);
    },
    getAttribute(name) {
      return this.attributes[name] || "";
    },
    insertAdjacentElement(_position, child) {
      this.children.push(child);
      child.parentElement = this;
      if (child.id) this.ownerDocument.elementsById.set(child.id, child);
      return child;
    },
    querySelector() {
      return null;
    },
    querySelectorAll(selector) {
      if (selector === "[data-v2sd-bonus]") return this.bonusButtons;
      if (selector === "[data-v2sd-loyalty-toggle]") return this.loyaltyButtons;
      return [];
    },
    closest(selector) {
      return selector === ".t706" ? this.ownerDocument.cartElement : null;
    },
  };
  Object.defineProperty(element, "innerHTML", {
    get() {
      return this._innerHTML;
    },
    set(value) {
      this._innerHTML = String(value || "");
      const amounts = [...this._innerHTML.matchAll(/data-v2sd-bonus="(\d+)"/g)].map((match) => match[1]);
      this.bonusButtons = amounts.map((amount) => {
        const button = createElement("button");
        button.ownerDocument = this.ownerDocument;
        button.attributes["data-v2sd-bonus"] = amount;
        button.listeners = {};
        button.addEventListener = (event, handler) => {
          button.listeners[event] = handler;
        };
        return button;
      });
      const loyaltyToggles = [...this._innerHTML.matchAll(/data-v2sd-loyalty-toggle="([^"]+)"/g)].map((match) => match[1]);
      this.loyaltyButtons = loyaltyToggles.map((value) => {
        const button = createElement("button");
        button.ownerDocument = this.ownerDocument;
        button.attributes["data-v2sd-loyalty-toggle"] = value;
        button.listeners = {};
        button.addEventListener = (event, handler) => {
          button.listeners[event] = handler;
        };
        return button;
      });
    },
  });
  return element;
}

function createInput({ name = "", placeholder = "", value = "", type = "text" } = {}) {
  const input = createElement("input");
  input.name = name;
  input.placeholder = placeholder;
  input.value = value;
  input.type = type;
  input.listeners = {};
  input.addEventListener = (event, handler) => {
    input.listeners[event] = handler;
  };
  input.matches = () => false;
  input.closest = () => null;
  return input;
}

function createForm(document) {
  const form = createElement("form");
  form.ownerDocument = document;
  const hidden = new Map();
  form.querySelector = (selector) => {
    const match = /input\[name="([^"]+)"\]/.exec(selector);
    return match ? hidden.get(match[1]) || null : null;
  };
  form.appendChild = (child) => {
    hidden.set(child.name, child);
    return child;
  };
  form.hidden = hidden;
  return form;
}

function createContext({
  loyaltyPercent,
  userPromoCode = "",
  userPromoPercent = 0,
  userPromoAmount = 0,
  bonusBalance = 300,
  welcomeBonusAvailable = null,
  birthdayBonusAvailable = null,
  prodamount = 4000,
  amount = prodamount,
  products = null,
  deliveryCalculator = null,
} = {}) {
  const elementsById = new Map();
  const promoInput = createInput({ name: "promocode", placeholder: "Промокод", value: userPromoCode });
  const emailInput = createInput({ name: "email", type: "email", value: "client@example.com" });
  const document = {
    readyState: "complete",
    elementsById,
    body: { classList: { contains: () => true } },
    head: { appendChild() {} },
    documentElement: {},
    cartElement: null,
    listeners: {},
    addEventListener(event, handler) {
      this.listeners[event] = handler;
    },
    createElement(tagName) {
      const element = createElement(tagName);
      element.ownerDocument = document;
      return element;
    },
    getElementById(id) {
      if (id === "allrecords") return { getAttribute: () => "123" };
      return elementsById.get(id) || null;
    },
    querySelector(selector) {
      if (selector === ".t706") return this.cartElement;
      if (selector === "#v2sd-loyalty-cart-style") return null;
      if (selector === "#v2sd-loyalty-cart") return elementsById.get("v2sd-loyalty-cart") || null;
      if (selector.includes('input[type="email"]') || selector.includes('input[name="email"]')) return emailInput;
      if (selector === ".t706__cartwin-prodamount") return { textContent: `${prodamount} ₽` };
      if (selector === ".t706__cartwin-totalamount-wrap") return this.insertTarget;
      if (selector === ".t-inputpromocode__wrapper") return this.promoWrapper;
      if (selector === ".t706 form, form") return this.form;
      return null;
    },
    querySelectorAll(selector) {
      if (selector === ".t706__cartwin-totalamount-info_label") {
        return [
          this.totalInfo.discount.label,
          this.totalInfo.subtotalDiscount.label,
          this.totalInfo.total.label,
        ];
      }
      if (selector === ".t706__cartwin-totalamount, .t706__cartpage-order-total-value") return [this.totalAmountNode];
      if (selector === ".t706 input, input") return [promoInput, emailInput];
      if (selector === ".t706 form") return [this.form];
      return [];
    },
    createTreeWalker() {
      const lines = userPromoCode && (userPromoPercent || userPromoAmount)
        ? [
            `Промокод ${userPromoCode} активирован.`,
            userPromoPercent ? `Ваша скидка: ${userPromoPercent}%` : `Ваша скидка: ${userPromoAmount} ₽`,
          ]
        : [];
      let index = -1;
      return {
        currentNode: null,
        nextNode() {
          index += 1;
          if (index >= lines.length) return false;
          this.currentNode = { nodeValue: lines[index], parentElement: { style: {} } };
          return true;
        },
      };
    },
  };
  document.form = createForm(document);
  const makeTotalInfoPair = (labelText) => {
    const label = createElement("span");
    const value = createElement("span");
    label.ownerDocument = document;
    value.ownerDocument = document;
    label.className = "t706__cartwin-totalamount-info_label";
    value.className = "t706__cartwin-totalamount-info_value";
    label.textContent = labelText;
    label.nextElementSibling = value;
    return { label, value };
  };
  document.totalInfo = {
    discount: makeTotalInfoPair("СКИДКА:"),
    subtotalDiscount: makeTotalInfoPair("СУММА СО СКИДКОЙ:"),
    total: makeTotalInfoPair("ИТОГОВАЯ СУММА:"),
  };
  document.totalAmountNode = createElement("span");
  document.totalAmountNode.ownerDocument = document;
  document.totalAmountNode.className = "t706__cartwin-totalamount";
  document.totalAmountNode.textContent = String(amount);
  document.insertTarget = createElement("div");
  document.insertTarget.ownerDocument = document;
  document.promoWrapper = createElement("div");
  document.promoWrapper.ownerDocument = document;
  document.cartElement = createElement("div");
  document.cartElement.ownerDocument = document;

  const context = {
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    localStorage: {
      data: new Map(),
      getItem(key) { return this.data.get(key) || ""; },
      setItem(key, value) { this.data.set(key, String(value)); },
    },
    NodeFilter: { SHOW_TEXT: 4, FILTER_ACCEPT: 1, FILTER_REJECT: 2 },
    MutationObserver: class {
      observe() {}
      disconnect() {}
    },
    URLSearchParams,
    CustomEvent: class {
      constructor(type, init) {
        this.type = type;
        this.detail = init?.detail;
      }
    },
    document,
    window: null,
    location: { search: "" },
    addEventListener() {},
    dispatchEvent() {},
  };
  context.window = context;
  context.tcart = {
    prodamount,
    amount,
    products: products || [{ price: prodamount, quantity: 1, amount: prodamount }],
  };
  if (userPromoCode && (userPromoPercent || userPromoAmount)) {
    context.tcart.promocode = {
      promocode: userPromoCode,
      discountpercent: userPromoPercent,
      discountsum: userPromoAmount,
      message: "OK",
    };
  }
  context.fetch = async () => ({
    ok: true,
    json: async () => ({
      contact: {
        id: 1,
        email: "client@example.com",
        loyalty: {
          discountPercent: loyaltyPercent,
          balance: bonusBalance,
          ...(welcomeBonusAvailable === null ? {} : {
            welcomeBonus: { available: welcomeBonusAvailable },
          }),
          ...(birthdayBonusAvailable === null ? {} : {
            birthdayBonus: { available: birthdayBonusAvailable },
          }),
        },
      },
    }),
  });
  context.tcart__updateTotalProductsinCartObj = () => {};
  context.tcart__reDrawProducts = () => {};
  context.tcart__reDrawCartIcon = () => {};
  context.tcart__saveLocalObj = () => {};
  context.tcart__reDrawTotal = () => {
    const percent = Number(context.tcart.promocode?.discountpercent || 0);
    const fixed = Number(context.tcart.promocode?.discountsum || 0);
    context.tcart.prodamount_discountsum = fixed || Math.ceil((context.tcart.prodamount * percent / 100) * 100) / 100;
    context.tcart.prodamount_withdiscount = context.tcart.prodamount - context.tcart.prodamount_discountsum;
    let allocated = 0;
    context.tcart.products.forEach((product, index) => {
      const originalAmount = Number(product.amount);
      const isLast = index === context.tcart.products.length - 1;
      const discountedAmount = isLast
        ? roundTestMoney(context.tcart.prodamount_withdiscount - allocated)
        : roundTestMoney(originalAmount * context.tcart.prodamount_withdiscount / context.tcart.prodamount);
      product.amount_withdiscount = discountedAmount;
      product.price_withdiscount = roundTestMoney(discountedAmount / Number(product.quantity || 1));
      allocated = roundTestMoney(allocated + discountedAmount);
    });
    const delivery = typeof deliveryCalculator === "function"
      ? deliveryCalculator(context.tcart.prodamount_withdiscount, context.tcart)
      : Math.max(0, amount - prodamount);
    context.tcart.amount = roundTestMoney(context.tcart.prodamount_withdiscount + delivery);
  };
  return context;
}

function roundTestMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

async function runScenario(options) {
  const context = createContext(options);
  vm.runInNewContext(script, context);
  await new Promise((resolve) => setTimeout(resolve, 120));
  return context;
}

async function clickLoyalty(context) {
  const panel = context.document.getElementById("v2sd-loyalty-cart");
  const button = panel.querySelectorAll("[data-v2sd-loyalty-toggle]")[0];
  assert.ok(button);
  button.listeners.click();
  await new Promise((resolve) => setTimeout(resolve, 700));
}

async function selectBonus(context, amount) {
  const panel = context.document.getElementById("v2sd-loyalty-cart");
  const button = panel.querySelectorAll("[data-v2sd-bonus]").find((item) => item.getAttribute("data-v2sd-bonus") === String(amount));
  assert.ok(button, `bonus button ${amount} should exist`);
  button.listeners.click();
  await new Promise((resolve) => setTimeout(resolve, 700));
}

function assertProductTotal(context, expected) {
  assert.equal(
    roundTestMoney(context.tcart.products.reduce((sum, product) => sum + Number(product.amount_withdiscount || product.amount || 0), 0)),
    expected,
  );
}

test("applies loyalty promocode when loyalty percent is greater than customer promo", async () => {
  const context = await runScenario({ loyaltyPercent: 7, userPromoCode: "VLADA", userPromoPercent: 5 });
  assert.equal(context.tcart.promocode.promocode, "VLADA");
  await clickLoyalty(context);
  assert.ok(context.V2SD_LOYALTY_CART_DEBUG?.calc);
  assert.equal(context.tcart.promocode.promocode, "LOYALTY7");
  assert.equal(context.tcart.promocode.discountpercent, 7);
  assert.equal(context.tcart.amount, 3720);
});

test("keeps customer promo when discount percent is equal", async () => {
  const context = await runScenario({ loyaltyPercent: 5, userPromoCode: "VLADA", userPromoPercent: 5 });
  await clickLoyalty(context);
  assert.equal(context.tcart.promocode.promocode, "VLADA");
  assert.equal(context.tcart.promocode.discountpercent, 5);
});

test("keeps stronger customer promo instead of loyalty promocode", async () => {
  const context = await runScenario({ loyaltyPercent: 7, userPromoCode: "VLADA", userPromoPercent: 10 });
  await clickLoyalty(context);
  assert.equal(context.tcart.promocode.promocode, "VLADA");
  assert.equal(context.tcart.promocode.discountpercent, 10);
  assert.equal(context.V2SD_LOYALTY_CART_DEBUG.calc.loyaltyPercent, 0);
  assert.equal(context.V2SD_LOYALTY_CART_DEBUG.calc.promoDiscountPercent, 10);
});

test("does not apply promocode discount to gift packaging but keeps it in payment total", async () => {
  const context = await runScenario({
    loyaltyPercent: 0,
    userPromoCode: "AUTUMN10",
    userPromoPercent: 10,
    prodamount: 4100,
    amount: 4100,
    products: [
      { price: 4000, quantity: 1, amount: 4000 },
      {
        price: 100,
        quantity: 1,
        amount: 100,
        externalid: "jjBIe389hY-R62VLIA4nw0",
        v2sdGiftPackaging: "large",
        v2sdDiscountEligible: false,
        v2sdBonusEligible: false,
      },
    ],
  });

  assert.equal(context.V2SD_LOYALTY_CART_DEBUG.calc.discountEligibleSubtotal, 4000);
  assert.equal(context.V2SD_LOYALTY_CART_DEBUG.calc.nonDiscountableSubtotal, 100);
  assert.equal(context.tcart.promocode.discountpercent, 0);
  assert.equal(context.tcart.promocode.discountsum, 400);
  assert.equal(context.tcart.amount, 3700);
  assert.equal(context.document.form.hidden.get("v2sd_final_amount").value, "3700");
});

test("recognizes packaging after Tilda drops custom product metadata", async () => {
  const context = await runScenario({
    loyaltyPercent: 0,
    userPromoCode: "AUTUMN10",
    userPromoPercent: 10,
    prodamount: 4050,
    amount: 4050,
    products: [
      { name: "Обычный товар", price: 4000, quantity: 1, amount: 4000 },
      { name: "Пакет маленький крафтовый", price: 50, quantity: 1, amount: 50 },
    ],
  });
  assert.equal(context.V2SD_LOYALTY_CART_DEBUG.calc.discountEligibleSubtotal, 4000);
  assert.equal(context.tcart.promocode.discountsum, 400);
  assert.equal(context.tcart.amount, 3650);
});

test("does not spend bonuses against gift packaging value", async () => {
  const context = await runScenario({
    loyaltyPercent: 0,
    bonusBalance: 300,
    prodamount: 500,
    amount: 500,
    products: [
      { price: 400, quantity: 1, amount: 400 },
      {
        price: 100,
        quantity: 1,
        amount: 100,
        externalid: "jjBIe389hY-R62VLIA4nw0",
        v2sdGiftPackaging: "large",
        v2sdDiscountEligible: false,
        v2sdBonusEligible: false,
      },
    ],
  });

  await selectBonus(context, 300);
  assert.equal(context.V2SD_LOYALTY_CART_DEBUG.calc.maxBonus, 300);
  assert.equal(context.tcart.amount, 200);
  assert.equal(context.document.form.hidden.get("v2sd_final_amount").value, "200");
});

test("keeps fixed certificate and applies loyalty discount on top", async () => {
  const context = await runScenario({ loyaltyPercent: 10, userPromoCode: "3204981139477133", userPromoAmount: 1000 });
  await clickLoyalty(context);
  assert.equal(context.tcart.promocode.promocode, "3204981139477133");
  assert.equal(context.tcart.promocode.discountsum, 1000);
  assert.equal(context.tcart.amount, 3000);
  assert.equal(context.tcart.v2sdBonusAppliedAmount, undefined);
  assert.equal(context.V2SD_LOYALTY_CART_DEBUG.calc.hasFixedPromo, true);
  assert.equal(context.V2SD_LOYALTY_CART_DEBUG.calc.loyaltyDiscountAmount, 0);
  assert.equal(context.V2SD_LOYALTY_CART_DEBUG.calc.promoDiscountAmount, 1000);
});

test("replaces smaller fixed certificate when loyalty discount is greater", async () => {
  const context = await runScenario({ loyaltyPercent: 10, userPromoCode: "3204981139477133", userPromoAmount: 200 });
  await clickLoyalty(context);
  const panel = context.document.getElementById("v2sd-loyalty-cart");
  const button300 = panel.querySelectorAll("[data-v2sd-bonus]").find((button) => button.getAttribute("data-v2sd-bonus") === "300");
  assert.ok(button300);
  button300.listeners.click();
  await new Promise((resolve) => setTimeout(resolve, 700));
  assert.equal(context.tcart.promocode.promocode, "LOYALTY10");
  assert.equal(context.tcart.amount, 3300);
  assert.equal(context.tcart.v2sdBonusAppliedAmount, 300);
});

test("applies loyalty promocode when customer promo is absent", async () => {
  const context = await runScenario({ loyaltyPercent: 10 });
  assert.equal(context.tcart.promocode, undefined);
  let panel = context.document.getElementById("v2sd-loyalty-cart");
  assert.equal((panel.innerHTML.match(/Скидка по программе лояльности/g) || []).length, 1);
  assert.ok(panel.innerHTML.includes("400 ₽"));
  await clickLoyalty(context);
  panel = context.document.getElementById("v2sd-loyalty-cart");
  assert.equal((panel.innerHTML.match(/Скидка по программе лояльности/g) || []).length, 1);
  assert.equal(context.tcart.promocode.promocode, "LOYALTY10");
  assert.equal(context.tcart.amount, 3600);
});

test("applies the same percentage to every product and preserves the discounted total", async () => {
  const context = await runScenario({
    loyaltyPercent: 5,
    bonusBalance: 0,
    prodamount: 5800,
    products: [
      { price: 3000, quantity: 1, amount: 3000 },
      { price: 1400, quantity: 2, amount: 2800 },
    ],
  });
  await clickLoyalty(context);

  assert.equal(context.tcart.promocode.discountpercent, 5);
  assert.equal(context.tcart.products[0].amount_withdiscount, 2850);
  assert.equal(context.tcart.products[1].amount_withdiscount, 2660);
  assert.equal(context.tcart.products[0].price_withdiscount, 2850);
  assert.equal(context.tcart.products[1].price_withdiscount, 1330);
  assert.equal(context.tcart.prodamount_withdiscount, 5510);
  assert.equal(roundTestMoney(context.tcart.products.reduce((sum, product) => sum + product.amount_withdiscount, 0)), 5510);
});

test("subtracts a selected fixed bonus after Tilda promocode recalculation", async () => {
  const context = await runScenario({ loyaltyPercent: 10 });
  await clickLoyalty(context);
  const panel = context.document.getElementById("v2sd-loyalty-cart");
  assert.equal((panel.innerHTML.match(/Скидка по программе лояльности/g) || []).length, 1);
  assert.ok(panel.innerHTML.includes("Итоговая сумма без учета доставки"));
  const button300 = panel.querySelectorAll("[data-v2sd-bonus]").find((button) => button.getAttribute("data-v2sd-bonus") === "300");
  assert.ok(button300);
  button300.listeners.click();
  await new Promise((resolve) => setTimeout(resolve, 700));
  assert.equal(context.tcart.promocode.promocode, "LOYALTY10");
  assert.equal(context.tcart.promocode.discountpercent, 0);
  assert.equal(context.tcart.promocode.discountsum, 700);
  assert.equal(context.tcart.amount, 3300);
  assert.equal(context.tcart.v2sdBonusAppliedAmount, 300);
  assert.equal(context.document.form.hidden.get("v2sd_bonus_used").value, "300");
  assert.equal(context.document.form.hidden.get("v2sd_loyalty_products_pay_total").value, "3300");
  assert.equal(context.document.totalInfo.discount.value.textContent, "700 ₽");
  assert.equal(context.document.totalInfo.subtotalDiscount.value.textContent, "3 300 ₽");
  assert.equal(context.document.totalInfo.total.value.textContent, "3 300 ₽");
  assert.equal(context.document.totalAmountNode.textContent, "3 300");

  const button0 = panel.querySelectorAll("[data-v2sd-bonus]").find((button) => button.getAttribute("data-v2sd-bonus") === "0");
  assert.ok(button0);
  button0.listeners.click();
  await new Promise((resolve) => setTimeout(resolve, 700));
  assert.equal(context.tcart.amount, 3600);
  assert.equal(context.tcart.v2sdBonusAppliedAmount, undefined);
  assert.equal(context.document.form.hidden.get("v2sd_bonus_used").value, "0");
  assert.equal(context.document.form.hidden.get("v2sd_final_amount").value, "3600");
  assert.equal(context.tcart.promocode.discountpercent, 10);
  assert.equal(context.tcart.promocode.discountsum, 0);
});

test("combines fixed certificate and bonus through native Tilda item discounting", async () => {
  const context = await runScenario({
    loyaltyPercent: 0,
    userPromoCode: "6697291699393489",
    userPromoAmount: 5000,
    bonusBalance: 300,
    prodamount: 5800,
    amount: 800,
    products: [
      { price: 3000, quantity: 1, amount: 3000 },
      { price: 1400, quantity: 2, amount: 2800 },
    ],
  });
  const panel = context.document.getElementById("v2sd-loyalty-cart");
  const button300 = panel.querySelectorAll("[data-v2sd-bonus]").find((button) => button.getAttribute("data-v2sd-bonus") === "300");
  button300.listeners.click();
  await new Promise((resolve) => setTimeout(resolve, 700));

  assert.equal(context.tcart.promocode.promocode, "6697291699393489");
  assert.equal(context.tcart.promocode.discountpercent, 0);
  assert.equal(context.tcart.promocode.discountsum, 5300);
  assert.equal(context.tcart.prodamount_withdiscount, 500);
  assert.equal(context.tcart.amount, 500);
  assert.equal(context.tcart.products[0].amount_withdiscount, 258.62);
  assert.equal(context.tcart.products[1].amount_withdiscount, 241.38);
  assert.equal(roundTestMoney(context.tcart.products.reduce((sum, product) => sum + product.amount_withdiscount, 0)), 500);
  assert.equal(context.document.form.hidden.get("v2sd_final_amount").value, "500");
});

test("combines a native percent promocode with bonus and restores the percent after cancellation", async () => {
  const context = await runScenario({
    loyaltyPercent: 0,
    userPromoCode: "AUTUMN5",
    userPromoPercent: 5,
    bonusBalance: 300,
    prodamount: 5800,
    products: [
      { price: 3000, quantity: 1, amount: 3000 },
      { price: 1400, quantity: 2, amount: 2800 },
    ],
  });
  await selectBonus(context, 300);

  assert.equal(context.tcart.promocode.promocode, "AUTUMN5");
  assert.equal(context.tcart.promocode.discountpercent, 0);
  assert.equal(context.tcart.promocode.discountsum, 590);
  assert.equal(context.tcart.prodamount_withdiscount, 5210);
  assert.equal(context.tcart.products[0].amount_withdiscount, 2694.83);
  assert.equal(context.tcart.products[1].amount_withdiscount, 2515.17);
  assertProductTotal(context, 5210);

  await selectBonus(context, 0);
  assert.equal(context.tcart.promocode.promocode, "AUTUMN5");
  assert.equal(context.tcart.promocode.discountpercent, 5);
  assert.equal(context.tcart.promocode.discountsum, 0);
  assert.equal(context.tcart.prodamount_withdiscount, 5510);
  assertProductTotal(context, 5510);
});

test("uses the stronger loyalty discount with bonus instead of a weaker Tilda promocode", async () => {
  const context = await runScenario({
    loyaltyPercent: 10,
    userPromoCode: "AUTUMN5",
    userPromoPercent: 5,
    bonusBalance: 300,
    prodamount: 5800,
    products: [
      { price: 3000, quantity: 1, amount: 3000 },
      { price: 1400, quantity: 2, amount: 2800 },
    ],
  });
  await clickLoyalty(context);
  await selectBonus(context, 300);

  assert.equal(context.tcart.promocode.promocode, "LOYALTY10");
  assert.equal(context.tcart.promocode.discountsum, 880);
  assert.equal(context.tcart.prodamount_withdiscount, 4920);
  assertProductTotal(context, 4920);
  assert.equal(context.document.form.hidden.get("v2sd_loyalty_discount_amount").value, "580");
  assert.equal(context.document.form.hidden.get("v2sd_promo_discount_amount").value, "0");
  assert.equal(context.document.form.hidden.get("v2sd_bonus_used").value, "300");
});

test("uses a stronger Tilda promocode with bonus instead of a weaker loyalty discount", async () => {
  const context = await runScenario({
    loyaltyPercent: 5,
    userPromoCode: "AUTUMN10",
    userPromoPercent: 10,
    bonusBalance: 300,
    prodamount: 5800,
    products: [
      { price: 3000, quantity: 1, amount: 3000 },
      { price: 1400, quantity: 2, amount: 2800 },
    ],
  });
  await clickLoyalty(context);
  await selectBonus(context, 300);

  assert.equal(context.tcart.promocode.promocode, "AUTUMN10");
  assert.equal(context.tcart.promocode.discountsum, 880);
  assert.equal(context.tcart.prodamount_withdiscount, 4920);
  assertProductTotal(context, 4920);
  assert.equal(context.document.form.hidden.get("v2sd_loyalty_discount_amount").value, "0");
  assert.equal(context.document.form.hidden.get("v2sd_promo_discount_amount").value, "580");
});

test("keeps an equal customer promocode as the winner when bonus is added", async () => {
  const context = await runScenario({
    loyaltyPercent: 5,
    userPromoCode: "AUTUMN5",
    userPromoPercent: 5,
    bonusBalance: 300,
    prodamount: 5800,
  });
  await clickLoyalty(context);
  await selectBonus(context, 300);

  assert.equal(context.tcart.promocode.promocode, "AUTUMN5");
  assert.equal(context.tcart.promocode.discountsum, 590);
  assert.equal(context.tcart.prodamount_withdiscount, 5210);
  assert.equal(context.document.form.hidden.get("v2sd_loyalty_discount_amount").value, "0");
  assert.equal(context.document.form.hidden.get("v2sd_promo_discount_amount").value, "290");
});

test("subtracts a fixed bonus from final Tilda amount including delivery", async () => {
  const context = await runScenario({
    loyaltyPercent: 0,
    bonusBalance: 800,
    prodamount: 3750,
    amount: 4873.13,
  });
  const panel = context.document.getElementById("v2sd-loyalty-cart");
  const buttons = panel.querySelectorAll("[data-v2sd-bonus]");
  assert.deepEqual(buttons.map((button) => button.getAttribute("data-v2sd-bonus")), ["0", "300", "500", "800"]);
  const button300 = buttons.find((button) => button.getAttribute("data-v2sd-bonus") === "300");
  assert.ok(button300);
  button300.listeners.click();
  await new Promise((resolve) => setTimeout(resolve, 700));
  assert.equal(context.tcart.v2sdBonusBaseAmount, 4873.13);
  assert.equal(context.tcart.amount, 4573.13);
  assert.equal(context.tcart.v2sdBonusAppliedAmount, 300);
  assert.equal(context.document.form.hidden.get("v2sd_bonus_used").value, "300");
  assert.equal(context.document.form.hidden.get("v2sd_final_amount").value, "4573.13");
  assert.equal(context.document.form.hidden.get("v2sd_loyalty_products_pay_total").value, "3450");
  assert.equal(context.document.totalInfo.discount.value.textContent, "300 ₽");
  assert.equal(context.document.totalInfo.subtotalDiscount.value.textContent, "3 450 ₽");
  assert.equal(context.document.totalInfo.total.value.textContent, "4 573,13 ₽");
  assert.equal(context.document.totalAmountNode.textContent, "4 573,13");

  const button0 = buttons.find((button) => button.getAttribute("data-v2sd-bonus") === "0");
  assert.ok(button0);
  button0.listeners.click();
  await new Promise((resolve) => setTimeout(resolve, 700));
  assert.equal(context.tcart.amount, 4873.13);
  assert.equal(context.document.form.hidden.get("v2sd_bonus_used").value, "0");
  assert.equal(context.document.form.hidden.get("v2sd_final_amount").value, "4873.13");
});

test("supports fixed bonus choices 500 and 800 when balance is enough", async () => {
  const context = await runScenario({ loyaltyPercent: 0, bonusBalance: 800 });
  const panel = context.document.getElementById("v2sd-loyalty-cart");
  const button500 = panel.querySelectorAll("[data-v2sd-bonus]").find((button) => button.getAttribute("data-v2sd-bonus") === "500");
  const button800 = panel.querySelectorAll("[data-v2sd-bonus]").find((button) => button.getAttribute("data-v2sd-bonus") === "800");
  assert.ok(button500);
  assert.ok(button800);

  button500.listeners.click();
  await new Promise((resolve) => setTimeout(resolve, 700));
  assert.equal(context.tcart.amount, 3500);
  assert.equal(context.document.form.hidden.get("v2sd_bonus_used").value, "500");

  button800.listeners.click();
  await new Promise((resolve) => setTimeout(resolve, 700));
  assert.equal(context.tcart.amount, 3200);
  assert.equal(context.document.form.hidden.get("v2sd_bonus_used").value, "800");
});

test("does not offer welcome bonus after it becomes unavailable", async () => {
  const context = await runScenario({ loyaltyPercent: 0, bonusBalance: 300, welcomeBonusAvailable: 0 });
  const panel = context.document.getElementById("v2sd-loyalty-cart");
  assert.equal(panel.querySelectorAll("[data-v2sd-bonus]").length, 0);
  assert.equal(context.V2SD_LOYALTY_CART_DEBUG.calc.bonusBalance, 0);
  assert.equal(context.document.form.hidden.get("v2sd_bonus_used").value, "0");
  assert.equal(context.document.form.hidden.get("v2sd_welcome_bonus_available").value, "0");
});

test("sums welcome and birthday bonuses for fixed choices", async () => {
  const context = await runScenario({
    loyaltyPercent: 0,
    bonusBalance: 0,
    welcomeBonusAvailable: 300,
    birthdayBonusAvailable: 500,
  });
  const panel = context.document.getElementById("v2sd-loyalty-cart");
  assert.deepEqual(
    panel.querySelectorAll("[data-v2sd-bonus]").map((button) => button.getAttribute("data-v2sd-bonus")),
    ["0", "300", "500", "800"],
  );
  assert.equal(context.document.form.hidden.get("v2sd_bonus_balance").value, "800");
  assert.equal(context.document.form.hidden.get("v2sd_welcome_bonus_available").value, "300");
  assert.equal(context.document.form.hidden.get("v2sd_birthday_bonus_available").value, "500");
});

test("refreshes dynamic delivery total after native promocode recalculation", async () => {
  const context = await runScenario({
    loyaltyPercent: 10,
    userPromoCode: "SONYA",
    userPromoPercent: 5,
    prodamount: 15500,
    amount: 15950,
    deliveryCalculator: (productsTotal) => productsTotal * 0.03132427843803056,
  });
  await new Promise((resolve) => setTimeout(resolve, 700));
  assert.equal(context.V2SD_LOYALTY_CART_DEBUG.calc.promoDiscountAmount, 775);
  assert.equal(context.V2SD_LOYALTY_CART_DEBUG.calc.payTotal, 15186.25);
  assert.equal(context.document.form.hidden.get("v2sd_final_amount").value, "15186.25");
  assert.equal(context.tcart.amount, 15186.25);
});

test("refreshes dynamic delivery total after loyalty promocode recalculation", async () => {
  const context = await runScenario({
    loyaltyPercent: 10,
    prodamount: 15500,
    amount: 15961.25,
    deliveryCalculator: (productsTotal) => productsTotal * 0.032231541218638,
  });
  await clickLoyalty(context);
  await new Promise((resolve) => setTimeout(resolve, 700));
  assert.equal(context.V2SD_LOYALTY_CART_DEBUG.calc.loyaltyDiscountAmount, 1550);
  assert.equal(context.V2SD_LOYALTY_CART_DEBUG.calc.payTotal, 14399.63);
  assert.equal(context.document.form.hidden.get("v2sd_final_amount").value, "14399.63");
  assert.equal(context.tcart.amount, 14399.63);
});
