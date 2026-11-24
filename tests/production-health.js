const assert = require("assert");

const productionUrl = new URL(
  process.env.HANDY_PRODUCTION_URL || "https://handy-6on.pages.dev"
);
if (productionUrl.protocol !== "https:") {
  throw new Error("Production health checks must use HTTPS.");
}

async function fetchOk(url, description) {
  const response = await fetch(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(10000)
  });
  assert(response.ok, `${description} returned HTTP ${response.status}.`);
  assert.strictEqual(
    new URL(response.url).origin,
    productionUrl.origin,
    `${description} redirected to an unexpected origin.`
  );
  return response;
}

async function main() {
  const homeResponse = await fetchOk(new URL("/", productionUrl), "Production home page");
  const html = await homeResponse.text();
  assert.match(html, /<title>Handy — Everyday tools for everyone<\/title>/);
  const buildId = html.match(/<meta name="handy-build" content="([a-f0-9]{12})"/i)?.[1];
  assert(buildId, "Production home page has no valid build fingerprint.");

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

  const scripts = [...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/gi)]
    .map(([, src]) => new URL(src, productionUrl));
  assert(scripts.length > 0, "Production home page contains no external scripts.");
  for (const scriptUrl of scripts) {
    assert.strictEqual(scriptUrl.origin, productionUrl.origin, "A script is not same-origin.");
    await fetchOk(scriptUrl, `Script ${scriptUrl.pathname}`);
  }

  for (const [path, marker] of [
    ["/calculator", 'id="calculatorModal"'],
    ["/qr-code", 'id="qrModal"']
  ]) {
    const response = await fetchOk(new URL(path, productionUrl), `Tool fragment ${path}`);
    assert(!response.redirected, `Tool fragment ${path} unexpectedly redirected.`);
    assert(
      (await response.text()).includes(marker),
      `Tool fragment ${path} is missing ${marker}.`
    );
  }

  const serviceWorkerResponse = await fetchOk(
    new URL("/sw.js", productionUrl),
    "Service worker"
  );
  assert.match(
    serviceWorkerResponse.headers.get("cache-control") || "",
    /no-cache/i
  );
  const serviceWorker = await serviceWorkerResponse.text();
  assert.match(serviceWorker, /addEventListener\(["']install["']/);
  assert.match(serviceWorker, /addEventListener\(["']fetch["']/);

  console.log(
    `Production health check passed: ${productionUrl.origin} (build ${buildId})`
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
