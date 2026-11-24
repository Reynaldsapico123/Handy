const assert = require("assert");

const targetUrl = new URL(
  process.env.HANDY_PRODUCTION_URL || "https://handy-6on.pages.dev"
);
const isLoopback = ["localhost", "127.0.0.1", "[::1]"].includes(targetUrl.hostname);
if (targetUrl.protocol !== "https:" && !(targetUrl.protocol === "http:" && isLoopback)) {
  throw new Error("Health checks must use HTTPS except for localhost testing.");
}

async function fetchOk(url, description) {
  const response = await fetch(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(10000)
  });
  assert(response.ok, `${description} returned HTTP ${response.status}.`);
  assert.strictEqual(
    new URL(response.url).origin,
    targetUrl.origin,
    `${description} redirected to an unexpected origin.`
  );
  return response;
}

async function main() {
  const homeResponse = await fetchOk(new URL("/", targetUrl), "Production home page");
  const html = await homeResponse.text();
  assert.match(html, /<title>Handy — Everyday tools for everyone<\/title>/);
  const buildId = html.match(/<meta name="handy-build" content="([a-f0-9]{12})"/i)?.[1];
  assert(buildId, "Production home page has no valid build fingerprint.");
  const htmlCacheControl = homeResponse.headers.get("cache-control") || "";
  assert.match(htmlCacheControl, /no-cache|max-age=0|must-revalidate/i);
  assert(
    !/immutable/i.test(htmlCacheControl),
    "Production HTML must remain revalidated."
  );

  const csp = homeResponse.headers.get("content-security-policy") || "";
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /connect-src 'self' https:\/\/open\.er-api\.com/);
  assert(
    !homeResponse.headers.get("content-security-policy-report-only"),
    "Production is serving only a report-only Content Security Policy."
  );

  const permissionsPolicy = homeResponse.headers.get("permissions-policy") || "";
  assert.match(permissionsPolicy, /camera=\(self\)/);
  assert.match(permissionsPolicy, /geolocation=\(\)/);
  assert.match(permissionsPolicy, /microphone=\(\)/);
  assert.strictEqual(homeResponse.headers.get("x-content-type-options"), "nosniff");

  const scriptUrls = [...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/gi)]
    .map(([, src]) => new URL(src, targetUrl));
  const styleUrls = [...html.matchAll(/<link\b[^>]*\bhref=["']([^"']+\.css(?:\?[^"']*)?)["']/gi)]
    .map(([, href]) => new URL(href, targetUrl));
  const versionedAssets = [...scriptUrls, ...styleUrls];
  assert(scriptUrls.length > 0, "Production home page contains no external scripts.");
  assert(styleUrls.length > 0, "Production home page contains no stylesheets.");
  for (const assetUrl of versionedAssets) {
    assert.strictEqual(assetUrl.origin, targetUrl.origin, "An asset is not same-origin.");
    assert(assetUrl.searchParams.has("v"), `Asset ${assetUrl.pathname} is not versioned.`);
    const response = await fetchOk(assetUrl, `Asset ${assetUrl.pathname}`);
    const cacheControl = response.headers.get("cache-control") || "";
    assert.match(
      cacheControl,
      /max-age=31536000/,
      `Asset ${assetUrl.pathname} does not have a one-year cache lifetime.`
    );
    assert.match(cacheControl, /immutable/i, `Asset ${assetUrl.pathname} is not immutable.`);
  }

  for (const path of [
    "/calculator.js",
    "/unit-converter.js",
    "/timer.js",
    "/guides.js",
    "/world-clock.js",
    "/currency.js",
    "/qr-code.js",
    "/vendor/qrcode.js",
    "/vendor/jsQR.js"
  ]) {
    const assetUrl = new URL(path, targetUrl);
    assetUrl.searchParams.set("v", buildId);
    const response = await fetchOk(assetUrl, `Tool script ${path}`);
    const cacheControl = response.headers.get("cache-control") || "";
    assert.match(
      cacheControl,
      /max-age=31536000/,
      `Tool script ${path} does not have a one-year cache lifetime.`
    );
    assert.match(cacheControl, /immutable/i, `Tool script ${path} is not immutable.`);
  }

  for (const [path, marker] of [
    ["/calculator", 'id="calculatorModal"'],
    ["/qr-code", 'id="qrModal"']
  ]) {
    const response = await fetchOk(new URL(path, targetUrl), `Tool fragment ${path}`);
    assert(!response.redirected, `Tool fragment ${path} unexpectedly redirected.`);
    assert(
      (await response.text()).includes(marker),
      `Tool fragment ${path} is missing ${marker}.`
    );
  }

  const serviceWorkerResponse = await fetchOk(
    new URL("/sw.js", targetUrl),
    "Service worker"
  );
  const serviceWorkerCacheControl = serviceWorkerResponse.headers.get("cache-control") || "";
  assert.match(serviceWorkerCacheControl, /no-cache/i);
  assert.doesNotMatch(serviceWorkerCacheControl, /immutable|31536000/i);
  const serviceWorker = await serviceWorkerResponse.text();
  assert.match(serviceWorker, /addEventListener\(["']install["']/);
  assert.match(serviceWorker, /addEventListener\(["']fetch["']/);

  console.log(
    `Production health check passed: ${targetUrl.origin} (build ${buildId})`
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
