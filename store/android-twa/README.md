# Android Trusted Web Activity

This folder contains the Android publishing configuration for packaging the PWA as a Google Play app with Bubblewrap and Trusted Web Activity.

## Prerequisites

- A live HTTPS frontend URL: the production Netlify domain `https://commap.netlify.app`.
- Node.js, Java JDK 17, and Android Studio or Android command line tools.
- A Google Play Developer account.
- Final Android package name: `au.communitymap.app`.

## Generate The Android Project

1. Install Bubblewrap:

   ```powershell
   npm install -g @bubblewrap/cli
   ```

2. Initialize from the live manifest:

   ```powershell
   bubblewrap init --manifest https://commap.netlify.app/manifest.json
   ```

3. Use the values from `twa-manifest.example.json` when Bubblewrap prompts for app metadata (package `au.communitymap.app`, maskable icon `icon-maskable-512x512.png`).

4. Build the Play bundle:

   ```powershell
   bubblewrap build
   ```

5. Upload the generated `.aab` file to Google Play Console.

## Digital Asset Links

Google Play Trusted Web Activity requires the website and Android app to prove they belong to the same owner.

1. After Google Play App Signing is configured, copy BOTH SHA-256 fingerprints from Play Console: the Play app-signing key and your upload key.
2. Paste both into the existing `frontend/.well-known/assetlinks.json` (it already has the `au.communitymap.app` package and two placeholder slots).
3. Deploy the frontend and verify this URL returns JSON with the real fingerprints:

   ```text
   https://commap.netlify.app/.well-known/assetlinks.json
   ```

Do not deploy the example file as-is. A placeholder fingerprint will fail verification.

## Required Device Tests

- Launch from the home screen and from the Play-installed icon.
- Confirm the app opens fullscreen without browser chrome after Digital Asset Links verifies.
- Test GPS prompts, manual pin placement, image selection, map tiles, chat, admin login, and backend cold-start handling.
- Toggle airplane mode and confirm the cached app shell loads with a clear online-data limitation.
