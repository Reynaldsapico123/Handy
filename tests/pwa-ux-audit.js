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
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      serviceWorkers: "block"
    });
    const page = await context.newPage();
    await page.addInitScript(() => {
      localStorage.setItem("handy-welcome-dismissed", "true");
      sessionStorage.removeItem("handy-update-dismissed");

      Object.defineProperty(navigator, "serviceWorker", {
        configurable: true,
        value: {
          controller: {},
          register: async () => ({
            waiting: {
              postMessage(message) {
                window.pwaWaitingMessage = message;
              }
            },
            active: {},
            installing: null,
            addEventListener() {}
          }),
          getRegistration: async () => ({
            active: {},
            waiting: null
          }),
          addEventListener() {}
        }
      });
    });

    const baseUrl = `http://127.0.0.1:${server.address().port}/`;
    await page.goto(baseUrl, { waitUntil: "networkidle" });

    const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.webmanifest"), "utf8"));
    assert.strictEqual(manifest.display, "standalone");
    assert.strictEqual(manifest.start_url, "/");
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

    await page.click("#installApp");
    assert.match(await page.locator("#installAppInstructions").textContent(), /browser menu|Add to Home Screen/);

    await page.evaluate(() => {
      const event = new Event("beforeinstallprompt");
      event.preventDefault = () => {};
      event.prompt = async () => {
        window.pwaPromptCalled = true;
      };
      event.userChoice = Promise.resolve({ outcome: "dismissed" });
      window.dispatchEvent(event);
    });
    await page.click("#installApp");
    await page.waitForFunction(() => window.pwaPromptCalled === true);
    assert.match(await page.locator("#installAppInstructions").textContent(), /browser menu|Add to Home Screen/);

    await page.evaluate(() => {
      const event = new Event("beforeinstallprompt");
      event.preventDefault = () => {};
      event.prompt = async () => {
        window.pwaAcceptedPromptCalled = true;
      };
      event.userChoice = Promise.resolve({ outcome: "accepted" });
      window.dispatchEvent(event);
    });
    await page.click("#installApp");
    await page.waitForFunction(() => window.pwaAcceptedPromptCalled === true);
    await page.evaluate(() => window.dispatchEvent(new Event("appinstalled")));
    await page.waitForFunction(() =>
      document.querySelector("#installAppContainer").hidden
    );

    await page.waitForSelector("#updateNotice:not([hidden])");
    await page.click("#updateLater");
    assert(await page.locator("#updateNotice").evaluate((notice) => notice.hidden));
    assert.strictEqual(
      await page.evaluate(() => sessionStorage.getItem("handy-update-dismissed")),
      "true"
    );

    await page.evaluate(() => {
      sessionStorage.removeItem("handy-update-dismissed");
      document.querySelector("#updateNotice").hidden = false;
    });
    await page.click("#updateNow");
    await page.waitForFunction(() => window.pwaWaitingMessage === "SKIP_WAITING");
    assert(await page.locator("#updateNow").isDisabled());
    assert(await page.locator("#updateLater").isDisabled());

    await page.evaluate(() => {
      const originalMatchMedia = window.matchMedia.bind(window);
      window.matchMedia = (query) =>
        query === "(display-mode: standalone)"
          ? { matches: true, media: query, onchange: null }
          : originalMatchMedia(query);
      Object.defineProperty(navigator, "standalone", {
        configurable: true,
        value: true
      });
      document.querySelector("#privacyPanel").open = true;
    });
    await page.click("#refreshDiagnostics");
    await page.waitForFunction(() =>
      document.querySelector("#diagnosticsStatus").textContent === "Diagnostics refreshed."
    );
    assert.strictEqual(await page.locator("#diagnosticMode").textContent(), "Installed PWA");

    console.log("PWA UX audit passed: manifest, icons, install choices, standalone mode, and update controls.");
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
