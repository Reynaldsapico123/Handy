const fs = require("fs");
const http = require("http");
const path = require("path");
const assert = require("assert");
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

async function run() {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ serviceWorkers: "block" });
    const page = await context.newPage();
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await page.route("https://open.er-api.com/v6/latest/USD", (route) =>
      route.fulfill({
        status: 429,
        contentType: "application/json",
        body: JSON.stringify({ result: "error", error: "rate limit" })
      })
    );

    await page.addInitScript(() => {
      localStorage.setItem("handy-welcome-dismissed", "true");
      localStorage.setItem("handy-favorite-tools", "{broken");
      localStorage.setItem("handy-recent-tools", "{broken");
      localStorage.setItem("handy-tool-layout", "{broken");
      localStorage.setItem("handy-tool-usage", "{broken");
      localStorage.setItem("handy-currency-pair", "{broken");
      localStorage.setItem("handy-travel-kit", "{broken");
    });

    const localOrigin = `http://127.0.0.1:${server.address().port}`;
    await page.goto(`${localOrigin}/`, { waitUntil: "networkidle" });
    assert.strictEqual(await page.locator(".tool-card").count(), 6);
    assert.deepStrictEqual(pageErrors, [], "Malformed preferences caused uncaught page errors.");

    await page.getByRole("button", { name: "Open Currency Exchange" }).click();
    await page.waitForSelector("#currencyModal:not([hidden])");
    await page.waitForFunction(() =>
      document.querySelector("#currencyStatus").textContent.includes("Live rates unavailable")
    );
    assert.strictEqual(await page.locator("#currencyFrom").inputValue(), "USD");
    assert.strictEqual(await page.locator("#currencyTo").inputValue(), "EUR");
    await page.keyboard.press("Escape");

    await page.evaluate(() => {
      document.querySelector("#privacyPanel").open = true;
    });
    await page.locator(".backup-settings summary").click();

    await page.locator("#settingsBackupFile").setInputFiles({
      name: "oversized.json",
      mimeType: "application/json",
      buffer: Buffer.alloc(1024 * 1024 + 1, " ")
    });
    await page.getByText("Backup file is too large.").waitFor();

    await page.locator("#settingsBackupFile").setInputFiles({
      name: "unsupported.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify({
        format: "other-format",
        version: 1,
        exportedAt: new Date().toISOString(),
        data: {}
      }))
    });
    await page.getByText("This is not a supported Handy backup.").waitFor();

    await page.evaluate(() => {
      localStorage.setItem("handy-favorite-tools", JSON.stringify(["Calculator"]));
      const originalSetItem = Storage.prototype.setItem;
      window.resilienceOriginalSetItem = originalSetItem;
      let favoriteFailurePending = true;
      Storage.prototype.setItem = function (key, value) {
        if (key === "handy-favorite-tools" && favoriteFailurePending) {
          favoriteFailurePending = false;
          throw new DOMException("Simulated storage failure", "QuotaExceededError");
        }
        return originalSetItem.call(this, key, value);
      };
    });

    const rollbackBackup = {
      format: "handy-settings-backup",
      version: 1,
      exportedAt: new Date().toISOString(),
      data: {
        "handy-favorite-tools": ["QR Code Maker"]
      }
    };
    page.once("dialog", (dialog) => dialog.accept());
    await page.locator("#settingsBackupFile").setInputFiles({
      name: "restore-failure.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(rollbackBackup))
    });
    await page.locator("#backupPreview").waitFor({ state: "visible" });
    await page.locator("#confirmBackupRestore").click();
    await page.getByText("Simulated storage failure").waitFor();
    await page.evaluate(() => {
      Storage.prototype.setItem = window.resilienceOriginalSetItem;
    });
    assert.deepStrictEqual(
      await page.evaluate(() => JSON.parse(localStorage.getItem("handy-favorite-tools"))),
      ["Calculator"]
    );

    console.log("Resilience audit passed: malformed storage falls back safely, failed currency calls remain usable, and invalid or failed restores preserve settings.");
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
