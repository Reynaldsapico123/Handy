const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const npxCommand = process.platform === "win32" ? "npx.cmd" : "npx";

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      stdio: "inherit",
      shell: true
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} exited with code ${code}`));
    });
  });
}

function capture(command, args) {
  return new Promise((resolve, reject) => {
    let output = "";
    const child = spawn(command, args, {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"],
      shell: true
    });
    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      output += text;
      process.stdout.write(text);
    });
    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      output += text;
      process.stderr.write(text);
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve(output);
      else reject(new Error(`${command} ${args.join(" ")} exited with code ${code}`));
    });
  });
}

async function main() {
  await run(npmCommand, ["run", "build"]);
  const output = await capture(npxCommand, [
    "wrangler",
    "pages",
    "deploy",
    "dist",
    "--project-name=handy"
  ]);

  const urlMatch = output.match(/https:\/\/[a-z0-9-]+\.handy-6on\.pages\.dev/i);
  if (!urlMatch) {
    throw new Error("Deployment succeeded, but the Cloudflare Pages URL could not be found.");
  }

  const distIndex = fs.readFileSync(path.join(root, "dist", "index.html"), "utf8");
  const buildMatch = distIndex.match(/<meta name="handy-build" content="([a-f0-9]{12})">/i);
  const buildId = buildMatch ? buildMatch[1] : "unknown";
  const deployedAt = new Date().toISOString();
  const record = {
    url: urlMatch[0],
    buildId,
    deployedAt,
    primaryUrl: "https://handy-6on.pages.dev",
    verification: {
      status: "pending",
      checks: []
    }
  };
  writeDeploymentRecord(root, record);

  console.log(`\nRecorded release:\n  URL: ${record.url}\n  Build: ${record.buildId}\n  Deployed: ${record.deployedAt}`);
  try {
    await run(npmCommand, ["run", "smoke:cloudflare"]);
    record.verification.status = "passed";
    record.verification.checks = [
      { name: "live-build-fingerprint", status: "passed" },
      { name: "browser-smoke", status: "passed" }
    ];
    record.verifiedAt = new Date().toISOString();
    writeDeploymentRecord(root, record);
    console.log("Post-deploy fingerprint and browser smoke verification passed.");
  } catch (error) {
    record.verification.status = "failed";
    record.verification.checks = [
      { name: "live-build-fingerprint", status: "unknown" },
      { name: "browser-smoke", status: "failed", error: error.message }
    ];
    record.verifiedAt = new Date().toISOString();
    writeDeploymentRecord(root, record);
    throw error;
  }
}

function writeDeploymentRecord(rootDirectory, record) {
  const deploymentPath = path.join(rootDirectory, "deployment.json");
  let history = [];
  try {
    const previous = JSON.parse(fs.readFileSync(deploymentPath, "utf8"));
    if (Array.isArray(previous.history)) history = previous.history;
    if (previous.buildId && previous.buildId !== record.buildId) {
      history = [
        ...history,
        {
          url: previous.url,
          buildId: previous.buildId,
          deployedAt: previous.deployedAt,
          verification: previous.verification || { status: "unknown", checks: [] }
        }
      ];
    }
  } catch {
    history = [];
  }
  const release = { ...record, history: history.slice(-10) };
  fs.writeFileSync(deploymentPath, `${JSON.stringify(release, null, 2)}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
