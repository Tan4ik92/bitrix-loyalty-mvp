import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../frontend/tilda-gift-packaging.js", import.meta.url), "utf8");

test("gift packaging switches between standard, small and large without duplicates", async () => {
  const inputs = [0, 1, 2].map((index) => ({
    checked: index === 0,
    matches(selector) { return selector === 'input[name="typepack"]'; },
  }));
  const bodyChildren = [];
  const documentListeners = new Map();

  function createElement(tagName) {
    const element = {
      tagName: tagName.toUpperCase(),
      children: [],
      dataset: {},
      hidden: false,
      className: "",
      id: "",
      href: "",
      textContent: "",
      appendChild(child) { this.children.push(child); return child; },
      querySelector(selector) {
        const key = selector.match(/data-v2sd-packaging="([^"]+)"/)?.[1];
        return key ? this.children.find((child) => child.dataset?.v2sdPackaging === key) || null : null;
      },
      click() {
        if (this.tagName !== "A") return;
        const match = this.href.match(/^#order:(.+)=([\d.]+)/);
        if (!match) return;
        context.window.tcart.products.push({ name: match[1], price: Number(match[2]), quantity: 1, amount: Number(match[2]) });
      },
    };
    return element;
  }

  const document = {
    readyState: "complete",
    head: { appendChild(element) { bodyChildren.push(element); } },
    body: { appendChild(element) { bodyChildren.push(element); } },
    createElement,
    addEventListener(type, listener) { documentListeners.set(type, listener); },
    getElementById(id) { return bodyChildren.find((element) => element.id === id) || null; },
    querySelector(selector) {
      if (selector === ".v2sd-packaging-links") return bodyChildren.find((element) => element.className === "v2sd-packaging-links") || null;
      if (selector === ".t706") return null;
      if (selector === 'input[name="typepack"]:checked') return inputs.find((input) => input.checked) || null;
      const key = selector.match(/data-v2sd-packaging="([^"]+)"/)?.[1];
      if (key) return bodyChildren.flatMap((element) => element.children || []).find((child) => child.dataset?.v2sdPackaging === key) || null;
      return null;
    },
    querySelectorAll(selector) {
      if (selector === 'input[name="typepack"]') return inputs;
      if (selector === ".t706__product") return [];
      return [];
    },
  };

  const window = {
    tcart: { products: [{ name: "Обычный товар", price: 1000, quantity: 1, amount: 1000 }] },
    tcart__addProduct(product) { this.tcart.products.push(product); },
    setInterval,
    clearInterval,
    setTimeout,
    clearTimeout,
  };
  const context = vm.createContext({ window, document, console, setInterval, clearInterval, setTimeout, clearTimeout });
  vm.runInContext(source, context);

  const smallLink = bodyChildren.flatMap((element) => element.children || [])
    .find((element) => element.dataset?.v2sdPackaging === "small");
  assert.match(smallLink.href, /#order:Пакет маленький крафтовый=50:::image=https:\/\//);

  inputs.forEach((input, index) => { input.checked = index === 1; });
  await window.V2SD_GIFT_PACKAGING.apply();
  assert.equal(window.tcart.products.length, 2);
  assert.equal(window.tcart.products[1].externalid, "2p8AQPJFhkOdzuQ5QDfyY3");
  assert.equal(window.tcart.products[1].price, 50);

  inputs.forEach((input, index) => { input.checked = index === 2; });
  await window.V2SD_GIFT_PACKAGING.apply();
  assert.equal(window.tcart.products.length, 2);
  assert.equal(window.tcart.products[1].externalid, "jjBIe389hY-R62VLIA4nw0");
  assert.equal(window.tcart.products[1].price, 100);

  window.tcart.products.push({ ...window.tcart.products[1] });
  await window.V2SD_GIFT_PACKAGING.apply();
  assert.equal(window.tcart.products.filter(window.V2SD_GIFT_PACKAGING.isPackagingProduct).length, 1);

  inputs.forEach((input, index) => { input.checked = index === 0; });
  await window.V2SD_GIFT_PACKAGING.apply();
  assert.equal(window.tcart.products.length, 1);
  assert.equal(window.tcart.products[0].name, "Обычный товар");
});

test("gift packaging script does not initialize twice", () => {
  const context = vm.createContext({
    window: { V2SD_GIFT_PACKAGING_LOADED: true },
    document: {},
  });
  vm.runInContext(source, context);
  assert.equal(context.window.V2SD_GIFT_PACKAGING, undefined);
});

test("pages without typepack leave the shared cart untouched", async () => {
  const products = [
    { name: "Обычный товар", price: 1000, amount: 1000, quantity: 1 },
    { name: "Пакет маленький крафтовый", externalid: "2p8AQPJFhkOdzuQ5QDfyY3", price: 50, amount: 50, quantity: 1 },
  ];
  const window = { tcart: { products }, setTimeout, clearTimeout };
  const document = {
    readyState: "complete",
    querySelectorAll: () => [],
  };
  const context = vm.createContext({ window, document, console });
  vm.runInContext(source, context);
  assert.equal(window.V2SD_GIFT_PACKAGING, undefined);
  assert.equal(window.tcart.products, products);
  assert.equal(products.length, 2);
});
