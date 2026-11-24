# Handy release checklist

## GitHub Actions deployment

Add these repository secrets under GitHub **Settings → Secrets and variables → Actions**:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

Pushes to `main` automatically test, build, deploy to Cloudflare Pages, verify the primary alias, and upload deployment evidence.

The separate [production monitor](./.github/workflows/monitor-production.yml) runs daily at 08:17 UTC and after successful deployments; it can also be started manually. It checks the live app without Cloudflare credentials; run `npm run health:production` to check it locally.

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
- Run the Firefox/WebKit smoke check for core tools, QR decoding, and scanner startup/fallback; Chromium covers camera permission and offline behavior.
- Test currency online refresh, cached fallback, offline state, and timeout.
- Test backup download and restore; confirm calculator history and QR text remain unchanged.
- Test tool hiding/reordering/reset, theme, favorites, and recent tools.
- Test PWA install guidance, update notice, offline navigation, and the diagnostics panel.
- Confirm privacy/clear-data action preserves unrelated browser storage.
- Deploy `dist/` to Cloudflare Pages.
- On the deployed URL, repeat the smoke checks once and verify asset URLs use local versioned files.
