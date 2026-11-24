const assert = require("assert");
const { firefox, webkit } = require("playwright");
const { runServiceWorkerUpdateTest } = require("./service-worker-update");

const deploymentUrl = process.env.HANDY_DEPLOYMENT_URL ||
  "https://handy-6on.pages.dev";

async function verifyBrowser(name, browserType) {
  const browser = await browserType.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 }
  });
  const pageErrors = [];
  const cspViolations = [];

  try {
    const page = await context.newPage();
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("console", (message) => {
      if (/content security policy/i.test(message.text())) {
        cspViolations.push(message.text());
      }
    });
    await page.addInitScript(() => {
      localStorage.setItem("handy-welcome-dismissed", "true");
      sessionStorage.setItem("handy-update-dismissed", "true");
    });

    const response = await page.goto(deploymentUrl, { waitUntil: "networkidle" });
    assert(response?.ok(), `${name} could not load ${deploymentUrl}`);
    assert(
      await page.evaluate(() => "serviceWorker" in navigator),
      `${name} does not support service workers.`
    );
    await page.waitForFunction(
      () => navigator.serviceWorker.controller !== null,
      null,
      { timeout: 15000 }
    );
    const headers = response.headers();
    assert.match(headers["content-security-policy"] || "", /default-src 'self'/);
    assert.match(headers["permissions-policy"] || "", /camera=\(self\)/);
    assert.strictEqual(await page.title(), "Handy — Everyday tools for everyone");
    assert.strictEqual(await page.locator(".tool-card").count(), 6);

    await page.getByRole("button", { name: "Open Calculator" }).click();
    await page.waitForSelector("#calculatorModal:not([hidden])");
    await page.keyboard.press("Escape");
    await page.locator("#calculatorModal").waitFor({ state: "hidden" });

    await page.getByRole("button", { name: "Scan QR code" }).click();
    await page.waitForSelector("#qrModal:not([hidden])");
    await page.waitForSelector("#qrScanTab");
    const qrImage = await page.evaluate(() => {
      const code = qrcode(0, "M");
      code.addData("https://browser-compatibility.example");
      code.make();
      return code.createDataURL(8, 4);
    });
    await page.locator("#qrImageInput").setInputFiles({
      name: "browser-compatibility.png",
      mimeType: "image/png",
      buffer: Buffer.from(qrImage.split(",")[1], "base64")
    });
    await page.waitForFunction(
      () => document.querySelector("#qrScanText").textContent ===
        "https://browser-compatibility.example"
    );

    const supportsCamera = await page.evaluate(() =>
      Boolean(navigator.mediaDevices?.getUserMedia && typeof MediaStream === "function")
    );
    if (supportsCamera) {
      await page.evaluate(() => {
        Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
          configurable: true,
          value: async (constraints) => {
            window.compatibilityCameraRequest = constraints;
            return new MediaStream();
          }
        });
        HTMLMediaElement.prototype.play = () => Promise.resolve();
      });
    }
    await page.click("#qrCameraStart");
    if (supportsCamera) {
      await page.waitForFunction(
        () =>
          !document.querySelector("#qrCameraFrame").hidden &&
          document.querySelector("#qrScanStatus").textContent ===
            "Align the QR code inside the frame.",
        null,
        { timeout: 10000 }
      );
      assert.strictEqual(
        await page.evaluate(() => window.compatibilityCameraRequest.video.facingMode.ideal),
        "environment"
      );
      await page.click("#qrCameraStop");
      await page.waitForFunction(() => document.querySelector("#qrCameraFrame").hidden);
    } else {
      await page.waitForFunction(
        () =>
          document.querySelector("#qrScanStatus").textContent ===
          "Camera scanning requires HTTPS and a supported browser. Upload an image instead.",
        null,
        { timeout: 10000 }
      );
      assert(await page.locator("#qrCameraFrame").evaluate((frame) => frame.hidden));
    }

    assert.deepStrictEqual(pageErrors, [], `${name} reported uncaught page errors.`);
    assert.deepStrictEqual(cspViolations, [], `${name} reported CSP violations.`);
    console.log(`${name} browser compatibility smoke passed.`);
  } finally {
    await browser.close();
  }
}

async function run() {
  for (const [name, browserType] of [["Firefox", firefox], ["WebKit", webkit]]) {
    await runServiceWorkerUpdateTest(browserType, name);
    await verifyBrowser(name, browserType);
  }
  console.log(`Cross-browser smoke test passed: ${deploymentUrl}`);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
