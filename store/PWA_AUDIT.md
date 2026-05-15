# PWA Store Readiness Audit

Audit date: May 2026

## Result

The app is a suitable candidate for Google Play packaging through Trusted Web Activity. It has the core installability pieces already in place:

- Web app manifest at `frontend/manifest.json`
- Service worker at `frontend/sw.js`
- HTTPS-ready static hosting through Netlify
- Multiple PNG app icons up to 512px
- Mobile viewport, theme color, and Apple mobile web app metadata in `frontend/index.html`
- Browser APIs compatible with mobile packaging: geolocation, file input, fetch, canvas image compression, and local storage

## Changes Made For Store Readiness

- Added manifest `id`, `lang`, `dir`, and `display_override` for stronger install metadata.
- Added public privacy, support, and terms pages under `frontend/`.
- Added those pages to the service worker precache list.
- Added HTML discovery links for privacy and support from the main page.
- Added Android TWA configuration examples under `store/android-twa/`.

## Remaining Pre-Submission Checks

- Run Lighthouse against the deployed production URL, not only local files.
- Confirm all app icons are final production branding and pass maskable-icon cropping checks.
- Replace placeholder support text with the real support email or contact form.
- Publish `frontend/.well-known/assetlinks.json` only after the Play signing certificate fingerprint is known.
- Replace wildcard backend CORS with known production frontend origins once the final domain is stable.
- Confirm app content moderation coverage for user reports, images, and anonymous chat.

## Known Review Risks

- The app includes user-generated content. Store review will expect moderation, reporting, blocking or removal ability, and published contact information.
- The app uses location. Store listings must disclose location use clearly and align with the runtime permission prompt.
- The backend currently runs on a free Render service that may cold start. This is handled by the frontend, but final app testing should confirm the first launch still feels acceptable.
- iOS App Store approval is not guaranteed for a mostly web-rendered app unless native/app-like value is added.
