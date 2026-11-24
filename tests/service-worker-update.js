const http = require("http");
const fs = require("fs");
const path = require("path");
const assert = require("assert");

const root = path.resolve(__dirname, "..");
const mimeTypes = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "text/javascript",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml"
};

async function runServiceWorkerUpdateTest(browserType, browserName) {
  let releaseFixture = null;
  const server = http.createServer((request, response) => {
    const requestUrl = new URL(request.url, "http://127.0.0.1");
    const requestPath = requestUrl.pathname;
    const pagePath = requestPath === "/" ? "/index.html" : requestPath;
    const requestedPath = path.extname(pagePath) ? pagePath : `${pagePath}.html`;
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
      if (releaseFixture?.failAsset === `${requestPath}${requestUrl.search}`) {
        response.writeHead(503);
        response.end("Simulated unavailable release asset.");
        return;
      }

      let responseBody = data;
      if (releaseFixture && requestPath === "/") {
        responseBody = data.toString("utf8").replace(
          /(<meta name="handy-build" content=")[^"]+(")/,
          `$1${releaseFixture.buildId}$2`
        );
      } else if (releaseFixture && requestPath === "/sw.js") {
        responseBody = data.toString("utf8").replace(
          /const CACHE_NAME = "handy-v\d+";/,
          `const CACHE_NAME = "${releaseFixture.cacheName}";`
        );
      }
      const cacheControl = requestPath === "/sw.js"
        ? "no-cache"
        : path.extname(filePath) === ".html"
          ? "public, max-age=0, must-revalidate"
          : null;
      response.writeHead(200, {
        "Content-Type": mimeTypes[path.extname(filePath)] || "application/octet-stream",
        ...(cacheControl ? { "Cache-Control": cacheControl } : {})
      });
      response.end(responseBody);
    });
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    await new Promise((resolve) => server.close(resolve));
    throw new Error("Could not start the service-worker test server.");
  }
  const baseUrl = `http://127.0.0.1:${address.port}/`;
  let browser;

  try {
    browser = await browserType.launch({ headless: true });
    const context = await browser.newContext({ serviceWorkers: "allow" });
    try {
      const page = await context.newPage();
      await page.addInitScript(() => {
        localStorage.setItem("handy-welcome-dismissed", "true");
      });
      await page.goto(baseUrl, { waitUntil: "networkidle" });
      await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
      await page.reload({ waitUntil: "networkidle" });

      const currentCacheName = fs.readFileSync(path.join(root, "sw.js"), "utf8")
        .match(/const CACHE_NAME = "(handy-v\d+)";/)?.[1];
      assert(currentCacheName, "The service worker should declare its cache version.");
      const cachePrefix = currentCacheName.replace(/\d+$/, "");
      const cacheVersion = Number(currentCacheName.match(/\d+$/)[0]);
      const nextCacheName = `${cachePrefix}${cacheVersion + 1}`;
      const failedCacheName = `${cachePrefix}${cacheVersion + 2}`;

      await page.waitForFunction(async (cacheName) =>
        (await caches.keys()).includes(cacheName), currentCacheName
      );
      releaseFixture = { buildId: "release-v2", cacheName: nextCacheName };
      await page.evaluate(async () => {
        const registration = await navigator.serviceWorker.getRegistration();
        if (!registration) throw new Error("The app service worker was not registered.");
        await registration.update();
      });
      await page.waitForSelector("#updateNotice:not([hidden])");
      await page.click("#updateNow");
      await page.waitForFunction(() =>
        document.querySelector('meta[name="handy-build"]')?.content === "release-v2"
      );
      await page.waitForFunction(async ({ currentCacheName, nextCacheName }) => {
        const cacheNames = await caches.keys();
        return cacheNames.includes(nextCacheName) && !cacheNames.includes(currentCacheName);
      }, { currentCacheName, nextCacheName });
      const updatedCacheAssets = await page.evaluate(async (cacheName) => {
        const cache = await caches.open(cacheName);
        return (await cache.keys()).map((request) =>
          new URL(request.url).pathname + new URL(request.url).search
        );
      }, nextCacheName);
      assert(
        updatedCacheAssets.includes("/calculator.js?v=release-v2"),
        "The new release should cache its versioned tool script."
      );

      await context.setOffline(true);
      await page.reload({ waitUntil: "domcontentloaded" });
      const offlineState = await page.evaluate(async (cacheName) => {
        const cache = await caches.open(cacheName);
        const shell = await cache.match("/");
        const shellHtml = shell ? await shell.text() : null;
        return {
          buildId: document.querySelector('meta[name="handy-build"]')?.content,
          controlled: navigator.serviceWorker.controller !== null,
          shellBuildId: shellHtml?.match(/<meta name="handy-build" content="([^"]+)"/)?.[1] || null
        };
      }, nextCacheName);
      assert.strictEqual(offlineState.buildId, "release-v2", JSON.stringify(offlineState));
      assert.strictEqual(offlineState.shellBuildId, "release-v2");
      await page.locator("#toolGrid").getByRole("button", { name: "Open Calculator" }).click();
      await page.waitForSelector("#calculatorModal:not([hidden])");
      await page.keyboard.press("Escape");

      await context.setOffline(false);
      releaseFixture = {
        buildId: "release-v3",
        cacheName: failedCacheName,
        failAsset: "/calculator.js?v=release-v3"
      };
      const failedWorkerState = await page.evaluate(async () => {
        const registration = await navigator.serviceWorker.getRegistration();
        if (!registration) throw new Error("The app service worker was not registered.");
        const installResult = new Promise((resolve, reject) => {
          registration.addEventListener("updatefound", () => {
            const worker = registration.installing;
            if (!worker) {
              reject(new Error("The updated service worker was not found."));
              return;
            }
            const checkState = () => {
              if (worker.state === "redundant") resolve(worker.state);
            };
            worker.addEventListener("statechange", checkState);
            checkState();
          }, { once: true });
        });
        await registration.update();
        return installResult;
      });
      assert.strictEqual(failedWorkerState, "redundant");
      const failedUpdateState = await page.evaluate(async () => ({
        buildId: document.querySelector('meta[name="handy-build"]')?.content,
        controlled: navigator.serviceWorker.controller !== null,
        cacheNames: await caches.keys()
      }));
      assert.strictEqual(failedUpdateState.buildId, "release-v2", JSON.stringify(failedUpdateState));
      assert.strictEqual(failedUpdateState.controlled, true);
      assert(failedUpdateState.cacheNames.includes(nextCacheName));
      assert(
        !failedUpdateState.cacheNames.includes(failedCacheName),
        "A failed install must remove its partial cache."
      );

      await context.setOffline(true);
      await page.reload({ waitUntil: "domcontentloaded" });
      const failedOfflineState = await page.evaluate(async (cacheName) => {
        const cache = await caches.open(cacheName);
        const shell = await cache.match("/");
        const shellHtml = shell ? await shell.text() : null;
        return {
          buildId: document.querySelector('meta[name="handy-build"]')?.content,
          controlled: navigator.serviceWorker.controller !== null,
          shellBuildId: shellHtml?.match(/<meta name="handy-build" content="([^"]+)"/)?.[1] || null
        };
      }, nextCacheName);
      assert.strictEqual(failedOfflineState.buildId, "release-v2", JSON.stringify(failedOfflineState));
      assert.strictEqual(failedOfflineState.shellBuildId, "release-v2");
      await page.locator("#toolGrid").getByRole("button", { name: "Open Calculator" }).click();
      await page.waitForSelector("#calculatorModal:not([hidden])");
      await page.keyboard.press("Escape");

      await context.setOffline(false);
      releaseFixture.failAsset = null;
      await page.evaluate(async () => {
        const registration = await navigator.serviceWorker.getRegistration();
        if (!registration) throw new Error("The app service worker was not registered.");
        await registration.update();
      });
      await page.waitForSelector("#updateNotice:not([hidden])");
      await page.click("#updateNow");
      await page.waitForFunction(() =>
        document.querySelector('meta[name="handy-build"]')?.content === "release-v3"
      );
      await page.waitForFunction(async ({ nextCacheName, failedCacheName }) => {
        const cacheNames = await caches.keys();
        return cacheNames.includes(failedCacheName) && !cacheNames.includes(nextCacheName);
      }, { nextCacheName, failedCacheName });

      await context.setOffline(true);
      await page.reload({ waitUntil: "domcontentloaded" });
      const recoveredOfflineState = await page.evaluate(async (cacheName) => {
        const cache = await caches.open(cacheName);
        const shell = await cache.match("/");
        const shellHtml = shell ? await shell.text() : null;
        return {
          buildId: document.querySelector('meta[name="handy-build"]')?.content,
          shellBuildId: shellHtml?.match(/<meta name="handy-build" content="([^"]+)"/)?.[1] || null
        };
      }, failedCacheName);
      assert.strictEqual(recoveredOfflineState.buildId, "release-v3");
      assert.strictEqual(recoveredOfflineState.shellBuildId, "release-v3");
      await page.locator("#toolGrid").getByRole("button", { name: "Open Calculator" }).click();
      await page.waitForSelector("#calculatorModal:not([hidden])");
    } finally {
      await context.close();
    }
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }

  console.log(`${browserName} service-worker update and offline smoke passed.`);
}

module.exports = { runServiceWorkerUpdateTest };
