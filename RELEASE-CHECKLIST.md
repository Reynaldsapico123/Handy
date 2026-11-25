# Handy release checklist

## GitHub Actions deployment

Add these repository secrets under GitHub **Settings → Secrets and variables → Actions**:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

Pushes to `main` automatically test, build, deploy to Cloudflare Pages, verify the primary alias, and upload deployment evidence.

The quality gate runs axe-core on the homepage and all seven tool dialogs in desktop/mobile and light/dark themes, including both QR creation and scanner modes. It also checks calculator history, currency offline/refresh-error states, QR camera-permission denial, and a decoded scan result. Serious or critical findings fail the gate.

The visual regression gate captures the homepage and every tool dialog at desktop and mobile sizes in light and dark themes. Baseline images are committed under `tests/visual-baselines/`. Run `npm run audit:visual:update` after intentional UI changes, review every updated PNG, and commit the approved baselines. Visual mismatches upload actual and diff images as deployment evidence.

The privacy gate verifies that the app creates no cookies or unexpected third-party requests, exported backups exclude calculator history and QR text, and clear-data removes Handy storage without touching unrelated browser storage.

The separate [production monitor](./.github/workflows/monitor-production.yml) runs daily at 08:17 UTC and after successful deployments; it can also be started manually. It checks the live app without Cloudflare credentials; run `npm run health:production` to check it locally.

The scheduled [deployment monitor](./.github/workflows/deployment-monitor.yml) discovers the live primary URL and build fingerprint independently of local release metadata. Each run creates or updates `deployment.json` as monitoring evidence, so it can run successfully after a clean checkout.

The deployment workflow runs a simulated mobile Lighthouse audit against the Cloudflare preview for the homepage, Calculator, Currency, and QR scanner. The release budget follows the Core Web Vitals "good" thresholds: LCP at or below 2.5 seconds and CLS at or below 0.10. Lighthouse's overall performance score is reported for context.

It also measures mobile tap-to-ready time for all seven lazy-loaded tools with a throttled 3G connection and 4× CPU slowdown. Each tool must become usable within 2 seconds; live currency rates are mocked so the budget measures local tool readiness rather than an external API.

Versioned JavaScript and CSS assets are cached for one year; HTML and `/sw.js` remain revalidated. The production health check verifies both policies.

## Latest release

Run `npm run deploy:cloudflare` to build, deploy, and record the Cloudflare URL.
Run `npm run smoke:cloudflare` to verify the recorded deployment.
Confirm the deployed smoke test reports no Content Security Policy violations.

Before deploying:

- Run `npm run smoke`.
- Confirm the production build exists in `dist/`.
- Check desktop and mobile layouts at 1280px and 390px widths.
- Open, close, and trap keyboard focus in every tool modal.
- Test `/` and `Ctrl/Cmd+K`; confirm Enter opens the selected action.
- Test Calculator, Unit Converter, Timer, World Clock, Currency, and QR tools.
- Test QR image scanning and camera permission success/error states; confirm the deployed smoke check allows same-origin camera access.
- Run the Firefox/WebKit smoke check for core tools, QR decoding, scanner startup/fallback, and service-worker update/offline recovery; Chromium covers camera permission and offline behavior.
- Run the Chromium Pixel 7 and WebKit iPhone 13 emulated profiles in `npm run smoke:browsers`, then complete the [real-device checklist](./REAL-DEVICE-CHECKLIST.md) on available iOS and Android phones.
- Test currency online refresh, cached fallback, offline state, and timeout.
- Test backup download and restore; confirm calculator history and QR text remain unchanged.
- Test tool hiding/reordering/reset, theme, favorites, and recent tools.
- Test PWA install guidance, update notice, offline navigation, and the diagnostics panel; automated Chromium, Firefox, and WebKit checks verify successful and failed worker updates, cache cleanup, recovery, and offline tool use.
- Confirm privacy/clear-data action preserves unrelated browser storage.
- Deploy `dist/` to Cloudflare Pages.
- On the deployed URL, repeat the smoke checks once and verify asset URLs use local versioned files.
