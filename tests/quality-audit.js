const fs = require("fs");
const http = require("http");
const path = require("path");
const { chromium } = require("playwright");

const root = path.resolve(__dirname, "..", "dist");
const mimeTypes = {
  ".css": "text/css",
  ".html": "text/html",
  ".js": "text/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json"
};
const accessibilityTargets = [
  { name: "Calculator", trigger: '#toolGrid button[aria-label="Open Calculator"]', modal: "#calculatorModal" },
  { name: "Unit Converter", trigger: '#toolGrid button[aria-label="Open Unit Converter"]', modal: "#unitConverterModal" },
  { name: "World Clock", trigger: '#toolGrid button[aria-label="Open World Clock"]', modal: "#worldClockModal" },
  { name: "Currency", trigger: '#toolGrid button[aria-label="Open Currency Exchange"]', modal: "#currencyModal" },
  { name: "Timer", trigger: '#toolGrid button[aria-label="Open Timer and Stopwatch"]', modal: "#timerModal" },
  { name: "QR Code Maker", trigger: '#toolGrid button[aria-label="Open QR Code Maker"]', modal: "#qrModal" },
  { name: "QR Scanner", trigger: "#qrScanShortcut", modal: "#qrModal" },
  { name: "Helpful guides", trigger: ".learn-link", modal: "#guidesModal" }
];
const server = http.createServer((request, response) => {
  const pathname = new URL(request.url, "http://127.0.0.1").pathname;
  const requestedPath = pathname === "/" ? "/index.html" : decodeURIComponent(pathname);
  const filePath = path.resolve(root, `.${requestedPath}`);
  if (!filePath.startsWith(`${root}${path.sep}`)) {
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
    response.writeHead(200, {
      "Content-Type": mimeTypes[path.extname(filePath)] || "application/octet-stream"
    });
    response.end(data);
  });
});

async function getAccessibilityViolations(page, scopeSelector) {
  return page.evaluate(async (selector) => {
    const scope = selector ? document.querySelector(selector) : document;
    if (!scope) throw new Error(`Accessibility audit scope not found: ${selector}`);
    const results = await window.axe.run(scope, {
      runOnly: {
        type: "tag",
        values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"]
      }
    });
    return results.violations.map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      help: violation.help,
      nodes: violation.nodes.map((node) => ({
        target: node.target,
        summary: node.failureSummary
      }))
    }));
  }, scopeSelector);
}

async function assertAccessible(page, label, scopeSelector) {
  const violations = await getAccessibilityViolations(page, scopeSelector);
  const blockingViolations = violations.filter((violation) =>
    ["critical", "serious"].includes(violation.impact)
  );
  const advisoryViolations = violations.filter((violation) =>
    !["critical", "serious"].includes(violation.impact)
  );

  if (advisoryViolations.length) {
    console.warn(`${label} accessibility advisories:\n${JSON.stringify(advisoryViolations, null, 2)}`);
  }
  if (blockingViolations.length) {
    throw new Error(`Found ${blockingViolations.length} serious or critical accessibility violation(s) in ${label}:\n${JSON.stringify(blockingViolations, null, 2)}`);
  }
  console.log(`Accessibility passed (${label}): no serious or critical violations.`);
}

async function run() {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ serviceWorkers: "block" });
    const page = await context.newPage();
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

    const startedAt = Date.now();
    await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: "load" });
    const performanceMetrics = await page.evaluate(() => {
      const navigation = performance.getEntriesByType("navigation")[0];
      const assets = performance.getEntriesByType("resource")
        .filter((entry) => /\.(?:css|js)$/.test(new URL(entry.name).pathname));
      return {
        loadTimeMs: Math.round(navigation.loadEventEnd),
        assetBytes: assets.reduce((total, asset) => total + asset.decodedBodySize, 0)
      };
    });
    performanceMetrics.loadTimeMs = Math.max(performanceMetrics.loadTimeMs, Date.now() - startedAt);

    const maxLoadTimeMs = 5000;
    const maxAssetBytes = 250 * 1024;
    if (performanceMetrics.loadTimeMs > maxLoadTimeMs) {
      throw new Error(`Page load took ${performanceMetrics.loadTimeMs}ms; budget is ${maxLoadTimeMs}ms.`);
    }
    if (performanceMetrics.assetBytes > maxAssetBytes) {
      throw new Error(`Initial JS/CSS payload was ${performanceMetrics.assetBytes} bytes; budget is ${maxAssetBytes} bytes.`);
    }
    console.log(
      `Performance passed: load=${performanceMetrics.loadTimeMs}ms, JS/CSS=${performanceMetrics.assetBytes} bytes.`
    );

    await page.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
    const viewports = [
      { name: "desktop", width: 1280, height: 900 },
      { name: "mobile", width: 390, height: 844 }
    ];
    const themes = ["light", "dark"];

    for (const viewport of viewports) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      for (const theme of themes) {
        const currentlyDark = await page.evaluate(() => document.body.classList.contains("dark"));
        if (currentlyDark !== (theme === "dark")) {
          await page.click("#themeToggle");
          await page.waitForTimeout(200);
        }
        await assertAccessible(page, `${viewport.name}, ${theme} homepage`);
      }

      if (viewport.name === "mobile") {
        const mobileMetrics = await page.evaluate(() => {
          const targets = [...document.querySelectorAll(
            "#menuToggle, #themeToggle, #installApp, #qrScanShortcut, .mobile-bottom-nav a"
          )]
            .filter((element) => element.getClientRects().length > 0)
            .map((element) => {
              const rect = element.getBoundingClientRect();
              return {
                name: element.getAttribute("aria-label") || element.textContent.trim() || element.id,
                width: Math.round(rect.width),
                height: Math.round(rect.height)
              };
            });
          return {
            scrollWidth: document.documentElement.scrollWidth,
            clientWidth: document.documentElement.clientWidth,
            targets
          };
        });
        if (mobileMetrics.scrollWidth > mobileMetrics.clientWidth) {
          throw new Error(`Mobile layout overflows horizontally: ${mobileMetrics.scrollWidth}px wide in a ${mobileMetrics.clientWidth}px viewport.`);
        }
        const undersizedTargets = mobileMetrics.targets.filter((target) =>
          target.width < 44 || target.height < 44
        );
        if (undersizedTargets.length) {
          throw new Error(`Mobile touch targets must be at least 44x44px:\n${JSON.stringify(undersizedTargets, null, 2)}`);
        }
        console.log(`Mobile layout passed: no horizontal overflow; ${mobileMetrics.targets.length} key touch targets are at least 44x44px.`);
      }
    }

    for (const viewport of viewports) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      for (const theme of themes) {
        const currentlyDark = await page.evaluate(() => document.body.classList.contains("dark"));
        if (currentlyDark !== (theme === "dark")) {
          await page.click("#themeToggle");
          await page.waitForTimeout(200);
        }

        for (const target of accessibilityTargets) {
          await page.locator(target.trigger).click();
          const modal = page.locator(target.modal);
          await modal.waitFor({ state: "visible" });
          await modal.evaluate(async (dialog) => {
            const panel = dialog.querySelector(":scope > section");
            if (panel) await Promise.all(panel.getAnimations().map((animation) => animation.finished));
          });
          await assertAccessible(page, `${viewport.name}, ${theme}, ${target.name} dialog`, target.modal);
          await page.keyboard.press("Escape");
          await modal.waitFor({ state: "hidden" });
        }
      }
    }
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
