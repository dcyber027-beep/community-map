# Store Publishing

This directory collects the practical store publishing materials for Melbourne Community Map.

## Files

- `PWA_AUDIT.md` - current PWA readiness audit and remaining checks.
- `STORE_LISTING.md` - draft Google Play and App Store listing copy.
- `IOS_STRATEGY.md` - iOS distribution recommendation and Capacitor path.
- `android-twa/` - Trusted Web Activity configuration examples for Google Play.

## Suggested Release Order

1. Deploy the current frontend changes.
2. Replace placeholder support/contact text with official contact details.
3. Run Lighthouse against the production frontend URL.
4. Generate the Android TWA with Bubblewrap and upload the `.aab` to Google Play internal testing.
5. Add the real Digital Asset Links file after Play App Signing provides the SHA-256 fingerprint.
6. Decide whether iOS stays Safari PWA-only or moves to a Capacitor App Store package.
