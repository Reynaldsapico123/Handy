const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

execFileSync(process.execPath, [path.join(root, "build.js")], {
  cwd: root,
  stdio: "inherit"
});

const html = fs.readFileSync(path.join(root, "dist", "index.html"), "utf8");
const serviceWorker = fs.readFileSync(path.join(root, "dist", "sw.js"), "utf8");
const buildId = html.match(/<meta name="handy-build" content="([a-f0-9]{12})">/)?.[1];

assert(buildId, "The production HTML should expose its build ID.");
assert(
  serviceWorker.includes(`const CACHE_NAME = "handy-${buildId}";`),
  "The production service-worker cache should match the app build ID."
);

console.log("Production service-worker cache version matches the app build.");
