const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const root = path.resolve(__dirname, "..");
const deploymentPath = path.join(root, "deployment.json");
const primaryUrl = "https://handy-6on.pages.dev";

function runNpm(args, env = {}) {
  const command = process.platform === "win32" ? "npm.cmd" : "npm";
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      stdio: "inherit",
      shell: true,
      env: { ...process.env, ...env }
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`npm ${args.join(" ")} exited with code ${code}`));
    });
  });
}

async function fetchText(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  return response.text();
}

async function fetchPrimaryHtml(expectedBuildId) {
  const maxAttempts = 6;
  const retryDelayMs = 5000;
  let liveBuildId = "unknown";

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const html = await fetchText(`${primaryUrl}/`);
    liveBuildId = html.match(/<meta name="handy-build" content="([a-f0-9]{12})"/i)?.[1];
    if (!liveBuildId) {
      throw new Error("Primary deployment did not return a Handy build fingerprint.");
    }
    if (!expectedBuildId || liveBuildId === expectedBuildId) return html;
    if (attempt < maxAttempts) {
      console.warn(
        `Primary deployment is still updating (live=${liveBuildId}, ` +
        `recorded=${expectedBuildId}); retrying in ${retryDelayMs / 1000}s ` +
        `(${attempt}/${maxAttempts}).`
      );
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }

  throw new Error(
    `Live build mismatch after ${maxAttempts} checks: ` +
    `live=${liveBuildId}, recorded=${expectedBuildId}`
  );
}

async function main() {
  let deployment = {};
  try {
    deployment = JSON.parse(fs.readFileSync(deploymentPath, "utf8"));
  } catch {
    deployment = {
      url: primaryUrl,
      buildId: "unknown",
      deployedAt: null,
      primaryUrl,
      verification: { status: "pending", checks: [] }
    };
  }

  const checks = [];
  let verificationStatus = "passed";
  try {
    const primaryHtml = await fetchPrimaryHtml();
    const primaryBuild = primaryHtml.match(/<meta name="handy-build" content="([a-f0-9]{12})"/i)?.[1];
    deployment.url = primaryUrl;
    deployment.buildId = primaryBuild;
    deployment.primaryUrl = primaryUrl;
    if (!deployment.deployedAt) deployment.deployedAt = new Date().toISOString();
    checks.push({ name: "primary-build-fingerprint", status: "passed", value: primaryBuild });

    await fetchText(`${primaryUrl}/sw.js`);
    checks.push({ name: "service-worker", status: "passed" });

    const scriptMatches = [...primaryHtml.matchAll(/<script src="([^"]+\.(?:js)(?:\?[^"]*)?)"/g)];
    if (!scriptMatches.length) throw new Error("Primary deployment returned no versioned scripts.");
    for (const [, scriptUrl] of scriptMatches) {
      await fetchText(`${primaryUrl}${scriptUrl.startsWith("/") ? "" : "/"}${scriptUrl}`);
    }
    checks.push({ name: "critical-assets", status: "passed", value: scriptMatches.length });

    if (deployment.url && deployment.url !== primaryUrl) {
      const previewHtml = await fetchText(`${deployment.url}/`);
      if (!previewHtml.includes("Handy")) throw new Error("Preview deployment did not return the Handy app.");
      checks.push({ name: "preview-deployment", status: "passed", value: deployment.url });
    }

    await runNpm(["run", "smoke:cloudflare"], {
      HANDY_DEPLOYMENT_URL: primaryUrl
    });
    checks.push({ name: "browser-smoke", status: "passed" });

    deployment.verification = {
      status: "passed",
      checkedAt: new Date().toISOString(),
      checks
    };
    console.log(`Deployment monitoring passed: ${primaryUrl}`);
  } catch (error) {
    verificationStatus = "failed";
    checks.push({ name: "monitoring", status: "failed", error: error.message });
    deployment.verification = {
      status: "failed",
      checkedAt: new Date().toISOString(),
      checks
    };
    console.error(`Deployment monitoring failed: ${error.message}`);
    process.exitCode = 1;
  }

  const verificationHistory = Array.isArray(deployment.verificationHistory)
    ? deployment.verificationHistory
    : [];
  verificationHistory.push({
    status: verificationStatus,
    checkedAt: deployment.verification.checkedAt,
    buildId: deployment.buildId,
    primaryUrl,
    checks
  });
  deployment.verificationHistory = verificationHistory.slice(-100);
  fs.writeFileSync(deploymentPath, `${JSON.stringify(deployment, null, 2)}\n`);
}

main();
