const assert = require("assert");
const chromeLauncher = require("chrome-launcher");
const { chromium } = require("playwright");

const maximumLcpMs = 2500;
const maximumCls = 0.1;

async function run() {
  const deploymentUrl = process.env.HANDY_DEPLOYMENT_URL;
  if (!deploymentUrl) {
    throw new Error("HANDY_DEPLOYMENT_URL must identify the deployed preview to audit.");
  }
  const parsedUrl = new URL(deploymentUrl);
  if (parsedUrl.protocol !== "https:") {
    throw new Error("The Lighthouse preview audit requires an HTTPS URL.");
  }

  const lighthouseModule = await import("lighthouse");
  const lighthouse = lighthouseModule.default;
  const targets = [
    { name: "Homepage", query: {} },
    { name: "Calculator", query: { tool: "calculator" } },
    { name: "Currency", query: { tool: "currency" } },
    { name: "QR scanner", query: { tool: "qr", mode: "scan" } }
  ];
  const chrome = await chromeLauncher.launch({
    chromePath: chromium.executablePath(),
    chromeFlags: ["--headless", "--no-sandbox", "--disable-dev-shm-usage"]
  });

  try {
    for (const target of targets) {
      const targetUrl = new URL("/", parsedUrl);
      for (const [key, value] of Object.entries(target.query)) {
        targetUrl.searchParams.set(key, value);
      }

      const result = await lighthouse(targetUrl.href, {
        port: chrome.port,
        output: "json",
        logLevel: "error",
        onlyCategories: ["performance"],
        formFactor: "mobile",
        throttlingMethod: "simulate",
        screenEmulation: {
          mobile: true,
          width: 390,
          height: 844,
          deviceScaleFactor: 1,
          disabled: false
        }
      });
      if (!result) throw new Error(`Lighthouse did not return a report for ${target.name}.`);

      const performanceScore = Math.round(result.lhr.categories.performance.score * 100);
      const lcpMs = result.lhr.audits["largest-contentful-paint"].numericValue;
      const cls = result.lhr.audits["cumulative-layout-shift"].numericValue;
      assert(Number.isFinite(performanceScore), `${target.name}: Lighthouse did not produce a performance score.`);
      assert(Number.isFinite(lcpMs), `${target.name}: Lighthouse did not measure Largest Contentful Paint.`);
      assert(Number.isFinite(cls), `${target.name}: Lighthouse did not measure Cumulative Layout Shift.`);

      console.log(
        `${target.name} mobile Lighthouse: score=${performanceScore} (informational), LCP=${Math.round(lcpMs)}ms, CLS=${cls.toFixed(3)}.`
      );
      assert(
        lcpMs <= maximumLcpMs,
        `${target.name}: LCP ${Math.round(lcpMs)}ms exceeds the ${maximumLcpMs}ms budget.`
      );
      assert(
        cls <= maximumCls,
        `${target.name}: CLS ${cls.toFixed(3)} exceeds the ${maximumCls} budget.`
      );
    }
    console.log("Mobile Lighthouse performance budgets passed for all targets.");
  } finally {
    await chrome.kill();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
