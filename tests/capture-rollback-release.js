const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const root = path.resolve(__dirname, "..");
const outputPath = path.join(root, ".release-rollback.json");
const primaryUrl = "https://handy-6on.pages.dev";

async function main() {
  let primaryBuildId = null;
  try {
    const response = await fetch(`${primaryUrl}/`, { cache: "no-store" });
    if (response.ok) {
      const html = await response.text();
      primaryBuildId = html.match(/<meta name="handy-build" content="([a-f0-9]{12})"/i)?.[1] || null;
    }
  } catch {
    primaryBuildId = null;
  }

  const parent = spawnSync("git", ["rev-parse", "HEAD^"], {
    cwd: root,
    encoding: "utf8"
  });
  const previousCommit = parent.status === 0 ? parent.stdout.trim() : null;
  const record = {
    primaryUrl,
    primaryBuildId,
    previousCommit,
    capturedAt: new Date().toISOString()
  };
  fs.writeFileSync(outputPath, `${JSON.stringify(record, null, 2)}\n`);
  console.log(
    `Rollback release captured: primary=${primaryBuildId || "unknown"}, ` +
    `previous=${previousCommit || "unknown"}`
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
