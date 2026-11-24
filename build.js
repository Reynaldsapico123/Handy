const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const root = __dirname;
const dist = path.join(root, "dist");

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });

const excluded = new Set([
  "node_modules",
  ".git",
  ".tsupgrader",
  "dist",
  "tests",
  "package.json",
  "package-lock.json",
  "build.js",
  "netlify.toml"
]);

for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
  if (excluded.has(entry.name)) continue;
  const source = path.join(root, entry.name);
  const destination = path.join(dist, entry.name);
  if (entry.isDirectory()) {
    fs.cpSync(source, destination, { recursive: true });
  } else if (entry.name === "index.html") {
    const html = fs.readFileSync(source, "utf8")
      .replace("node_modules/qrcode-generator/dist/qrcode.js", "vendor/qrcode.js")
      .replace("node_modules/jsqr/dist/jsQR.js", "vendor/jsQR.js");
    fs.writeFileSync(destination, html);
  } else if (entry.name === "script.js" || entry.name === "sw.js") {
    const contents = fs.readFileSync(source, "utf8")
      .replaceAll("node_modules/qrcode-generator/dist/qrcode.js", "vendor/qrcode.js")
      .replaceAll("node_modules/jsqr/dist/jsQR.js", "vendor/jsQR.js");
    fs.writeFileSync(destination, contents);
  } else {
    fs.copyFileSync(source, destination);
  }
}

const vendorDirectory = path.join(dist, "vendor");
fs.mkdirSync(vendorDirectory, { recursive: true });
fs.copyFileSync(
  path.join(root, "node_modules", "qrcode-generator", "dist", "qrcode.js"),
  path.join(vendorDirectory, "qrcode.js")
);
fs.copyFileSync(
  path.join(root, "node_modules", "jsqr", "dist", "jsQR.js"),
  path.join(vendorDirectory, "jsQR.js")
);

const indexPath = path.join(dist, "index.html");
const html = fs.readFileSync(indexPath, "utf8");
const buildFiles = fs.readdirSync(dist)
  .filter((file) => /\.(?:js|css)$/.test(file))
  .sort();
const buildFingerprint = crypto.createHash("sha256");
buildFiles.forEach((file) => {
  buildFingerprint.update(file);
  buildFingerprint.update(fs.readFileSync(path.join(dist, file)));
});
const buildId = buildFingerprint.digest("hex").slice(0, 12);
const stampedHtml = html.replace(
  '<meta name="handy-build" content="development">',
  `<meta name="handy-build" content="${buildId}">`
);
const versionedHtml = stampedHtml.replace(/((?:src|href)=")([^"]+\.(?:js|css))"/g, (match, prefix, assetUrl) => {
  const assetPath = path.join(dist, assetUrl);
  const version = crypto.createHash("sha256").update(fs.readFileSync(assetPath)).digest("hex").slice(0, 12);
  return `${prefix}${assetUrl}?v=${version}"`;
});
fs.writeFileSync(indexPath, versionedHtml);

console.log("Production files created in dist/");
