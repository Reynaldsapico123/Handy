const http = require("http");
const fs = require("fs");
const path = require("path");
const assert = require("assert");
const { chromium } = require("playwright");
const { runServiceWorkerUpdateTest } = require("./service-worker-update");

const root = path.resolve(__dirname, "..");
const mimeTypes = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "text/javascript",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml"
};

const server = http.createServer((request, response) => {
  const requestUrl = new URL(request.url, "http://127.0.0.1");
  const requestPath = requestUrl.pathname;
  const pagePath = requestPath === "/" ? "/index.html" : requestPath;
  const requestedPath = path.extname(pagePath) ? pagePath : `${pagePath}.html`;
  const filePath = path.resolve(root, `.${requestedPath}`);
  if (!filePath.startsWith(root)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }
  fs.readFile(filePath, (error, data) => {
    if (error) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }
    response.writeHead(200, { "Content-Type": mimeTypes[path.extname(filePath)] || "application/octet-stream" });
    response.end(data);
  });
});

async function run() {
  await new Promise((resolve) => server.listen(4174, "127.0.0.1", resolve));
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    serviceWorkers: "block"
  });
  const page = await context.newPage();
  const browserErrors = [];
  const requestedToolScripts = new Set();
  page.on("request", (request) => {
    const pathname = new URL(request.url()).pathname;
    if (
      /\/(?:calculator|unit-converter|timer|guides|world-clock|currency|qr-code)\.js$/.test(pathname)
      || pathname.endsWith("/qrcode-generator/dist/qrcode.js")
      || pathname.endsWith("/jsqr/dist/jsQR.js")
    ) {
      requestedToolScripts.add(pathname);
    }
  });
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => browserErrors.push(`pageerror: ${error.message}`));
  await page.addInitScript(() => {
    const listeners = {};
    const registration = {
      waiting: {
        message: null,
        postMessage(message) { this.message = message; }
      },
      installing: null,
      addEventListener(type, listener) { listeners[type] = listener; },
      dispatch(type) { listeners[type]?.(); }
    };
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: {
        controller: {},
        getRegistration: async () => registration,
        register: async () => registration,
        addEventListener() {}
      }
    });
    Object.defineProperty(navigator, "share", { configurable: true, value: undefined });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text) => {
          window.copiedToolLink = text;
          window.copiedCurrencyConversion = text;
        }
      }
    });
    window.testUpdateRegistration = registration;
  });

  try {
    await page.goto("http://127.0.0.1:4174/", { waitUntil: "networkidle" });
    assert.strictEqual(await page.title(), "Handy — Everyday tools for everyone");
    assert.strictEqual(await page.locator(".tool-card").count(), 6);
    assert.strictEqual(await page.locator(".skip-link").getAttribute("href"), "#mainContent");
    assert.strictEqual(requestedToolScripts.size, 0, "Tool scripts should stay unloaded on the home page.");
    await page.waitForSelector("#welcomeModal:not([hidden])");
    assert(await page.locator("[data-welcome-step='0']").isVisible());
    await page.click("#welcomeSkip");
    assert(await page.locator("#welcomeModal").evaluate((modal) => modal.hidden));
    assert.strictEqual(await page.evaluate(() => localStorage.getItem("handy-welcome-dismissed")), "true");
    assert.strictEqual(await page.evaluate(() => localStorage.getItem("handy-welcome-skipped")), "true");
    await page.reload({ waitUntil: "networkidle" });
    assert(await page.locator("#welcomeModal").evaluate((modal) => modal.hidden));
    await page.evaluate(() => {
      localStorage.removeItem("handy-welcome-dismissed");
      localStorage.removeItem("handy-welcome-skipped");
    });
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForSelector("#welcomeModal:not([hidden])");
    await page.click("#welcomeNext");
    assert(await page.locator("[data-welcome-step='1']").isVisible());
    await page.click("#welcomeBack");
    assert(await page.locator("[data-welcome-step='0']").isVisible());
    await page.click("#welcomeNext");
    await page.click("#welcomeNext");
    assert(await page.locator("[data-welcome-step='2']").isVisible());
    await page.click("#welcomeNext");
    assert(await page.locator("#welcomeModal").evaluate((modal) => modal.hidden));
    assert.strictEqual(await page.evaluate(() => localStorage.getItem("handy-welcome-dismissed")), "true");
    assert.strictEqual(await page.evaluate(() => localStorage.getItem("handy-welcome-skipped")), null);
    await page.keyboard.press("Control+Home");
    await page.evaluate(() => document.querySelector(".skip-link").focus());
    await page.keyboard.press("Enter");
    assert.strictEqual(await page.evaluate(() => document.activeElement.id), "mainContent");
    await page.reload({ waitUntil: "networkidle" });
    assert(await page.locator("#welcomeModal").evaluate((modal) => modal.hidden));
    await page.waitForSelector("#updateNotice:not([hidden])");
    await page.click("#updateLater");
    assert(await page.locator("#updateNotice").evaluate((notice) => notice.hidden));
    assert.strictEqual(await page.evaluate(() => sessionStorage.getItem("handy-update-dismissed")), "true");
    await page.evaluate(() => {
      const registration = window.testUpdateRegistration;
      registration.installing = {
        state: "installed",
        addEventListener(type, listener) {
          if (type === "statechange") listener();
        }
      };
      registration.dispatch("updatefound");
    });
    await page.evaluate(() => {
      sessionStorage.removeItem("handy-update-dismissed");
      document.querySelector("#updateNotice").hidden = false;
    });
    await page.click("#updateNow");
    assert.strictEqual(await page.evaluate(() => window.testUpdateRegistration.waiting.message), "SKIP_WAITING");
    assert(await page.locator("#updateNow").isDisabled());
    assert.strictEqual(await page.locator("#connectionStatusText").textContent(), "Online");
    const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.webmanifest"), "utf8"));
    assert.deepStrictEqual(
      manifest.shortcuts.map((shortcut) => shortcut.url),
      ["/?tool=qr&mode=scan", "/?tool=timer"]
    );
    for (const [size, filename] of [[192, "handy-192.png"], [512, "handy-512.png"]]) {
      const icon = manifest.icons.find((item) => item.src === `/icons/${filename}`);
      assert(icon, `Manifest should include ${filename}`);
      assert.strictEqual(icon.sizes, `${size}x${size}`);
      const image = fs.readFileSync(path.join(root, "icons", filename));
      assert.strictEqual(image.readUInt32BE(16), size);
      assert.strictEqual(image.readUInt32BE(20), size);
    }
    assert(await page.locator("#installApp").isVisible());
    await page.click("#installApp");
    assert.match(await page.locator("#installAppInstructions").textContent(), /browser menu/);
    await page.evaluate(() => {
      const event = new Event("beforeinstallprompt");
      event.prompt = async () => { window.installPromptCalled = true; };
      event.userChoice = Promise.resolve({ outcome: "accepted" });
      window.dispatchEvent(event);
    });
    await page.click("#installApp");
    assert.strictEqual(await page.evaluate(() => window.installPromptCalled), true);
    await page.evaluate(() => window.dispatchEvent(new Event("appinstalled")));
    assert(await page.locator("#installAppContainer").evaluate((container) => container.hidden));

    await context.setOffline(true);
    await page.waitForFunction(() => document.querySelector("#connectionStatusText").textContent === "Offline");
    await context.setOffline(false);
    await page.waitForFunction(() => document.querySelector("#connectionStatusText").textContent === "Online");

    await page.click("#themeToggle");

    await page.click("[data-tool-category='calculate']");
    assert.strictEqual(await page.locator("#toolGrid .tool-card:not(.hidden)").count(), 2);
    await page.click("[data-tool-category='all']");
    await page.fill("#searchInput", "timer");
    await page.keyboard.press("Enter");
    assert.strictEqual(await page.locator("#toolGrid .tool-card:not(.hidden)").count(), 1);
    await page.fill("#searchInput", "");
    await page.locator("#searchInput").dispatchEvent("input");
    assert(await page.locator("[data-recent-search='timer']").isVisible());
    assert(await page.locator("body").evaluate((body) => body.classList.contains("dark")));
    await page.click("#themeToggle");

    await page.fill("#searchInput", "timer");
    assert.strictEqual(await page.locator("#searchInput").getAttribute("role"), "combobox");
    assert.strictEqual(await page.locator("#searchInput").getAttribute("aria-controls"), "searchSuggestionList");
    assert.strictEqual(await page.locator("#searchInput").getAttribute("aria-expanded"), "true");
    assert.strictEqual(await page.locator("#searchSuggestionList [role='option']").count(), 1);
    assert.match(await page.locator("#searchSuggestionStatus").textContent(), /1 tool suggestion available/);
    await page.keyboard.press("ArrowDown");
    const selectedSearchOption = page.locator("#searchSuggestionList [role='option']").first();
    assert.strictEqual(await selectedSearchOption.getAttribute("aria-selected"), "true");
    assert.strictEqual(await page.locator("#searchInput").getAttribute("aria-activedescendant"), await selectedSearchOption.getAttribute("id"));
    await page.keyboard.press("Enter");
    await page.waitForTimeout(150);
    assert.strictEqual(requestedToolScripts.size, 0, "Filtering tools should not load tool modules.");
    assert.strictEqual(await page.locator(".tool-card:not(.hidden)").count(), 1);
    assert.strictEqual(await page.locator("#searchInput").getAttribute("aria-expanded"), "false");

    await page.fill("#searchInput", "");
    await page.locator("#searchInput").dispatchEvent("input");
    await page.getByRole("button", { name: "Open Calculator" }).click();
    await page.waitForSelector("#calculatorModal:not([hidden])");
    await page.goBack({ waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => document.querySelector("#calculatorModal").hidden);

    await page.fill("#searchInput", "t");
    const searchOptions = page.locator("#searchSuggestionList [role='option']");
    assert((await searchOptions.count()) > 1);
    const lastSearchOptionId = await searchOptions.last().getAttribute("id");
    await page.keyboard.press("ArrowUp");
    assert.strictEqual(await page.locator("#searchInput").getAttribute("aria-activedescendant"), lastSearchOptionId);
    await page.keyboard.press("ArrowDown");
    assert.strictEqual(await page.locator("#searchInput").getAttribute("aria-activedescendant"), await searchOptions.first().getAttribute("id"));

    await page.fill("#searchInput", "no-such-tool");
    assert.strictEqual(await page.locator("#searchSuggestionList [role='option']").count(), 0);
    assert.match(await page.locator("#searchNoResults").textContent(), /No tools found/);
    assert.match(await page.locator("#searchSuggestionStatus").textContent(), /No tools found/);
    await page.click(".view-all");
    assert.strictEqual(await page.locator("#searchInput").getAttribute("aria-expanded"), "false");

    await page.locator("#toolCustomizer summary").click();
    assert(await page.locator("#toolCustomizerList").isVisible());
    const qrRow = page.locator("#toolCustomizerList .tool-customizer-row", { hasText: "QR Code Maker" });
    await qrRow.locator(".tool-visibility").click();
    assert(await page.locator("#toolGrid .tool-card", { hasText: "QR Code Maker" }).evaluate((card) => card.hidden));
    await qrRow.locator(".tool-visibility").click();
    assert(await page.locator("#toolGrid .tool-card", { hasText: "QR Code Maker" }).evaluate((card) => !card.hidden));
    await qrRow.locator(".tool-order-button[aria-label='Move QR Code Maker earlier']").click();
    assert.strictEqual(await page.locator("#toolGrid .tool-card").nth(4).locator("h3").textContent(), "QR Code Maker");
    await page.click("[data-personalization-preset='travel']");
    assert.strictEqual(await page.locator("#toolGrid .tool-card:not([hidden])").count(), 4);
    assert.match(await page.locator("#personalizationPresetStatus").textContent(), /Travel preset is active/);
    await page.click("#resetToolLayout");
    assert.strictEqual(await page.locator("#toolGrid .tool-card").first().locator("h3").textContent(), "Calculator");
    await page.locator("#toast .toast-action").filter({ hasText: "Undo" }).click();
    assert.match(await page.locator("#personalizationPresetStatus").textContent(), /Travel preset is active/);
    assert.strictEqual(await page.locator("#toolGrid .tool-card:not([hidden])").count(), 4);

    await page.evaluate(() => {
      localStorage.setItem("handy-tool-usage", JSON.stringify({ Calculator: 3 }));
      localStorage.setItem("handy-recent-searches", JSON.stringify(["timer"]));
      localStorage.setItem("handy-recent-tools", JSON.stringify(["Calculator"]));
    });
    page.once("dialog", (dialog) => dialog.accept());
    await page.click("#resetPersonalization");
    await page.waitForFunction(() =>
      localStorage.getItem("handy-tool-usage") === null
      && localStorage.getItem("handy-recent-searches") === null
      && localStorage.getItem("handy-recent-tools") === null
    );
    await page.locator("#toast .toast-action").filter({ hasText: "Undo" }).click();
    await page.waitForFunction(() =>
      localStorage.getItem("handy-tool-usage") === JSON.stringify({ Calculator: 3 })
      && localStorage.getItem("handy-recent-searches") === JSON.stringify(["timer"])
      && localStorage.getItem("handy-recent-tools") === JSON.stringify(["Calculator"])
    );

    await page.evaluate(() => {
      localStorage.setItem("handy-recent-tools", JSON.stringify(["Calculator", "Timer & Stopwatch"]));
    });
    await page.click("#clearRecent");
    await page.waitForFunction(() => localStorage.getItem("handy-recent-tools") === null);
    await page.locator("#toast .toast-action").filter({ hasText: "Undo" }).click();
    await page.waitForFunction(() =>
      localStorage.getItem("handy-recent-tools") === JSON.stringify(["Calculator", "Timer & Stopwatch"])
    );

    const calculatorFavorite = page.getByRole("button", { name: "Favorite Calculator" });
    assert.strictEqual(await calculatorFavorite.getAttribute("aria-pressed"), "false");
    await calculatorFavorite.click();
    assert.strictEqual(await calculatorFavorite.getAttribute("aria-pressed"), "true");
    await calculatorFavorite.click();

    await page.locator("#toolGrid").getByRole("button", { name: "Open Calculator" }).click();
    await page.waitForSelector("#calculatorModal:not([hidden])");
    assert(requestedToolScripts.has("/calculator.js"), "Opening a tool should load its module.");
    assert.strictEqual(requestedToolScripts.has("/timer.js"), false);
    assert(await page.evaluate(() => document.querySelector("#calculatorModal").contains(document.activeElement)));
    await page.evaluate(() => {
      const modal = document.querySelector("#calculatorModal");
      const focusable = [...modal.querySelectorAll(
        'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], summary, [tabindex]:not([tabindex="-1"])'
      )].filter((element) => element.getClientRects().length > 0);
      focusable.at(-1).focus();
    });
    await page.keyboard.press("Tab");
    assert(await page.evaluate(() => {
      const modal = document.querySelector("#calculatorModal");
      const focusable = [...modal.querySelectorAll(
        'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], summary, [tabindex]:not([tabindex="-1"])'
      )].filter((element) => element.getClientRects().length > 0);
      return document.activeElement === focusable[0]
        && getComputedStyle(document.activeElement).outlineWidth !== "0px";
    }));
    await page.keyboard.press("Shift+Tab");
    assert(await page.evaluate(() => {
      const modal = document.querySelector("#calculatorModal");
      const focusable = [...modal.querySelectorAll(
        'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], summary, [tabindex]:not([tabindex="-1"])'
      )].filter((element) => element.getClientRects().length > 0);
      return document.activeElement === focusable.at(-1);
    }));
    await page.click("#calculatorModal .tool-share");
    await page.waitForFunction(() => typeof window.copiedToolLink === "string" && window.copiedToolLink.includes("?tool=calculator"));
    assert.match(await page.evaluate(() => window.copiedToolLink), /[?&]tool=calculator/);
    await page.getByText("Tool link copied.").waitFor();
    await page.click('#calculatorGrid [data-value="2"]');
    await page.click('#calculatorGrid [data-value="+"]');
    await page.click('#calculatorGrid [data-value="3"]');
    await page.click('#calculatorGrid [data-action="equals"]');
    assert.strictEqual(await page.locator("#calculatorOutput").textContent(), "5");
    assert.strictEqual(await page.locator(".history-item").count(), 1);
    assert.strictEqual(await page.locator(".history-expression").textContent(), "2 + 3");
    const historyPosition = await page.locator("#calculatorHistory").evaluate((history) => history.getBoundingClientRect().top);
    const keypadPosition = await page.locator("#calculatorGrid").evaluate((keypad) => keypad.getBoundingClientRect().top);
    assert(historyPosition < keypadPosition);
    await page.click("#clearCalculatorHistory");
    assert.strictEqual(await page.locator(".history-item").count(), 0);
    await page.locator("#toast .toast-action").filter({ hasText: "Undo" }).click();
    assert.strictEqual(await page.locator(".history-item").count(), 1);
    await page.click("#clearCalculatorHistory");
    await page.click("#calculatorGrid [data-action='clear']");
    await page.click("#calculatorGrid [data-value='8']");
    await page.click("#calculatorGrid [data-value='/']");
    await page.click("#calculatorGrid [data-value='0']");
    await page.click("#calculatorGrid [data-action='equals']");
    assert.strictEqual(await page.locator("#calculatorOutput").textContent(), "Cannot divide by zero");
    await page.click("#calculatorGrid [data-action='clear']");
    await page.click("#calculatorGrid [data-value='9']");
    await page.click("#calculatorGrid [data-value='9']");
    await page.click("#calculatorGrid [data-value='9']");
    await page.click("#calculatorGrid [data-value='*']");
    await page.click("#calculatorGrid [data-value='9']");
    await page.click("#calculatorGrid [data-value='9']");
    await page.click("#calculatorGrid [data-value='9']");
    await page.click("#calculatorGrid [data-action='equals']");
    assert.strictEqual(await page.locator("#calculatorOutput").textContent(), "998001");
    await page.click("#calculatorGrid [data-action='clear']");
    await page.evaluate(() => {
      const grid = document.querySelector("#calculatorGrid");
      for (let index = 0; index < 310; index += 1) grid.querySelector("[data-value='9']").click();
      grid.querySelector("[data-value='*']").click();
      for (let index = 0; index < 310; index += 1) grid.querySelector("[data-value='9']").click();
    });
    await page.click("#calculatorGrid [data-action='equals']");
    assert.strictEqual(await page.locator("#calculatorOutput").textContent(), "Result is too large");
    assert.strictEqual(new URL(page.url()).searchParams.get("tool"), "calculator");
    await page.keyboard.press("Escape");
    assert(await page.locator("#calculatorModal").evaluate((modal) => modal.hidden));
    assert(await page.locator("#toolGrid").getByRole("button", { name: "Open Calculator" }).evaluate((button) => document.activeElement === button));
    await page.waitForFunction(() => !new URL(location.href).searchParams.has("tool"));
    assert((await page.locator(".saved-tool").count()) >= 1);

    await page.getByRole("button", { name: "Open Unit Converter" }).click();
    await page.waitForSelector("#unitConverterModal:not([hidden])");
    await page.selectOption("#unitCategory", "length");
    await page.selectOption("#unitFrom", "kilometer");
    await page.selectOption("#unitTo", "mile");
    await page.fill("#unitFromValue", "100");
    assert.strictEqual(await page.locator("#unitToValue").inputValue(), "62.137");
    await page.click("#unitCopy");
    await page.waitForFunction(() => window.copiedToolLink === "62.137");
    await page.click("#unitSwap");
    assert.strictEqual(await page.locator("#unitFrom").inputValue(), "mile");
    assert.strictEqual(await page.locator("#unitTo").inputValue(), "kilometer");
    assert.strictEqual(await page.locator("#unitFromValue").inputValue(), "62.137");
    await page.selectOption("#unitCategory", "area");
    await page.selectOption("#unitFrom", "squareKilometer");
    await page.selectOption("#unitTo", "squareFoot");
    await page.fill("#unitFromValue", "1e308");
    assert.strictEqual(await page.locator("#unitToValue").inputValue(), "Result is too large");
    assert(await page.locator("#unitCopy").isDisabled());
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: "Open Timer and Stopwatch" }).click();
    await page.waitForSelector("#timerModal:not([hidden])");
    assert.strictEqual(await page.locator("#timerStart").getAttribute("aria-label"), "Start timer");
    await page.click("#timerStart");
    assert.strictEqual(await page.locator("#timerStart").getAttribute("aria-label"), "Pause timer");
    await page.fill("#timerSeconds", "2");
    assert.strictEqual(await page.locator("#timerTime").textContent(), "05:02");
    await page.waitForFunction(() =>
      document.querySelector("#timerStatus").textContent.includes("Timer started")
    );
    await page.click("#timerStart");
    await page.waitForFunction(() =>
      document.querySelector("#timerStatus").textContent.includes("Timer paused at")
    );
    assert.match(await page.locator("#timerStatus").textContent(), /Timer paused at/);
    await page.click("#timerReset");
    await page.waitForFunction(() =>
      document.querySelector("#timerStatus").textContent.includes("Timer reset")
    );
    assert.match(await page.locator("#timerStatus").textContent(), /Timer reset/);
    await page.getByRole("button", { name: "Tea · 3 min" }).click();
    assert.strictEqual(await page.locator("#timerMinutes").inputValue(), "3");
    assert.strictEqual(await page.locator("#timerSeconds").inputValue(), "0");
    await page.click("#timerStart");
    await page.keyboard.press("Escape");
    assert(await page.locator("#timerModal").evaluate((modal) => modal.hidden));
    assert(await page.evaluate(() => Number.isFinite(
      JSON.parse(localStorage.getItem("handy-timer-state"))?.endsAt
    )));
    await page.reload();
    await page.getByRole("button", { name: "Open Timer and Stopwatch" }).click();
    await page.waitForSelector("#timerModal:not([hidden])");
    assert.strictEqual(await page.locator("#timerStart").getAttribute("aria-label"), "Pause timer");
    const restoredTime = (await page.locator("#timerTime").textContent()).split(":").map(Number);
    assert(restoredTime[0] * 60 + restoredTime[1] >= 178);
    assert(restoredTime[0] * 60 + restoredTime[1] <= 180);
    await page.click("#timerStart");
    await page.click("#timerReset");
    await page.locator(".timer-tab[data-mode='stopwatch']").click();
    assert(await page.locator("#timerDuration").evaluate((element) => element.classList.contains("hidden")));
    assert(await page.locator("#timerLap").isVisible());
    assert(await page.locator("#timerLap").isDisabled());
    await page.click("#timerStart");
    await page.waitForTimeout(1100);
    await page.click("#timerLap");
    assert.strictEqual(await page.locator("#timerLapList li").count(), 1);
    assert.match(await page.locator("#timerLapList li").first().textContent(), /Lap 1.*Split 00:0[1-9]/);
    await page.click("#timerStart");
    assert(await page.locator("#timerLap").isDisabled());
    await page.click("#timerReset");
    assert.strictEqual(await page.locator("#timerLapList li").count(), 0);
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: "Open World Clock" }).click();
    await page.waitForSelector("#worldClockModal:not([hidden])");
    assert((await page.locator(".clock-card").count()) >= 3);
    await page.selectOption("#clockCity", "Asia/Tokyo");
    await page.click("#addClockCity");
    assert((await page.locator("#clockList .clock-card").filter({ hasText: "Tokyo" }).count()) === 1);
    await page.locator("#clockList .clock-card").filter({ hasText: "Tokyo" }).locator(".clock-copy").click();
    await page.waitForFunction(() => window.copiedToolLink?.includes("Tokyo"));
    await page.locator("#clockList .clock-card").filter({ hasText: "Tokyo" }).locator(".clock-remove").click();
    assert((await page.locator("#clockList .clock-card").filter({ hasText: "Tokyo" }).count()) === 0);
    await page.locator("#toast .toast-action").filter({ hasText: "Undo" }).click();
    assert((await page.locator("#clockList .clock-card").filter({ hasText: "Tokyo" }).count()) === 1);
    await page.keyboard.press("Escape");

    let rateRequests = 0;
    let forceCurrencyOffline = false;
    await page.route("https://open.er-api.com/v6/latest/USD", async (route) => {
      if (forceCurrencyOffline) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ result: "error" })
        });
        return;
      }
      rateRequests += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          result: "success",
          time_last_update_utc: "2026-11-22T00:00:00Z",
          rates: { USD: 1, EUR: 0.9, GBP: 0.8, JPY: 150, AUD: 1.5, CAD: 1.3, CHF: 0.9, CNY: 7, INR: 80, SGD: 1.3, AED: 3.6, NZD: 1.6 }
        })
      });
    });
    forceCurrencyOffline = true;
    await page.locator("#toolGrid").getByRole("button", { name: "Open Currency Exchange" }).click();
    await page.waitForSelector("#currencyModal:not([hidden])");
    await page.waitForFunction(() =>
      document.querySelector("#currencyStatus").textContent === "Live rates unavailable · Using reference rates · Tap Refresh to retry"
    );
    await page.keyboard.press("Escape");
    forceCurrencyOffline = false;

    const timeoutRoute = async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 8500));
      await route.abort("timedout");
    };
    await page.route("https://open.er-api.com/v6/latest/USD", timeoutRoute);
    await page.locator("#toolGrid").getByRole("button", { name: "Open Currency Exchange" }).click();
    await page.waitForSelector("#currencyModal:not([hidden])");
    await page.waitForFunction(() =>
      document.querySelector("#currencyStatus").textContent.includes("timed out")
      || document.querySelector("#currencyStatus").textContent.includes("Tap Refresh")
    , null, { timeout: 10000 });
    assert(await page.locator("#currencyRefresh").isEnabled());
    await page.keyboard.press("Escape");
    await page.unroute("https://open.er-api.com/v6/latest/USD", timeoutRoute);
    await page.locator("#toolGrid").getByRole("button", { name: "Open Currency Exchange" }).click();
    await page.waitForSelector("#currencyModal:not([hidden])");
    await page.getByText(/Live rates · Updated/).waitFor();
    assert.notStrictEqual(await page.locator("#currencyResult").textContent(), "—");
    await page.fill("#currencyAmount", "-1");
    assert(await page.locator("#currencyCopyResult").isDisabled());
    await page.fill("#currencyAmount", "100");
    await page.waitForFunction(() => !document.querySelector("#currencyCopyResult").disabled);
    await page.click("#currencySwap");
    assert.strictEqual(await page.locator("#currencyFrom").inputValue(), "EUR");
    assert.strictEqual(await page.locator("#currencyTo").inputValue(), "USD");
    assert.strictEqual(await page.locator("#currencyAmount").inputValue(), "90");
    assert.strictEqual(await page.locator("#currencyResult").textContent(), "100");
    await page.click("#currencySwap");
    assert.strictEqual(await page.locator("#currencyAmount").inputValue(), "100");
    await page.click("#currencyCopyResult");
    await page.waitForFunction(() => window.copiedCurrencyConversion === "100 USD = 90 EUR");
    await page.getByText("Conversion copied.").waitFor();
    const savedLiveRates = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("handy-currency-live-rates"))
    );
    assert.strictEqual(savedLiveRates.rates.EUR, 0.9);
    assert.strictEqual(savedLiveRates.updatedAt, "2026-11-22T00:00:00Z");
    const refreshResponse = page.waitForResponse("https://open.er-api.com/v6/latest/USD");
    await page.click("#currencyRefresh");
    await refreshResponse;
    assert.strictEqual(rateRequests, 2);
    await page.keyboard.press("Escape");
    forceCurrencyOffline = true;
    await context.setOffline(true);
    await page.locator("#toolGrid").getByRole("button", { name: "Open Currency Exchange" }).click();
    await page.waitForSelector("#currencyModal:not([hidden])");
    await page.click("#currencyRefresh");
    await page.waitForFunction(() =>
      document.querySelector("#currencyStatus").textContent.startsWith("Offline · Using saved rates · Updated")
    );
    await context.setOffline(false);
    await page.keyboard.press("Escape");
    forceCurrencyOffline = false;

    await page.getByRole("button", { name: "Scan QR code" }).click();
    await page.waitForSelector("#qrModal:not([hidden])");
    assert(requestedToolScripts.has("/qr-code.js"));
    assert(requestedToolScripts.has("/node_modules/qrcode-generator/dist/qrcode.js"));
    assert(requestedToolScripts.has("/node_modules/jsqr/dist/jsQR.js"));
    await page.locator("#qrImageInput").setInputFiles({
      name: "broken.png",
      mimeType: "image/png",
      buffer: Buffer.from("not-an-image")
    });
    await page.waitForFunction(() =>
      document.querySelector("#qrScanStatus").textContent.includes("Could not read that image")
    );
    assert(await page.locator("#qrScanRetry").isVisible());
    await page.click("#qrModal .tool-share");
    await page.waitForFunction(() => typeof window.copiedToolLink === "string" && window.copiedToolLink.includes("tool=qr"));
    assert.match(await page.evaluate(() => window.copiedToolLink), /[?&]tool=qr&mode=scan/);
    assert(await page.locator("#qrScanner").evaluate((scanner) => !scanner.hidden));
    assert(await page.locator("#qrCreator").evaluate((creator) => creator.hidden));
    assert.strictEqual(await page.locator("#qrScanTab").getAttribute("aria-selected"), "true");
    await page.keyboard.press("Escape");

    await page.locator("#toolGrid").getByRole("button", { name: "Open QR Code Maker" }).click();
    await page.waitForSelector("#qrModal:not([hidden])");
    await page.fill("#qrText", "https://handy.example");
    await page.click("#qrGenerate");
    await page.waitForTimeout(400);
    assert(await page.locator("#qrPreview").evaluate((preview) => preview.classList.contains("generated")));
    await page.click("#qrScanTab");
    const qrImage = await page.evaluate(() => {
      const code = qrcode(0, "M");
      code.addData("https://scan-test.example");
      code.make();
      return code.createDataURL(8, 4);
    });
    await page.locator("#qrImageInput").setInputFiles({
      name: "test-qr.png",
      mimeType: "image/png",
      buffer: Buffer.from(qrImage.split(",")[1], "base64")
    });
    await page.waitForFunction(() => document.querySelector("#qrScanText").textContent === "https://scan-test.example");
    assert.strictEqual(await page.locator("#qrScanStatus").textContent(), "QR code scanned successfully.");
    assert(await page.locator("#qrScanOpen").isVisible());
    assert.strictEqual(await page.evaluate(() => sessionStorage.getItem("handy-last-qr-result")), "https://scan-test.example");
    await page.evaluate(() => {
      window.openedQrUrl = null;
      window.open = (url) => { window.openedQrUrl = url; };
    });
    await page.click("#qrScanOpen");
    assert.strictEqual(await page.evaluate(() => window.openedQrUrl), "https://scan-test.example/");
    await page.click("#qrScanCopy");
    await page.waitForFunction(() => window.copiedToolLink === "https://scan-test.example");
    await page.evaluate(() => {
      window.requestedCameraModes = [];
      window.requestedTorchValues = [];
      Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
        configurable: true,
        value: async ({ video }) => {
          window.requestedCameraModes.push(video.facingMode.ideal);
          return new MediaStream();
        }
      });
      HTMLMediaElement.prototype.play = () => Promise.resolve();
    });
    await page.click("#qrCameraStart");
    await page.waitForFunction(() => !document.querySelector("#qrCameraFrame").hidden);
    assert(await page.locator(".qr-camera-guide").isVisible());
    assert(await page.locator("#qrFlashlightToggle").evaluate((button) => button.hidden));
    await page.click("#qrCameraStop");
    await page.evaluate(() => {
      Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
        configurable: true,
        value: async ({ video }) => {
          window.requestedCameraModes.push(video.facingMode.ideal);
          const stream = document.createElement("canvas").captureStream();
          const track = stream.getVideoTracks()[0];
          Object.defineProperty(track, "getCapabilities", {
            configurable: true,
            value: () => ({ torch: true })
          });
          Object.defineProperty(track, "applyConstraints", {
            configurable: true,
            value: async (constraints) => window.requestedTorchValues.push(constraints.advanced[0].torch)
          });
          return stream;
        }
      });
    });
    await page.click("#qrCameraStart");
    await page.waitForFunction(() => !document.querySelector("#qrCameraFrame").hidden);
    assert.strictEqual(await page.locator("#qrScanStatus").textContent(), "Align the QR code inside the frame.");
    assert.strictEqual(await page.locator("#qrCameraSwitch").getAttribute("aria-label"), "Switch to front camera");
    assert(await page.locator("#qrFlashlightToggle").isVisible());
    await page.click("#qrFlashlightToggle");
    assert.strictEqual(await page.locator("#qrFlashlightToggle").getAttribute("aria-pressed"), "true");
    await page.click("#qrFlashlightToggle");
    assert.deepStrictEqual(await page.evaluate(() => window.requestedTorchValues), [true, false]);
    await page.click("#qrCameraSwitch");
    await page.waitForFunction(() => window.requestedCameraModes.length === 3);
    assert.deepStrictEqual(await page.evaluate(() => window.requestedCameraModes), ["environment", "environment", "user"]);
    assert.strictEqual(await page.locator("#qrCameraSwitch").getAttribute("aria-label"), "Switch to rear camera");
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", { configurable: true, value: true });
      document.dispatchEvent(new Event("visibilitychange"));
      delete document.hidden;
    });
    assert(await page.locator("#qrCameraFrame").evaluate((frame) => frame.hidden));
    assert.strictEqual(
      await page.locator("#qrScanStatus").textContent(),
      "Camera stopped because you left this tab. Choose Use camera to restart."
    );
    const cameraErrors = [
      ["NotAllowedError", "Camera permission was denied. Allow camera access or upload an image."],
      ["NotFoundError", "No camera was found on this device. Upload an image to scan instead."],
      ["NotReadableError", "Camera is busy or unavailable. Close other camera apps or upload an image."]
    ];
    for (const [name, message] of cameraErrors) {
      await page.evaluate((errorName) => {
        Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
          configurable: true,
          value: () => Promise.reject(Object.assign(new Error(), { name: errorName }))
        });
      }, name);
      await page.click("#qrCameraStart");
      await page.waitForFunction((expected) => document.querySelector("#qrScanStatus").textContent === expected, message);
      assert(await page.locator("#qrCameraVideo").evaluate((video) => video.hidden));
      assert(await page.locator("#qrCameraStart").evaluate((button) => !button.hidden));
      assert(await page.locator("#qrCameraStop").evaluate((button) => button.hidden));
    }
    await page.keyboard.press("Escape");

    await page.keyboard.press("Control+K");
    await page.waitForSelector("#commandPalette:not([hidden])");
    assert(await page.locator(".command-palette-shortcuts").isVisible());
    await page.fill("#commandPaletteInput", "timer");
    assert.strictEqual(await page.locator("#commandPaletteList [role='option']").count(), 1);
    await page.keyboard.press("Escape");
    assert(await page.locator("#commandPalette").evaluate((palette) => palette.hidden));

    await page.keyboard.press("Control+K");
    await page.waitForSelector("#commandPalette:not([hidden])");
    await page.fill("#commandPaletteInput", "timer");
    await page.keyboard.press("Enter");
    await page.waitForSelector("#timerModal:not([hidden])");
    await page.keyboard.press("Escape");

    await page.keyboard.press("/");
    await page.waitForSelector("#commandPalette:not([hidden])");
    await page.fill("#commandPaletteInput", "QR");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await page.waitForSelector("#qrModal:not([hidden])");
    assert.strictEqual(await page.locator("#qrScanTab").getAttribute("aria-selected"), "true");
    await page.keyboard.press("Escape");

    await page.evaluate(() => {
      document.querySelector("#updateNotice").hidden = true;
    });
    await page.locator("#privacyPanel summary").scrollIntoViewIfNeeded();
    await page.locator("#keyboardShortcuts summary").click();
    assert(await page.locator("#keyboardShortcuts").evaluate((details) => details.open));
    assert.match(await page.locator("#keyboardShortcuts").textContent(), /Ctrl/);
    assert.match(await page.locator("#keyboardShortcuts").textContent(), /Esc/);
    await page.evaluate(() => {
      document.querySelector("#updateNotice").hidden = true;
      document.querySelector("#privacyPanel").open = true;
    });
    await page.click("#clearUpdateHistory");
    await page.waitForFunction(() =>
      document.querySelector("#diagnosticsStatus").textContent === "Update history cleared."
    );
    assert.strictEqual(await page.locator("#diagnosticUpdateHistory").textContent(), "No updates recorded");
    assert(await page.locator("#privacyPanel").evaluate((panel) => panel.open));
    await page.selectOption("#feedbackCategory", "feature");
    await page.fill("#feedbackDetails", "Add a keyboard shortcut guide");
    await page.click("#saveFeedback");
    await page.waitForFunction(() =>
      document.querySelector("#feedbackStatus").textContent.includes("saved")
    );
    assert.strictEqual(
      await page.evaluate(() => JSON.parse(localStorage.getItem("handy-feedback-draft")).details),
      "Add a keyboard shortcut guide"
    );
    const feedbackDownloadPromise = page.waitForEvent("download");
    await page.click("#exportFeedback");
    const feedbackDownload = await feedbackDownloadPromise;
    assert.strictEqual(feedbackDownload.suggestedFilename(), "handy-feedback.txt");
    await page.evaluate(() => {
      window.feedbackIssueOpened = null;
      window.open = (url) => { window.feedbackIssueOpened = url; };
    });
    await page.click("#openFeedbackIssue");
    assert.match(await page.evaluate(() => window.feedbackIssueOpened), /github\.com\/Reynaldsapico123\/Handy\/issues\/new/);
    await page.evaluate(() => localStorage.setItem("unrelated-site-setting", "keep"));
    await page.evaluate(() => localStorage.setItem("handy-calculator-history", JSON.stringify(["private"])));
    page.once("dialog", (dialog) => dialog.accept());
    await Promise.all([
      page.waitForNavigation({ waitUntil: "load" }),
      page.click("#clearLocalData")
    ]);
    const privacyCleanupState = await page.evaluate(() => ({
      unrelated: localStorage.getItem("unrelated-site-setting"),
      calculatorHistory: localStorage.getItem("handy-calculator-history"),
      theme: localStorage.getItem("handy-theme"),
      feedbackDraft: localStorage.getItem("handy-feedback-draft")
    }));
    assert.strictEqual(privacyCleanupState.unrelated, "keep");
    assert.strictEqual(privacyCleanupState.calculatorHistory, null);
    assert.strictEqual(privacyCleanupState.theme, null);
    assert.strictEqual(privacyCleanupState.feedbackDraft, null);

    await page.evaluate(() => {
      document.querySelector("#updateNotice").hidden = true;
      document.querySelector("#privacyPanel").open = true;
    });
    await page.click("#refreshDiagnostics");
    await page.waitForFunction(() =>
      document.querySelector("#diagnosticsStatus").textContent === "Diagnostics refreshed."
    );
    assert.match(await page.locator("#offlineRecoveryStatus").textContent(), /Offline recovery/);
    assert(["Online", "Offline"].includes(await page.locator("#diagnosticConnection").textContent()));
    assert(["Browser", "Standard web", "Installed PWA"].includes(await page.locator("#diagnosticMode").textContent()));
    assert.strictEqual(await page.locator("#diagnosticVersion").textContent(), "1.0.0");
    assert((await page.locator("#diagnosticBuild").textContent()).length > 0);
    assert.strictEqual(await page.locator("#diagnosticProduction").textContent(), "https://handy-6on.pages.dev");
    await page.click("#copyDiagnostics");
    await page.waitForFunction(() =>
      document.querySelector("#diagnosticsStatus").textContent === "Diagnostics copied."
    );
    const diagnosticCopy = await page.evaluate(() => window.copiedToolLink || "");
    assert(diagnosticCopy === "" || diagnosticCopy.includes("Handy diagnostics"));

    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload({ waitUntil: "networkidle" });
    await page.emulateMedia({ reducedMotion: "reduce" });
    assert.strictEqual(await page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior), "auto");
    await page.emulateMedia({ reducedMotion: "no-preference" });
    assert(await page.locator(".mobile-bottom-nav").isVisible());
    assert.strictEqual(await page.locator(".mobile-bottom-nav a").count(), 3);
    assert.strictEqual(await page.evaluate(() => getComputedStyle(document.documentElement).width), "390px");
    assert(await page.evaluate(() => {
      const navButton = document.querySelector("#menuToggle");
      return navButton.getBoundingClientRect().width >= 44
        && navButton.getBoundingClientRect().height >= 44;
    }));
    await page.locator("#toolGrid").getByRole("button", { name: "Open Calculator" }).click();
    await page.waitForSelector("#calculatorModal:not([hidden])");
    await page.waitForTimeout(250);
    assert(await page.evaluate(() => {
      const panel = document.querySelector("#calculatorModal .calculator-panel");
      const rect = panel.getBoundingClientRect();
      return rect.bottom <= window.innerHeight + 5
        && rect.left <= 5
        && rect.right >= window.innerWidth - 5;
    }));
    await page.keyboard.press("Escape");
    await page.click("#menuToggle");
    assert(await page.locator("#mobileMenu").evaluate((menu) => menu.hidden === false));
    await page.click("#menuToggle");
    const hasHorizontalOverflow = await page.evaluate(() =>
      document.documentElement.scrollWidth > document.documentElement.clientWidth
    );
    assert.strictEqual(hasHorizontalOverflow, false);
    await page.locator("#travelKit").scrollIntoViewIfNeeded();
    assert(await page.locator("#mobileTravelSave").isVisible());
    assert(await page.evaluate(() => {
      const save = document.querySelector("#mobileTravelSave").getBoundingClientRect();
      const nav = document.querySelector(".mobile-bottom-nav").getBoundingClientRect();
      return save.bottom <= nav.top + 1 && save.width >= 300;
    }));
    await page.evaluate(() => window.scrollTo(0, document.querySelector("#travelKit").offsetTop));
    await page.waitForTimeout(150);
    assert(await page.evaluate(() => {
      const manager = document.querySelector(".travel-kit-manager");
      return getComputedStyle(manager).position === "sticky"
        && manager.getBoundingClientRect().top >= 68;
    }));

    const offlineContext = await browser.newContext({ serviceWorkers: "allow" });
    try {
      const offlinePage = await offlineContext.newPage();
      const remoteFontRequests = [];
      offlinePage.on("request", (request) => {
        if (/^https:\/\/fonts\.(?:googleapis|gstatic)\.com\//.test(request.url())) {
          remoteFontRequests.push(request.url());
        }
      });
      await offlinePage.addInitScript(() => {
        localStorage.setItem("handy-welcome-dismissed", "true");
      });
      let offlineRateRequests = 0;
      await offlinePage.route("https://open.er-api.com/v6/latest/USD", async (route) => {
        offlineRateRequests += 1;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            result: "success",
            time_last_update_utc: "2026-11-22T01:00:00Z",
            rates: { USD: 1, EUR: 0.75, GBP: 0.8, JPY: 150, AUD: 1.5, CAD: 1.3, CHF: 0.9, CNY: 7, INR: 80, SGD: 1.3, AED: 3.6, NZD: 1.6 }
          })
        });
      });
      await offlinePage.goto("http://127.0.0.1:4174/", { waitUntil: "networkidle" });
      await offlinePage.waitForFunction(() => navigator.serviceWorker.controller !== null);
      await offlinePage.reload({ waitUntil: "networkidle" });
      await offlinePage.locator("#toolGrid").getByRole("button", { name: "Open Currency Exchange" }).click();
      await offlinePage.waitForSelector("#currencyModal:not([hidden])");
      await offlinePage.waitForFunction(() =>
        document.querySelector("#currencyStatus").textContent.startsWith("Live rates · Updated")
      );
      assert.strictEqual(offlineRateRequests, 1);
      assert.strictEqual(await offlinePage.locator("#currencyResult").textContent(), "75");
      await offlinePage.keyboard.press("Escape");
      await offlineContext.setOffline(true);
      await offlinePage.reload({ waitUntil: "domcontentloaded" });
      assert.strictEqual(await offlinePage.title(), "Handy — Everyday tools for everyone");
      await offlinePage.waitForSelector("#offlineNotice:not([hidden])");
      assert.match(await offlinePage.locator("#offlineNoticeText").textContent(), /You're offline/);
      assert.strictEqual(await offlinePage.locator("#connectionStatusText").textContent(), "Offline");
      await offlinePage.click("#dismissOfflineNotice");
      assert(await offlinePage.locator("#offlineNotice").evaluate((notice) => notice.hidden));
      assert.strictEqual(remoteFontRequests.length, 0);
      assert.match(
        await offlinePage.locator("body").evaluate((body) => getComputedStyle(body).fontFamily),
        /system-ui/
      );
      const offlineSharedUrl = await offlinePage.evaluate(() => {
        const payload = {
          v: 1,
          n: "Offline trip",
          d: "Tokyo, Japan",
          h: "USD",
          c: "JPY",
          z: "Asia/Tokyo",
          q: "",
          cl: [1, 3],
          b: { limit: 1000, currency: "USD", spent: 45 },
          i: [{ title: "Train", dateTime: "2026-12-10T09:30", location: "Tokyo" }]
        };
        const bytes = new TextEncoder().encode(JSON.stringify(payload));
        let binary = "";
        bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
        const encoded = btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
        return `${location.origin}/?trip=${encoded}`;
      });
      await offlinePage.goto(offlineSharedUrl, { waitUntil: "domcontentloaded" });
      await offlinePage.waitForSelector("#sharedTripView:not([hidden])");
      assert.strictEqual(await offlinePage.locator("#sharedTripName").textContent(), "Offline trip");
      assert.strictEqual(await offlinePage.locator("#sharedTripDestination").textContent(), "Tokyo, Japan");
      await offlinePage.locator("#toolGrid").getByRole("button", { name: "Open Calculator" }).click();
      await offlinePage.waitForSelector("#calculatorModal:not([hidden])");
      await offlinePage.keyboard.press("Escape");
      const offlineTools = [
        ["Open Unit Converter", "#unitConverterModal"],
        ["Open Timer and Stopwatch", "#timerModal"],
        ["Open World Clock", "#worldClockModal"],
        ["Open QR Code Maker", "#qrModal"]
      ];
      for (const [buttonName, modalSelector] of offlineTools) {
        await offlinePage.locator("#toolGrid").getByRole("button", { name: buttonName }).click();
        await offlinePage.waitForSelector(`${modalSelector}:not([hidden])`);
        await offlinePage.keyboard.press("Escape");
      }
      await offlinePage.locator("#toolGrid").getByRole("button", { name: "Open Currency Exchange" }).click();
      await offlinePage.waitForSelector("#currencyModal:not([hidden])");
      await offlinePage.waitForFunction(() =>
        document.querySelector("#currencyStatus").textContent.startsWith("Offline · Using saved rates · Updated")
      );
      assert.strictEqual(await offlinePage.locator("#currencyResult").textContent(), "75");
      assert.strictEqual(offlineRateRequests, 1);
      await offlinePage.keyboard.press("Escape");
      await offlinePage.getByRole("button", { name: "Scan QR code" }).click();
      await offlinePage.waitForSelector("#qrModal:not([hidden])");
      const offlineQrImage = await offlinePage.evaluate(() => {
        const code = qrcode(0, "M");
        code.addData("https://offline-scan-test.example");
        code.make();
        return code.createDataURL(8, 4);
      });
      await offlinePage.locator("#qrImageInput").setInputFiles({
        name: "offline-qr.png",
        mimeType: "image/png",
        buffer: Buffer.from(offlineQrImage.split(",")[1], "base64")
      });
      await offlinePage.waitForFunction(() =>
        document.querySelector("#qrScanText").textContent === "https://offline-scan-test.example"
      );
      await offlineContext.setOffline(false);
      await offlinePage.waitForFunction(() =>
        document.querySelector("#connectionStatusText").textContent === "Online"
      );
      assert(await offlinePage.locator("#offlineNotice").evaluate((notice) => notice.hidden));
    } finally {
      await offlineContext.close();
    }

    await runServiceWorkerUpdateTest(chromium, "Chromium");

    const directLinkContext = await browser.newContext({ serviceWorkers: "block" });
    try {
      const directPage = await directLinkContext.newPage();
      await directPage.addInitScript(() => {
        localStorage.setItem("handy-welcome-dismissed", "true");
        window.printCalled = false;
        window.print = () => { window.printCalled = true; };
        Object.defineProperty(navigator, "serviceWorker", {
          configurable: true,
          value: {
            controller: {},
            register: async () => ({ waiting: null, installing: null, addEventListener() {} }),
            getRegistrations: async () => [
              {
                scope: `${location.origin}/`,
                unregister: async () => {
                  const key = "test-same-origin-unregisters";
                  sessionStorage.setItem(key, String(Number(sessionStorage.getItem(key) || "0") + 1));
                  return true;
                }
              },
              {
                scope: "https://unrelated.example/",
                unregister: async () => {
                  const key = "test-other-origin-unregisters";
                  sessionStorage.setItem(key, String(Number(sessionStorage.getItem(key) || "0") + 1));
                  return true;
                }
              }
            ],
            addEventListener() {}
          }
        });
        Object.defineProperty(navigator, "share", {
          configurable: true,
          value: async (data) => { window.nativeSharePayload = data; }
        });
        Object.defineProperty(navigator, "clipboard", {
          configurable: true,
          value: {
            writeText: async (text) => { window.copiedTravelLink = text; }
          }
        });
      });
      const directLinks = [
        ["calculator", "calculatorModal"],
        ["unit-converter", "unitConverterModal"],
        ["timer", "timerModal"],
        ["world-clock", "worldClockModal"],
        ["currency", "currencyModal"],
        ["qr&mode=scan", "qrModal"],
        ["guides", "guidesModal"]
      ];
      for (const [tool, modalId] of directLinks) {
        await directPage.goto(`http://127.0.0.1:4174/?tool=${tool}`, { waitUntil: "networkidle" });
        await directPage.waitForSelector(`#${modalId}:not([hidden])`);
        assert.strictEqual(new URL(directPage.url()).searchParams.has("tool"), true);
        assert(await directPage.locator(`#${modalId} .tool-share`).isVisible());
        if (tool === "calculator") {
          await directPage.click(`#${modalId} .tool-share`);
          await directPage.waitForFunction(() => window.nativeSharePayload?.url === location.href);
          assert.match(await directPage.evaluate(() => window.nativeSharePayload.title), /Calculator/);
        }
        if (tool === "qr&mode=scan") {
          assert.strictEqual(await directPage.locator("#qrScanTab").getAttribute("aria-selected"), "true");
          await directPage.click(`#${modalId} .tool-share`);
          await directPage.waitForFunction(() => window.nativeSharePayload?.url === location.href);
          assert.match(await directPage.evaluate(() => window.nativeSharePayload.url), /[?&]tool=qr&mode=scan/);
        }
        await directPage.locator(`#${modalId} .modal-close`).click();
        await directPage.waitForFunction(() => !new URL(location.href).searchParams.has("tool"));
      }

      await directPage.goto("http://127.0.0.1:4174/", { waitUntil: "networkidle" });
      await directPage.evaluate(async () => {
        localStorage.setItem("handy-theme", "dark");
        await caches.open("handy-recovery-test");
        await caches.open("unrelated-app-cache");
      });
      const calculatorCard = directPage.locator("#toolGrid .tool-card").filter({ hasText: "Calculator" });
      await calculatorCard.locator(".card-arrow").click();
      await directPage.waitForSelector("#calculatorModal:not([hidden])");
      await directPage.locator("#calculatorModal .modal-close").click();
      await directPage.evaluate(() => { delete window.openCalculator; });
      await calculatorCard.locator(".card-arrow").click();
      await directPage.waitForURL(/recovered=development/);
      await directPage.waitForLoadState("networkidle");
      const recoveryState = await directPage.evaluate(async () => ({
        theme: localStorage.getItem("handy-theme"),
        recoveryBuild: sessionStorage.getItem("handy-open-recovery"),
        sameOriginUnregisters: sessionStorage.getItem("test-same-origin-unregisters"),
        otherOriginUnregisters: sessionStorage.getItem("test-other-origin-unregisters"),
        cacheNames: await caches.keys()
      }));
      assert.strictEqual(recoveryState.theme, "dark");
      assert.strictEqual(recoveryState.recoveryBuild, "development");
      assert.strictEqual(recoveryState.sameOriginUnregisters, "1");
      assert.strictEqual(recoveryState.otherOriginUnregisters, null);
      assert(!recoveryState.cacheNames.includes("handy-recovery-test"));
      assert(recoveryState.cacheNames.includes("unrelated-app-cache"));

      await directPage.goto("http://127.0.0.1:4174/", { waitUntil: "networkidle" });
      await calculatorCard.locator(".card-arrow").click();
      await directPage.waitForSelector("#calculatorModal:not([hidden])");
      await directPage.locator("#calculatorModal .modal-close").click();
      await directPage.evaluate(() => {
        sessionStorage.removeItem("handy-open-recovery");
        delete window.openCalculator;
        Object.defineProperty(navigator, "serviceWorker", {
          configurable: true,
          value: {
            getRegistrations: async () => { throw new Error("Simulated recovery failure."); }
          }
        });
      });
      await calculatorCard.locator(".card-arrow").click();
      await directPage.waitForFunction(() =>
        document.querySelector("#toast .toast-action")?.textContent === "Reload"
      );
      assert.strictEqual(new URL(directPage.url()).searchParams.get("tool"), "calculator");
      const recoveryRetryNavigation = directPage.waitForNavigation({ waitUntil: "networkidle" });
      await directPage.locator("#toast .toast-action").click();
      await recoveryRetryNavigation;
      await directPage.waitForSelector("#calculatorModal:not([hidden])");
      assert.strictEqual(new URL(directPage.url()).searchParams.get("tool"), "calculator");

      await directPage.goto("http://127.0.0.1:4174/?tool=qr&mode=scan", { waitUntil: "networkidle" });
      await directPage.waitForSelector("#qrModal:not([hidden])");
      assert.strictEqual(await directPage.locator("#qrScanTab").getAttribute("aria-selected"), "true");
      await directPage.locator("#qrModal .modal-close").click();
      await directPage.evaluate(() => {
        sessionStorage.removeItem("handy-open-recovery");
        delete window.openQrCode;
        Object.defineProperty(navigator, "serviceWorker", {
          configurable: true,
          value: {
            getRegistrations: async () => { throw new Error("Simulated recovery failure."); }
          }
        });
      });
      await directPage.click("#qrScanShortcut");
      await directPage.waitForFunction(() =>
        document.querySelector("#toast .toast-action")?.textContent === "Reload"
      );
      assert.strictEqual(new URL(directPage.url()).searchParams.get("tool"), "qr");
      assert.strictEqual(new URL(directPage.url()).searchParams.get("mode"), "scan");
      const qrRecoveryNavigation = directPage.waitForNavigation({ waitUntil: "networkidle" });
      await directPage.locator("#toast .toast-action").click();
      await qrRecoveryNavigation;
      await directPage.waitForSelector("#qrModal:not([hidden])");
      assert.strictEqual(await directPage.locator("#qrScanTab").getAttribute("aria-selected"), "true");
      assert.strictEqual(new URL(directPage.url()).searchParams.get("mode"), "scan");

      await directPage.goto("http://127.0.0.1:4174/?tool=unknown", { waitUntil: "networkidle" });
      await directPage.waitForFunction(() => !new URL(location.href).searchParams.has("tool"));
      assert.strictEqual(await directPage.locator(".tool-modal:not([hidden])").count(), 0);

      await directPage.goto("http://127.0.0.1:4174/?tool=qr&mode=invalid", { waitUntil: "networkidle" });
      await directPage.waitForSelector("#qrModal:not([hidden])");
      assert.strictEqual(await directPage.locator("#qrGenerateTab").getAttribute("aria-selected"), "true");
      assert.strictEqual(new URL(directPage.url()).searchParams.has("mode"), false);
      await directPage.keyboard.press("Escape");

      await directPage.goto("http://127.0.0.1:4174/?mode=scan", { waitUntil: "networkidle" });
      assert.strictEqual(new URL(directPage.url()).searchParams.has("mode"), false);

      await directPage.goto("http://127.0.0.1:4174/?campaign=summer&tool=calculator", { waitUntil: "networkidle" });
      await directPage.waitForSelector("#calculatorModal:not([hidden])");
      await directPage.click("#calculatorModal .tool-share");
      await directPage.waitForFunction(() => window.nativeSharePayload?.url);
      const canonicalSharedUrl = new URL(await directPage.evaluate(() => window.nativeSharePayload.url));
      assert.strictEqual(canonicalSharedUrl.pathname, "/");
      assert.strictEqual(canonicalSharedUrl.search, "?tool=calculator");
      assert.strictEqual(canonicalSharedUrl.searchParams.has("campaign"), false);
      await directPage.locator("#calculatorModal .modal-close").click();

      await directPage.goto("http://127.0.0.1:4174/?trip=not-valid-encoding", { waitUntil: "networkidle" });
      await directPage.waitForSelector("#sharedTripView:not([hidden])");
      assert.strictEqual(await directPage.locator("#sharedTripName").textContent(), "Invalid shared trip");
      await directPage.goto(`http://127.0.0.1:4174/?trip=${"A".repeat(12001)}`, { waitUntil: "networkidle" });
      await directPage.waitForSelector("#sharedTripView:not([hidden])");
      assert.strictEqual(await directPage.locator("#sharedTripName").textContent(), "Invalid shared trip");

      await directPage.goto("http://127.0.0.1:4174/", { waitUntil: "networkidle" });
      assert(await directPage.locator("[data-travel-action]").first().isDisabled());
      assert(await directPage.locator("#travelKitEmpty").isVisible());
      await directPage.click("#startFirstTravelKit");
      assert.strictEqual(await directPage.evaluate(() => document.activeElement.id), "travelKitName");
      await directPage.fill("#travelKitName", "Tokyo getaway");
      await directPage.fill("#travelKitDestination", "Tokyo, Japan");
      await directPage.fill("#travelKitStartDate", "2026-12-10");
      await directPage.fill("#travelKitEndDate", "2026-12-15");
      assert.match(await directPage.locator("#travelDateSummary").textContent(), /6 days/);
      await directPage.fill("#travelKitEndDate", "2026-12-09");
      assert.match(await directPage.locator("#travelDateSummary").textContent(), /End date must be on or after/);
      await directPage.fill("#travelKitEndDate", "2026-12-15");
      assert(await directPage.locator("#travelPlanningSuggestion").isVisible());
      assert.match(await directPage.locator("#travelPlanningSuggestionText").textContent(), /Likely destination: Tokyo, Japan/);
      await directPage.click("#applyTravelPlanningSuggestion");
      assert.strictEqual(await directPage.locator("#travelKitTimeZone").inputValue(), "Asia/Tokyo");
      assert.strictEqual(await directPage.locator("#travelKitDestinationCurrency").inputValue(), "JPY");
      await directPage.selectOption("#travelKitHomeCurrency", "USD");
      await directPage.selectOption("#travelKitDestinationCurrency", "JPY");
      await directPage.selectOption("#travelKitTimeZone", "Asia/Tokyo");
      await directPage.fill("#travelKitQrNote", "https://example.test/tokyo");
      await directPage.click("#travelKitForm [type='submit']");
      assert.match(await directPage.locator("#travelKitStatus").textContent(), /Tokyo getaway is saved/);
      assert(await directPage.locator("[data-travel-action]").first().isEnabled());
      await directPage.click("[data-checklist-template='essentials']");
      assert.strictEqual(await directPage.locator("#travelChecklistList .travel-checklist-item").count(), 5);
      await directPage.fill("#travelChecklistItem", "Window seat");
      await directPage.click("#addTravelChecklistItem");
      assert.strictEqual(await directPage.locator("#travelChecklistList .travel-checklist-item").count(), 6);
      await directPage.locator("#travelChecklistList .travel-checklist-item").first().locator("input").check();
      assert.match(await directPage.locator("#travelChecklistProgress").textContent(), /1 of 6 complete/);
      directPage.once("dialog", (dialog) => dialog.accept());
      await directPage.click("#resetTravelChecklist");
      assert.match(await directPage.locator("#travelChecklistProgress").textContent(), /0 of 6 complete/);
      await directPage.locator("#toast .toast-action").filter({ hasText: "Undo" }).click();
      assert.match(await directPage.locator("#travelChecklistProgress").textContent(), /1 of 6 complete/);
      await directPage.locator("#travelChecklistList .travel-checklist-item").first().locator("input").check();
      await directPage.fill("#travelEventTitle", "Flight to Tokyo");
      await directPage.fill("#travelEventDateTime", "2026-12-10T09:30");
      await directPage.fill("#travelEventLocation", "Tokyo Haneda");
      await directPage.fill("#travelEventNotes", "Terminal 3");
      await directPage.click("#addTravelEvent");
      assert.strictEqual(await directPage.locator("#travelTimeline .travel-timeline-item").count(), 1);
      assert.match(await directPage.locator("#travelTimeline").textContent(), /Flight to Tokyo/);
      assert.match(await directPage.locator("#travelTimeline").textContent(), /Tokyo Haneda/);
      assert(await directPage.locator("#exportTravelCalendar").isEnabled());
      const wholeCalendarDownload = directPage.waitForEvent("download");
      await directPage.click("#exportTravelCalendar");
      const wholeCalendar = await wholeCalendarDownload;
      assert.match(wholeCalendar.suggestedFilename(), /-itinerary\.ics$/);
      const wholeCalendarText = await fs.promises.readFile(await wholeCalendar.path(), "utf8");
      assert.match(wholeCalendarText, /BEGIN:VCALENDAR/);
      assert.match(wholeCalendarText, /SUMMARY:Flight to Tokyo/);
      assert.match(wholeCalendarText, /LOCATION:Tokyo Haneda/);
      const eventCalendarDownload = directPage.waitForEvent("download");
      await directPage.locator("#travelTimeline .travel-timeline-calendar").click();
      const eventCalendar = await eventCalendarDownload;
      assert.match(eventCalendar.suggestedFilename(), /\.ics$/);
      await directPage.fill("#travelBudgetLimit", "1000");
      await directPage.locator("#travelBudgetLimit").blur();
      await directPage.selectOption("#travelBudgetCurrency", "USD");
      await directPage.fill("#travelExpenseTitle", "Train ticket");
      await directPage.fill("#travelExpenseAmount", "45");
      await directPage.selectOption("#travelExpenseCategory", "transport");
      await directPage.click("#addTravelExpense");
      assert.strictEqual(await directPage.locator("#travelExpenseList .travel-expense-item").count(), 1);
      assert.match(await directPage.locator("#travelBudgetSpent").textContent(), /45/);
      assert.match(await directPage.locator("#travelBudgetRemaining").textContent(), /955/);
      assert.strictEqual(await directPage.locator("#travelBudgetProgress").getAttribute("aria-valuenow"), "5");
      assert.strictEqual(await directPage.locator("#travelExpenseCategoryList [data-category='transport']").count(), 1);
      assert.match(await directPage.locator("#travelExpenseCategoryList [data-category='transport']").textContent(), /100%/);
      const expenseCsvDownload = directPage.waitForEvent("download");
      await directPage.click("#exportTravelExpenses");
      const expenseCsv = await expenseCsvDownload;
      assert.strictEqual(expenseCsv.suggestedFilename(), "tokyo-getaway-expenses.csv");
      const expenseCsvPath = await expenseCsv.path();
      const expenseCsvText = await fs.promises.readFile(expenseCsvPath, "utf8");
      assert.match(expenseCsvText, /Tokyo getaway/);
      assert.match(expenseCsvText, /Train ticket/);
      assert.match(expenseCsvText, /transport/);
      await directPage.click("#printSharedTrip");
      assert.strictEqual(await directPage.evaluate(() => window.printCalled), true);
      assert.strictEqual(await directPage.locator("#printTripName").textContent(), "Tokyo getaway");
      assert.strictEqual(await directPage.locator("#printTripDestination").textContent(), "Tokyo, Japan");
      assert.match(await directPage.locator("#printTripDates").textContent(), /Dec 10, 2026/);
      assert.match(await directPage.locator("#printTripChecklist").textContent(), /1 of 6 complete/);
      assert.match(await directPage.locator("#printTripBudget").textContent(), /45/);
      assert.match(await directPage.locator("#printTripBudget").textContent(), /955/);
      assert.strictEqual(await directPage.locator("#printTripChecklistList li").count(), 6);
      assert.strictEqual(await directPage.locator("#printTripTimeline li").count(), 1);
      const originalTokyoId = await directPage.evaluate(() =>
        JSON.parse(localStorage.getItem("handy-travel-kit")).activeId
      );
      await directPage.click("#duplicateTravelKit");
      assert.strictEqual(await directPage.locator("#travelKitSelector option").count(), 3);
      assert.match(await directPage.locator("#travelKitName").inputValue(), /Tokyo getaway copy/);
      await directPage.selectOption("#travelKitSelector", originalTokyoId);
      await directPage.emulateMedia({ media: "print" });
      assert(await directPage.locator("#printTripSummary").isVisible());
      assert(await directPage.locator(".header").isHidden());
      await directPage.emulateMedia({ media: "screen" });
      await directPage.click("#copySharedTrip");
      await directPage.waitForFunction(() => window.copiedTravelLink?.includes("?trip="));
      const sharedTripUrl = await directPage.evaluate(() => window.copiedTravelLink);
      assert(new URL(sharedTripUrl).searchParams.has("trip"));
      await directPage.click("#shareSharedTrip");
      await directPage.waitForFunction(() => window.nativeSharePayload?.url?.includes("?trip="));
      await directPage.click("#qrSharedTrip");
      await directPage.waitForSelector("#qrModal:not([hidden])");
      assert.match(await directPage.locator("#qrText").inputValue(), /\?trip=/);
      await directPage.locator("#qrModal .modal-close").click();
      await directPage.goto(sharedTripUrl, { waitUntil: "networkidle" });
      await directPage.waitForSelector("#sharedTripView:not([hidden])");
      assert.strictEqual(await directPage.locator("#sharedTripName").textContent(), "Tokyo getaway");
      assert.strictEqual(await directPage.locator("#sharedTripDestination").textContent(), "Tokyo, Japan");
      assert.match(await directPage.locator("#sharedTripChecklist").textContent(), /1 of 6 complete/);
      assert.strictEqual(await directPage.locator("#sharedTripView").getByText("Train ticket").count(), 0);
      await directPage.click("#closeSharedTrip");
      assert(await directPage.locator("#sharedTripView").evaluate((view) => view.hidden));
      const tokyoId = await directPage.evaluate(() =>
        JSON.parse(localStorage.getItem("handy-travel-kit")).activeId
      );
      await directPage.click("#newTravelKit");
      assert.strictEqual(await directPage.locator("#travelKitName").inputValue(), "");
      await directPage.fill("#travelKitName", "Paris weekend");
      await directPage.fill("#travelKitDestination", "Paris, France");
      await directPage.selectOption("#travelKitHomeCurrency", "GBP");
      await directPage.selectOption("#travelKitDestinationCurrency", "EUR");
      await directPage.selectOption("#travelKitTimeZone", "Europe/Paris");
      await directPage.click("#travelKitForm [type='submit']");
      const savedTravelKits = await directPage.evaluate(() =>
        JSON.parse(localStorage.getItem("handy-travel-kit"))
      );
      assert.strictEqual(savedTravelKits.trips.length, 3);
      const parisId = savedTravelKits.activeId;
      await directPage.selectOption("#travelKitSelector", tokyoId);
      assert.strictEqual(await directPage.locator("#travelKitDestination").inputValue(), "Tokyo, Japan");
      await directPage.fill("#travelKitDestination", "Osaka, Japan");
      assert(await directPage.locator("[data-travel-action]").first().isDisabled());
      await directPage.fill("#travelKitDestination", "Tokyo, Japan");
      assert(await directPage.locator("[data-travel-action]").first().isEnabled());

      await directPage.click("[data-travel-action='currency']");
      await directPage.waitForSelector("#currencyModal:not([hidden])");
      assert.strictEqual(await directPage.locator("#currencyFrom").inputValue(), "USD");
      assert.strictEqual(await directPage.locator("#currencyTo").inputValue(), "JPY");
      await directPage.locator("#currencyModal .modal-close").click();

      await directPage.click("[data-travel-action='clock']");
      await directPage.waitForSelector("#worldClockModal:not([hidden])");
      assert(await directPage.locator("#clockList .clock-card").filter({ hasText: "Tokyo" }).count());
      await directPage.locator("#worldClockModal .modal-close").click();

      await directPage.click("[data-travel-action='units']");
      await directPage.waitForSelector("#unitConverterModal:not([hidden])");
      assert.strictEqual(await directPage.locator("#unitCategory").inputValue(), "length");
      assert.strictEqual(await directPage.locator("#unitFrom").inputValue(), "kilometer");
      assert.strictEqual(await directPage.locator("#unitTo").inputValue(), "mile");
      await directPage.locator("#unitConverterModal .modal-close").click();

      await directPage.click("[data-travel-action='qr']");
      await directPage.waitForSelector("#qrModal:not([hidden])");
      assert.match(await directPage.locator("#qrText").inputValue(), /Tokyo getaway[\s\S]*https:\/\/example\.test\/tokyo/);
      await directPage.locator("#qrModal .modal-close").click();

      await directPage.reload({ waitUntil: "networkidle" });
      assert.strictEqual(await directPage.locator("#travelKitName").inputValue(), "Tokyo getaway");
      await directPage.selectOption("#travelKitSelector", parisId);
      assert.strictEqual(await directPage.locator("#travelKitDestination").inputValue(), "Paris, France");
      directPage.once("dialog", (dialog) => dialog.accept());
      await directPage.click("#deleteTravelKit");
      const afterDelete = await directPage.evaluate(() =>
        JSON.parse(localStorage.getItem("handy-travel-kit"))
      );
      assert.strictEqual(afterDelete.trips.length, 2);
      assert(afterDelete.trips.some((trip) => trip.id === tokyoId));
      await directPage.locator("#toast .toast-action").filter({ hasText: "Undo" }).click();
      const afterUndo = await directPage.evaluate(() =>
        JSON.parse(localStorage.getItem("handy-travel-kit"))
      );
      assert.strictEqual(afterUndo.trips.length, 3);
      assert(afterUndo.trips.some((trip) => trip.id === parisId));
      assert.strictEqual(afterUndo.activeId, parisId);

      await directPage.evaluate(() => localStorage.setItem("handy-travel-kit", JSON.stringify({
        name: "Legacy trip",
        destination: "London",
        homeCurrency: "USD",
        destinationCurrency: "GBP",
        timeZone: "Europe/London",
        qrNote: ""
      })));
      await directPage.reload({ waitUntil: "networkidle" });
      const migratedTravelKits = await directPage.evaluate(() =>
        JSON.parse(localStorage.getItem("handy-travel-kit"))
      );
      assert.strictEqual(migratedTravelKits.activeId, "legacy-travel-kit");
      assert.strictEqual(migratedTravelKits.trips[0].name, "Legacy trip");
    } finally {
      await directLinkContext.close();
    }

    const backupRates = {
      USD: 1,
      EUR: 0.9,
      GBP: 0.8,
      JPY: 150,
      AUD: 1.5,
      CAD: 1.3,
      CHF: 0.9,
      CNY: 7,
      INR: 80,
      SGD: 1.3,
      AED: 3.6,
      NZD: 1.6
    };
    await page.evaluate((rates) => {
      localStorage.setItem("handy-favorite-tools", JSON.stringify(["Calculator"]));
      localStorage.setItem("handy-recent-tools", JSON.stringify(["Timer & Stopwatch"]));
      localStorage.setItem("handy-theme", "light");
      localStorage.setItem("handy-currency-pair", JSON.stringify({ from: "USD", to: "EUR", amount: "12" }));
      localStorage.setItem("handy-currency-live-rates", JSON.stringify({
        rates,
        updatedAt: "2026-11-22T01:00:00Z"
      }));
      localStorage.setItem("handy-world-clock", JSON.stringify(["Europe/Paris"]));
      localStorage.setItem("handy-unit-converter", JSON.stringify({
        category: "length",
        from: "meter",
        to: "mile",
        value: "100"
      }));
      localStorage.setItem("handy-travel-kit", JSON.stringify({
        activeId: "trip-paris",
        trips: [
          {
            id: "trip-paris",
            name: "Paris visit",
            destination: "Paris, France",
            homeCurrency: "USD",
            destinationCurrency: "EUR",
            timeZone: "Europe/Paris",
            startDate: "",
            endDate: "",
            qrNote: "https://example.test/itinerary",
            checklist: [
              { id: "passport", text: "Passport", done: true }
            ],
            itinerary: [
              {
                id: "flight-paris",
                title: "Flight to Paris",
                dateTime: "2026-12-10T09:30",
                location: "Charles de Gaulle",
                notes: "Terminal 2E"
              }
            ],
            budget: {
              limit: 1500,
              currency: "EUR",
              expenses: [
                { id: "hotel-paris", title: "Hotel", amount: 500, category: "lodging" }
              ]
            }
          },
          {
            id: "trip-tokyo",
            name: "Tokyo stop",
            destination: "Tokyo, Japan",
            homeCurrency: "USD",
            destinationCurrency: "JPY",
            timeZone: "Asia/Tokyo",
            startDate: "",
            endDate: "",
            qrNote: "",
            checklist: [],
            itinerary: [],
            budget: { limit: 0, currency: "JPY", expenses: [] }
          }
        ]
      }));
      localStorage.setItem("handy-timer-duration", JSON.stringify({ minutes: 0, seconds: 0 }));
      localStorage.setItem("handy-calculator-history", JSON.stringify(["private calculation"]));
      localStorage.setItem("handy-qr-settings", JSON.stringify({ text: "private QR text" }));
    }, backupRates);
    await page.locator(".backup-settings summary").scrollIntoViewIfNeeded();
    await page.locator(".backup-settings summary").click();
    const downloadPromise = page.waitForEvent("download");
    await page.locator("#exportSettingsBackup").click();
    const backupDownload = await downloadPromise;
    const backupFilePath = await backupDownload.path();
    const exportedBackup = JSON.parse(await fs.promises.readFile(backupFilePath, "utf8"));
    assert.strictEqual(exportedBackup.format, "handy-settings-backup");
    assert.strictEqual(exportedBackup.version, 1);
    assert.deepStrictEqual(exportedBackup.data["handy-favorite-tools"], ["Calculator"]);
    assert.deepStrictEqual(exportedBackup.data["handy-timer-duration"], { minutes: 0, seconds: 0 });
    assert.deepStrictEqual(exportedBackup.data["handy-travel-kit"], {
      activeId: "trip-paris",
      trips: [
        {
          id: "trip-paris",
          name: "Paris visit",
          destination: "Paris, France",
          homeCurrency: "USD",
          destinationCurrency: "EUR",
          timeZone: "Europe/Paris",
          startDate: "",
          endDate: "",
          qrNote: "https://example.test/itinerary",
          checklist: [
            { id: "passport", text: "Passport", done: true }
          ],
          itinerary: [
            {
              id: "flight-paris",
              title: "Flight to Paris",
              dateTime: "2026-12-10T09:30",
              location: "Charles de Gaulle",
              notes: "Terminal 2E"
            }
          ],
          budget: {
            limit: 1500,
            currency: "EUR",
            expenses: [
              { id: "hotel-paris", title: "Hotel", amount: 500, category: "lodging" }
            ]
          }
        },
        {
          id: "trip-tokyo",
          name: "Tokyo stop",
          destination: "Tokyo, Japan",
          homeCurrency: "USD",
          destinationCurrency: "JPY",
          timeZone: "Asia/Tokyo",
          startDate: "",
          endDate: "",
          qrNote: "",
          checklist: [],
          itinerary: [],
          budget: { limit: 0, currency: "JPY", expenses: [] }
        }
      ]
    });
    assert.strictEqual(exportedBackup.data["handy-currency-live-rates"].rates.EUR, 0.9);
    assert(!Object.hasOwn(exportedBackup.data, "handy-calculator-history"));
    assert(!Object.hasOwn(exportedBackup.data, "handy-qr-settings"));

    await page.locator("#settingsBackupFile").setInputFiles({
      name: "invalid-backup.json",
      mimeType: "application/json",
      buffer: Buffer.from("{invalid")
    });
    await page.getByText("Backup file is not valid JSON.").waitFor();
    assert.deepStrictEqual(await page.evaluate(() => JSON.parse(localStorage.getItem("handy-favorite-tools"))), ["Calculator"]);

    exportedBackup.data["handy-favorite-tools"] = ["QR Code Maker"];
    exportedBackup.data["handy-theme"] = "dark";
    exportedBackup.data["handy-currency-pair"] = { from: "EUR", to: "USD", amount: "25" };
    page.once("dialog", (dialog) => dialog.accept());
    await Promise.all([
      page.waitForNavigation({ waitUntil: "load" }),
      page.locator("#settingsBackupFile").setInputFiles({
        name: "handy-settings.json",
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify(exportedBackup))
      })
    ]);
    const restoredBackupState = await page.evaluate(() => ({
      favorites: JSON.parse(localStorage.getItem("handy-favorite-tools")),
      theme: localStorage.getItem("handy-theme"),
      currencyPair: JSON.parse(localStorage.getItem("handy-currency-pair")),
      travelKit: JSON.parse(localStorage.getItem("handy-travel-kit")),
      history: JSON.parse(localStorage.getItem("handy-calculator-history")),
      qrSettings: JSON.parse(localStorage.getItem("handy-qr-settings"))
    }));
    assert.deepStrictEqual(restoredBackupState.favorites, ["QR Code Maker"]);
    assert.strictEqual(restoredBackupState.theme, "dark");
    assert.deepStrictEqual(restoredBackupState.currencyPair, { from: "EUR", to: "USD", amount: "25" });
    assert.deepStrictEqual(restoredBackupState.travelKit, {
      activeId: "trip-paris",
      trips: [
        {
          id: "trip-paris",
          name: "Paris visit",
          destination: "Paris, France",
          homeCurrency: "USD",
          destinationCurrency: "EUR",
          timeZone: "Europe/Paris",
          startDate: "",
          endDate: "",
          qrNote: "https://example.test/itinerary",
          checklist: [
            { id: "passport", text: "Passport", done: true }
          ],
          itinerary: [
            {
              id: "flight-paris",
              title: "Flight to Paris",
              dateTime: "2026-12-10T09:30",
              location: "Charles de Gaulle",
              notes: "Terminal 2E"
            }
          ],
          budget: {
            limit: 1500,
            currency: "EUR",
            expenses: [
              { id: "hotel-paris", title: "Hotel", amount: 500, category: "lodging" }
            ]
          }
        },
        {
          id: "trip-tokyo",
          name: "Tokyo stop",
          destination: "Tokyo, Japan",
          homeCurrency: "USD",
          destinationCurrency: "JPY",
          timeZone: "Asia/Tokyo",
          startDate: "",
          endDate: "",
          qrNote: "",
          checklist: [],
          itinerary: [],
          budget: { limit: 0, currency: "JPY", expenses: [] }
        }
      ]
    });
    assert.deepStrictEqual(restoredBackupState.history, ["private calculation"]);
    assert.deepStrictEqual(restoredBackupState.qrSettings, { text: "private QR text" });
    await page.locator("#toolGrid").getByRole("button", { name: "Open Timer and Stopwatch" }).click();
    assert.strictEqual(await page.locator("#timerMinutes").inputValue(), "0");
    assert.strictEqual(await page.locator("#timerSeconds").inputValue(), "0");

    console.log("All browser checks passed, including service-worker updates, offline scanning, and settings backup.");
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }

  assert.strictEqual(
    browserErrors.length,
    0,
    `Unexpected browser console or page errors:\n${browserErrors.join("\n")}`
  );
}

run().catch((error) => {
  console.error(error);
  server.close();
  process.exit(1);
});
