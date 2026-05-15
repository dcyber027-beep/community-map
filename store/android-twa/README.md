# Android Trusted Web Activity

This folder contains the Android publishing configuration for packaging the PWA as a Google Play app with Bubblewrap and Trusted Web Activity.

## Prerequisites

- A live HTTPS frontend URL, for example the production Netlify domain.
- Node.js, Java JDK, and Android Studio or Android command line tools.
- A Google Play Developer account.
- A final Android package name. The examples use `com.melbournecommunitymap.app`.

## Generate The Android Project

1. Install Bubblewrap:

   ```powershell
   npm install -g @bubblewrap/cli
   ```

2. Initialize from the live manifest:

   ```powershell
   bubblewrap init --manifest https://YOUR_NETLIFY_DOMAIN/manifest.json
   ```

3. Use the values from `twa-manifest.example.json` when Bubblewrap prompts for app metadata. Replace `YOUR_NETLIFY_DOMAIN` with the production frontend host.

4. Build the Play bundle:

   ```powershell
   bubblewrap build
   ```

5. Upload the generated `.aab` file to Google Play Console.

## Digital Asset Links

Google Play Trusted Web Activity requires the website and Android app to prove they belong to the same owner.

1. After Google Play App Signing is configured, copy the app signing certificate SHA-256 fingerprint from Play Console.
2. Copy `assetlinks.example.json` to `frontend/.well-known/assetlinks.json`.
3. Replace the fingerprint placeholder and package name if needed.
4. Deploy the frontend and verify this URL returns JSON:

   ```text
   https://YOUR_NETLIFY_DOMAIN/.well-known/assetlinks.json
   ```

Do not deploy the example file as-is. A placeholder fingerprint will fail verification.

## Required Device Tests

- Launch from the home screen and from the Play-installed icon.
- Confirm the app opens fullscreen without browser chrome after Digital Asset Links verifies.
- Test GPS prompts, manual pin placement, image selection, map tiles, chat, admin login, and backend cold-start handling.
- Toggle airplane mode and confirm the cached app shell loads with a clear online-data limitation.
