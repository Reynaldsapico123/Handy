const fs = require("fs");
const http = require("http");
const path = require("path");
const { chromium } = require("playwright");
const { PNG } = require("pngjs");
const pixelmatchModule = require("pixelmatch");
const pixelmatch = pixelmatchModule.default || pixelmatchModule;

const root = path.resolve(__dirname, "..", "dist");
const baselineDir = path.join(__dirname, "visual-baselines");
const diffDir = path.join(__dirname, "visual-diffs");
const updateBaselines = process.argv.includes("--update");
const targetFilter = process.argv.find((argument) => argument.startsWith("--target="))?.slice(9);
const maxDiffRatio = 0.08;

const mimeTypes = {
  ".css": "text/css",
  ".html": "text/html",
  ".js": "text/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json"
};

const targets = [
  { name: "calculator", trigger: '#toolGrid button[aria-label="Open Calculator"]', modal: "#calculatorModal" },
  { name: "unit-converter", trigger: '#toolGrid button[aria-label="Open Unit Converter"]', modal: "#unitConverterModal" },
  { name: "world-clock", trigger: '#toolGrid button[aria-label="Open World Clock"]', modal: "#worldClockModal", maskDynamic: ".clock-time" },
  { name: "currency", trigger: '#toolGrid button[aria-label="Open Currency Exchange"]', modal: "#currencyModal" },
  { name: "timer", trigger: '#toolGrid button[aria-label="Open Timer and Stopwatch"]', modal: "#timerModal" },
  { name: "qr-maker", trigger: '#toolGrid button[aria-label="Open QR Code Maker"]', modal: "#qrModal" },
  {
    name: "qr-scanner",
    trigger: "#qrScanShortcut",
    modal: "#qrModal",
    captureSelector: ".qr-panel",
    captureSize: {
      desktop: { width: 650, height: 428 },
      mobile: { width: 390, height: 453 }
    }
  },
  { name: "guides", trigger: ".learn-link", modal: "#guidesModal" }
];

if (targetFilter && !targets.some((target) => target.name === targetFilter)) {
  throw new Error(`Unknown visual target: ${targetFilter}`);
}

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

function compareScreenshot(name, actualBuffer) {
  const baselinePath = path.join(baselineDir, `${name}.png`);
  if (updateBaselines || !fs.existsSync(baselinePath)) {
    fs.mkdirSync(baselineDir, { recursive: true });
    fs.writeFileSync(baselinePath, actualBuffer);
    console.log(`Visual baseline ${updateBaselines ? "updated" : "created"}: ${name}`);
    return;
  }

  const expected = PNG.sync.read(fs.readFileSync(baselinePath));
  const actual = PNG.sync.read(actualBuffer);
  if (expected.width !== actual.width || expected.height !== actual.height) {
    throw new Error(
      `${name} dimensions changed: baseline ${expected.width}x${expected.height}, actual ${actual.width}x${actual.height}.`
    );
  }

  const diff = new PNG({ width: actual.width, height: actual.height });
  const changedPixels = pixelmatch(
    expected.data,
    actual.data,
    diff.data,
    actual.width,
    actual.height,
    { threshold: 0.1 }
  );
  const diffRatio = changedPixels / (actual.width * actual.height);
  if (diffRatio > maxDiffRatio) {
    fs.mkdirSync(diffDir, { recursive: true });
    fs.writeFileSync(path.join(diffDir, `${name}.diff.png`), PNG.sync.write(diff));
    fs.writeFileSync(path.join(diffDir, `${name}.actual.png`), actualBuffer);
    throw new Error(
      `${name} differs visually: ${(diffRatio * 100).toFixed(2)}% pixels changed (limit ${(maxDiffRatio * 100).toFixed(1)}%).`
    );
  }
  console.log(`Visual passed: ${name} (${(diffRatio * 100).toFixed(2)}% pixels changed).`);
}

async function setTheme(page, theme) {
  const isDark = await page.evaluate(() => document.body.classList.contains("dark"));
  if (isDark !== (theme === "dark")) {
    await page.click("#themeToggle");
    await page.waitForTimeout(220);
  }
}

async function waitForPanel(page, modal) {
  await modal.evaluate(async (dialog) => {
    await Promise.all(
      dialog.getAnimations({ subtree: true }).map((animation) => animation.finished)
    );
  });
  await page.waitForTimeout(100);
}

async function capture(page, name, selector, captureSize) {
  await page.waitForTimeout(150);
  const screenshotOptions = {
    path: undefined,
    animations: "disabled",
    caret: "hide",
    fullPage: false
  };
  let buffer;
  if (selector && captureSize) {
    const locator = page.locator(selector);
    const originalStyles = await locator.evaluate((element) =>
      ["width", "height", "box-sizing"].map((property) => ({
        property,
        value: element.style.getPropertyValue(property),
        priority: element.style.getPropertyPriority(property)
      }))
    );
    await locator.evaluate((element, size) => {
      element.style.setProperty("width", `${size.width}px`, "important");
      element.style.setProperty("height", `${size.height}px`, "important");
      element.style.setProperty("box-sizing", "border-box", "important");
    }, captureSize);
    try {
      buffer = await locator.screenshot(screenshotOptions);
    } finally {
      await locator.evaluate((element, styles) => {
        styles.forEach(({ property, value, priority }) => {
          if (value) element.style.setProperty(property, value, priority);
          else element.style.removeProperty(property);
        });
      }, originalStyles);
    }
  } else {
    buffer = selector
      ? await page.locator(selector).screenshot(screenshotOptions)
      : await page.screenshot(screenshotOptions);
  }
  compareScreenshot(name, buffer);
}

async function run() {
  fs.rmSync(diffDir, { recursive: true, force: true });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ serviceWorkers: "block" });
    const page = await context.newPage();
    await page.addInitScript(() => {
      localStorage.setItem("handy-welcome-dismissed", "true");
      sessionStorage.setItem("handy-update-dismissed", "true");
      document.addEventListener("DOMContentLoaded", () => {
        const style = document.createElement("style");
        style.textContent = "* { font-family: Arial, sans-serif !important; }";
        document.head.appendChild(style);
      });
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

    const viewports = [
      { name: "desktop", width: 1280, height: 900 },
      { name: "mobile", width: 390, height: 844 }
    ];

    for (const viewport of viewports) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      for (const theme of ["light", "dark"]) {
        await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: "networkidle" });
        await setTheme(page, theme);
        if (!targetFilter) await capture(page, `homepage-${viewport.name}-${theme}`);

        for (const target of targets) {
          if (targetFilter && target.name !== targetFilter) continue;
          await page.locator(target.trigger).click();
          const modal = page.locator(target.modal);
          await modal.waitFor({ state: "visible" });
          await waitForPanel(page, modal);
          if (target.name === "qr-scanner") {
            await page.click("#qrScanTab");
            await page.waitForTimeout(150);
          }
          if (target.name === "world-clock") {
            await page.locator("#clockMeetingDate").fill("2026-11-27");
          }
          if (target.maskDynamic) {
            await page.locator(target.maskDynamic).evaluateAll((elements) =>
              elements.forEach((element) => { element.style.visibility = "hidden"; })
            );
          }
          await capture(
            page,
            `${target.name}-${viewport.name}-${theme}`,
            target.captureSelector,
            target.captureSize?.[viewport.name]
          );
          await page.keyboard.press("Escape");
          await modal.waitFor({ state: "hidden" });
        }
      }
    }
    console.log(updateBaselines
      ? "Visual baselines updated."
      : "Visual regression audit passed.");
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
