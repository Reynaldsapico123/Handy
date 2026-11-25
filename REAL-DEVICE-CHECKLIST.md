# Real-device release checklist

## Before testing

- Use the latest Cloudflare preview or production URL.
- Test on the newest supported iPhone and Android phone available.
- Confirm the browser is updated and the network is HTTPS.

## iPhone with Safari

- Open Handy and dismiss the welcome guide.
- Install the PWA from Safari's share menu.
- Confirm the homepage and all tool dialogs fit the notch-safe viewport.
- Open QR Scanner and allow camera access; verify real-world QR decoding.
- Deny camera access, then verify the retry/upload fallback remains usable.
- Switch light/dark mode, then rotate the device.
- Set network access to offline and reload; verify the app and Calculator open.
- Check the update notice after a new deployment.

## Android with Chrome

- Open Handy and dismiss the welcome guide.
- Install or add the PWA to the home screen.
- Confirm the homepage and all tool dialogs fit the Android viewport.
- Open QR Scanner and allow camera access; verify real-world QR decoding.
- Test the rear camera, then switch or stop camera scanning.
- Switch light/dark mode and rotate the device.
- Set airplane mode and reload; verify offline tool use and the update notice.

## Record a result

Record the device model, OS version, browser version, URL/build ID, pass/fail status, and screenshots or screen recordings for failures.
