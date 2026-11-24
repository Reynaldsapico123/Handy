const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const root = path.resolve(__dirname, "..");
const deploymentPath = path.join(root, "deployment.json");
const primaryUrl = "https://handy-6on.pages.dev";

function runNpm(args) {
  const command = process.platform === "win32" ? "npm.cmd" : "npm";
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      stdio: "inherit",
      shell: true
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

async function main() {
  let deployment = {};
  try {
    deployment = JSON.parse(fs.readFileSync(deploymentPath, "utf8"));
  } catch {
    throw new Error("deployment.json is missing or invalid.");
  }

  const checks = [];
  let verificationStatus = "passed";
  try {
    const primaryHtml = await fetchText(`${primaryUrl}/`);
    const primaryBuild = primaryHtml.match(/<meta name="handy-build" content="([a-f0-9]{12})"/i)?.[1];
    if (!primaryBuild) throw new Error("Primary deployment did not return a Handy build fingerprint.");
    if (deployment.buildId && primaryBuild !== deployment.buildId) {
      throw new Error(`Live build mismatch: live=${primaryBuild}, recorded=${deployment.buildId}`);
    }
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

    await runNpm(["run", "smoke:cloudflare"]);
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
