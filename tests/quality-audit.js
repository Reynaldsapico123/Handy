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

async function getAccessibilityViolations(page) {
  return page.evaluate(async () => {
    const results = await window.axe.run(document, {
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
  });
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
    for (const theme of ["light", "dark"]) {
      if (theme === "dark") {
        await page.click("#themeToggle");
        await page.waitForTimeout(200);
      }
      const violations = await getAccessibilityViolations(page);
      const blockingViolations = violations.filter((violation) =>
        ["critical", "serious"].includes(violation.impact)
      );
      const advisoryViolations = violations.filter((violation) =>
        !["critical", "serious"].includes(violation.impact)
      );

      if (advisoryViolations.length) {
        console.warn(`${theme} theme accessibility advisories:\n${JSON.stringify(advisoryViolations, null, 2)}`);
      }
      if (blockingViolations.length) {
        throw new Error(`Found ${blockingViolations.length} serious or critical accessibility violation(s) in the ${theme} theme:\n${JSON.stringify(blockingViolations, null, 2)}`);
      }
      console.log(`Accessibility passed (${theme} theme): no serious or critical violations.`);
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
