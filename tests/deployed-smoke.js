const assert = require("assert");
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

let recordedDeploymentUrl = null;
let recordedBuildId = null;
try {
  const deployment = JSON.parse(fs.readFileSync(
    path.join(__dirname, "..", "deployment.json"),
    "utf8"
  ));
  recordedDeploymentUrl = deployment.url;
  recordedBuildId = deployment.buildId;
} catch {
  recordedDeploymentUrl = null;
  recordedBuildId = null;
}

const deploymentUrl = process.env.HANDY_DEPLOYMENT_URL ||
  "https://handy-6on.pages.dev";

async function run() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    serviceWorkers: "allow"
  });
  const page = await context.newPage();
  const consoleErrors = [];
  const cspViolations = [];
  page.on("console", (message) => {
    const text = message.text();
    if (/content security policy/i.test(text)) {
      cspViolations.push(text);
    } else if (message.type() === "error") {
      consoleErrors.push(text);
    }
  });

  try {
    const response = await page.goto(deploymentUrl, { waitUntil: "networkidle" });
    assert(response, "The deployment did not return an HTTP response.");
    const policy = response.headers()["content-security-policy"];
    assert(policy, "The deployment is missing the Content Security Policy header.");
    assert.match(policy, /default-src 'self'/);
    assert.match(policy, /connect-src 'self' https:\/\/open\.er-api\.com/);
    assert.strictEqual(await page.title(), "Handy — Everyday tools for everyone");
    assert.strictEqual(await page.locator(".tool-card").count(), 6);
    const liveBuildId = await page.evaluate(() =>
      document.querySelector('meta[name="handy-build"]')?.content || "unknown"
    );
    if (recordedBuildId && liveBuildId !== recordedBuildId) {
      throw new Error(
        `Deployed build mismatch: live=${liveBuildId}, recorded=${recordedBuildId}`
      );
    }

    await page.keyboard.press("Control+K");
    await page.waitForSelector("#commandPalette:not([hidden])");
    await page.fill("#commandPaletteInput", "timer");
    assert.strictEqual(await page.locator("#commandPaletteList [role='option']").count(), 1);
    await page.keyboard.press("Enter");
    await page.waitForSelector("#timerModal:not([hidden])");
    await page.keyboard.press("Escape");

    for (const [buttonName, modalSelector] of [
      ["Open Calculator", "#calculatorModal"],
      ["Open Unit Converter", "#unitConverterModal"],
      ["Open World Clock", "#worldClockModal"],
      ["Open Currency Exchange", "#currencyModal"]
    ]) {
      await page.getByRole("button", { name: buttonName }).click();
      await page.waitForSelector(`${modalSelector}:not([hidden])`);
      if (modalSelector === "#currencyModal") {
        await page.waitForFunction(() => {
          const status = document.querySelector("#currencyStatus")?.textContent || "";
          return status && !status.startsWith("Loading") && !status.startsWith("Refreshing");
        }, null, { timeout: 12000 });
      }
      await page.keyboard.press("Escape");
      await page.locator(modalSelector).waitFor({ state: "hidden" });
    }

    await page.click(".learn-link");
    await page.waitForSelector("#guidesModal:not([hidden])");
    await page.keyboard.press("Escape");
    await page.locator("#guidesModal").waitFor({ state: "hidden" });

    await page.getByRole("button", { name: "Scan QR code" }).click();
    await page.waitForSelector("#qrModal:not([hidden])");
    await page.waitForSelector("#qrScanTab");
    const qrImage = await page.evaluate(() => {
      const code = qrcode(0, "M");
      code.addData("https://deployed-smoke.example");
      code.make();
      return code.createDataURL(8, 4);
    });
    await page.locator("#qrImageInput").setInputFiles({
      name: "deployed-smoke.png",
      mimeType: "image/png",
      buffer: Buffer.from(qrImage.split(",")[1], "base64")
    });
    await page.waitForFunction(() =>
      document.querySelector("#qrScanText").textContent === "https://deployed-smoke.example"
    );
    await page.keyboard.press("Escape");

    await page.locator("#toolCustomizer summary").click();
    assert(await page.locator("#toolCustomizerList").isVisible());
    await page.click("#resetToolLayout");

    await page.locator(".backup-settings summary").click();
    const downloadPromise = page.waitForEvent("download");
    await page.click("#exportSettingsBackup");
    const download = await downloadPromise;
    assert(download.suggestedFilename().startsWith("handy-backup-"));

    await page.locator("#privacyPanel summary").click();
    assert(await page.locator("#privacyPanel").evaluate((panel) => panel.open));
    await page.click("#refreshDiagnostics");
    await page.waitForFunction(() =>
      document.querySelector("#diagnosticsStatus").textContent === "Diagnostics refreshed."
    );
    assert.match(await page.locator("#offlineRecoveryStatus").textContent(), /Offline recovery/);
    assert.strictEqual(await page.locator("#diagnosticVersion").textContent(), "1.0.0");
    assert.match(await page.locator("#diagnosticBuild").textContent(), /^[a-f0-9]{12}$/);
    assert.strictEqual(await page.locator("#diagnosticProduction").textContent(), "https://handy-6on.pages.dev");

    await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
    await context.setOffline(true);
    const sharedUrl = await page.evaluate(() => {
      const payload = {
        v: 1,
        n: "Deployed trip",
        d: "Tokyo, Japan",
        h: "USD",
        c: "JPY",
        z: "Asia/Tokyo",
        q: "",
        cl: [1, 2],
        b: { limit: 500, currency: "USD", spent: 50 },
        i: []
      };
      const bytes = new TextEncoder().encode(JSON.stringify(payload));
      let binary = "";
      bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
      const encoded = btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
      return `${location.origin}/?trip=${encoded}`;
    });
    const tripParam = new URL(sharedUrl).search;
    await page.evaluate((search) => {
      window.history.pushState(window.history.state, "", `/${search}`);
      window.dispatchEvent(new PopStateEvent("popstate"));
    }, tripParam);
    await page.waitForSelector("#sharedTripView:not([hidden])");
    assert.strictEqual(await page.locator("#sharedTripName").textContent(), "Deployed trip");
    await context.setOffline(false);

    if (consoleErrors.length) {
      throw new Error(`Console errors: ${consoleErrors.slice(0, 5).join(" | ")}`);
    }
    if (cspViolations.length) {
      throw new Error(`Content Security Policy violations: ${cspViolations.join("\n")}`);
    }
    console.log(`Deployed smoke test passed: ${deploymentUrl}`);
  } finally {
    await browser.close();
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
