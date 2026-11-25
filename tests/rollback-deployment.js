const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const root = path.resolve(__dirname, "..");
const releasePath = path.join(root, ".release-rollback.json");

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
    shell: process.platform === "win32"
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} exited with code ${result.status}`);
  }
}

async function main() {
  const release = JSON.parse(fs.readFileSync(releasePath, "utf8"));
  if (!release.previousCommit) throw new Error("No previous Git commit is available for rollback.");

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "handy-rollback-"));
  try {
    const archive = spawnSync("git", ["archive", "--format=tar", release.previousCommit], {
      cwd: root
    });
    if (archive.status !== 0) throw new Error("Could not archive the previous release commit.");
    fs.writeFileSync(path.join(tempRoot, "rollback.tar"), archive.stdout);

    run(process.platform === "win32" ? "tar.exe" : "tar", ["-xf", "rollback.tar"], tempRoot);
    run("npm", ["ci"], tempRoot);
    run("npm", ["run", "build"], tempRoot);
    run("npx", ["wrangler", "pages", "deploy", "dist", "--project-name=handy", "--branch=main"], tempRoot);

    console.log(`Rollback deployment completed from commit ${release.previousCommit}.`);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
