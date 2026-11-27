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
    const thirdPartyRequests = [];
    const localOrigin = `http://127.0.0.1:${server.address().port}`;

    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.protocol.startsWith("http") && url.origin !== localOrigin
        && url.origin !== "https://open.er-api.com") {
        thirdPartyRequests.push(url.href);
      }
    });

    await page.addInitScript(() => {
      if (!sessionStorage.getItem("privacy-audit-seeded")) {
        sessionStorage.setItem("privacy-audit-seeded", "true");
        localStorage.setItem("handy-welcome-dismissed", "true");
        localStorage.setItem("handy-theme", "dark");
        localStorage.setItem("handy-calculator-history", JSON.stringify([
          { expression: "private calculation", result: "42" }
        ]));
        localStorage.setItem("handy-qr-settings", JSON.stringify({
          text: "private QR text"
        }));
        localStorage.setItem("handy-qr-scan-history", JSON.stringify([
          { value: "private scanned QR content", scannedAt: Date.now() }
        ]));
        sessionStorage.setItem("handy-last-qr-result", "private session QR result");
        localStorage.setItem("unrelated-app-setting", "keep");
      }
    });

    await page.goto(`${localOrigin}/`, { waitUntil: "networkidle" });
    assert.deepStrictEqual(await context.cookies(), [], "Handy should not set cookies.");
    assert.deepStrictEqual(thirdPartyRequests, [], "Handy made third-party requests.");

    await page.locator(".privacy-panel summary").click();
    await page.waitForFunction(() => document.querySelector("#privacyPanel").open);

    page.once("dialog", (dialog) => dialog.accept());
    await page.click("#clearLocalData");
    await page.waitForFunction(() =>
      document.querySelector("#privacyStatus").textContent.includes("Reloading")
    );
    await page.waitForTimeout(600);

    const clearedStorage = await page.evaluate(() => ({
      calculatorHistory: localStorage.getItem("handy-calculator-history"),
      qrSettings: localStorage.getItem("handy-qr-settings"),
      qrScanHistory: localStorage.getItem("handy-qr-scan-history"),
      lastQrResult: sessionStorage.getItem("handy-last-qr-result"),
      theme: localStorage.getItem("handy-theme"),
      unrelated: localStorage.getItem("unrelated-app-setting")
    }));
    assert.strictEqual(clearedStorage.calculatorHistory, null);
    assert.strictEqual(clearedStorage.qrSettings, null);
    assert.strictEqual(clearedStorage.qrScanHistory, null);
    assert.strictEqual(clearedStorage.lastQrResult, null);
    assert.strictEqual(clearedStorage.theme, null);
    assert.strictEqual(clearedStorage.unrelated, "keep");

    await page.evaluate(() => {
      localStorage.setItem("handy-theme", "dark");
      localStorage.setItem("handy-favorite-tools", JSON.stringify(["QR Code Maker"]));
      localStorage.setItem("handy-calculator-history", JSON.stringify([
        { expression: "private calculation", result: "42" }
      ]));
      localStorage.setItem("handy-qr-settings", JSON.stringify({
        text: "private QR text"
      }));
      localStorage.setItem("handy-qr-scan-history", JSON.stringify([
        { value: "private scanned QR content", scannedAt: Date.now() }
      ]));
    });

    const downloadPromise = page.waitForEvent("download");
    await page.locator(".backup-settings summary").click();
    await page.click("#exportSettingsBackup");
    const download = await downloadPromise;
    const backupPath = await download.path();
    const backup = JSON.parse(await fs.promises.readFile(backupPath, "utf8"));
    assert.strictEqual(backup.format, "handy-settings-backup");
    assert.strictEqual(backup.version, 1);
    assert(!Object.prototype.hasOwnProperty.call(backup.data, "handy-calculator-history"));
    assert(!Object.prototype.hasOwnProperty.call(backup.data, "handy-qr-settings"));
    assert(!Object.prototype.hasOwnProperty.call(backup.data, "handy-qr-scan-history"));
    assert.deepStrictEqual(backup.data["handy-favorite-tools"], ["QR Code Maker"]);

    console.log("Privacy audit passed: no third-party requests or cookies; sensitive local data is excluded from backups and cleared safely.");
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
