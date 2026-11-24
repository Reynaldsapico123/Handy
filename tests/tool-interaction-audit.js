const assert = require("assert");
const { chromium } = require("playwright");

const maximumToolOpenMs = 2000;

async function run() {
  const deploymentUrl = process.env.HANDY_DEPLOYMENT_URL;
  if (!deploymentUrl) {
    throw new Error("HANDY_DEPLOYMENT_URL must identify the deployed preview to audit.");
  }
  const parsedUrl = new URL(deploymentUrl);
  if (parsedUrl.protocol !== "https:") {
    throw new Error("The mobile interaction audit requires an HTTPS URL.");
  }

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"]
  });
  try {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 1,
      isMobile: true,
      hasTouch: true,
      serviceWorkers: "block"
    });
    try {
      const page = await context.newPage();
      const pageErrors = [];
      page.on("pageerror", (error) => pageErrors.push(error.message));
      await page.addInitScript(() => {
        localStorage.setItem("handy-welcome-dismissed", "true");
        sessionStorage.setItem("handy-update-dismissed", "true");
      });
      await page.route("https://open.er-api.com/v6/latest/USD", (route) =>
        route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({
            result: "success",
            time_last_update_utc: "2026-11-24T00:00:00Z",
            rates: {
              USD: 1, EUR: 0.75, GBP: 0.8, JPY: 150, AUD: 1.5, CAD: 1.3,
              CHF: 0.9, CNY: 7, INR: 80, SGD: 1.3, AED: 3.6, NZD: 1.6
            }
          })
        })
      );

      const cdp = await context.newCDPSession(page);
      await cdp.send("Network.enable");
      await cdp.send("Network.emulateNetworkConditions", {
        offline: false,
        latency: 150,
        downloadThroughput: 200 * 1024,
        uploadThroughput: 96 * 1024,
        connectionType: "cellular3g"
      });
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });

      const baseUrl = new URL("/", parsedUrl);
      await page.goto(baseUrl.href, { waitUntil: "networkidle" });
      await page.waitForFunction(() =>
        typeof window.handyFetchToolFragment === "function" &&
        document.querySelector("#qrScanShortcut")
      );

      const tools = [
        {
          name: "Calculator",
          selector: '#toolGrid button[aria-label="Open Calculator"]',
          modal: "#calculatorModal",
          readiness: "calculator"
        },
        {
          name: "Currency",
          selector: '#toolGrid button[aria-label="Open Currency Exchange"]',
          modal: "#currencyModal",
          readiness: "currency"
        },
        {
          name: "QR scanner",
          selector: "#qrScanShortcut",
          modal: "#qrModal",
          readiness: "qr"
        }
      ];

      for (const [index, tool] of tools.entries()) {
        const marker = `handy-tool-open-${index}`;
        await page.evaluate(({ selector, markerName }) => {
          const button = document.querySelector(selector);
          if (!button) throw new Error(`Could not find the ${selector} tool button.`);
          button.addEventListener("pointerdown", () => performance.mark(markerName), { once: true });
        }, { selector: tool.selector, markerName: marker });
        await page.locator(tool.selector).tap();
        await page.waitForFunction((readiness) => {
          const visible = (selector) => {
            const element = document.querySelector(selector);
            return element && !element.hidden;
          };
          if (readiness === "calculator") {
            return visible("#calculatorModal") && Boolean(document.querySelector("#calculatorGrid [data-value='1']"));
          }
          if (readiness === "currency") {
            return visible("#currencyModal")
              && document.querySelectorAll("#currencyFrom option").length >= 12
              && document.querySelector("#currencyResult").textContent.trim() !== "—";
          }
          return visible("#qrModal")
            && visible("#qrScanner")
            && typeof window.jsQR === "function"
            && typeof window.qrcode === "function";
        }, tool.readiness, { polling: "raf" });

        const interactionMs = await page.evaluate((markerName) => {
          const marker = performance.getEntriesByName(markerName).at(-1);
          if (!marker) throw new Error(`The ${markerName} interaction was not recorded.`);
          return performance.now() - marker.startTime;
        }, marker);
        console.log(`${tool.name} mobile tap-to-ready: ${Math.round(interactionMs)}ms.`);
        assert(
          interactionMs <= maximumToolOpenMs,
          `${tool.name} took ${Math.round(interactionMs)}ms to become ready after a tap; budget is ${maximumToolOpenMs}ms.`
        );

        await page.keyboard.press("Escape");
        await page.locator(tool.modal).waitFor({ state: "hidden" });
      }

      assert.deepStrictEqual(pageErrors, [], "The mobile interaction audit encountered uncaught page errors.");
    } finally {
      await context.close();
    }
  } finally {
    await browser.close();
  }

  console.log("Mobile tool interaction budgets passed.");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
