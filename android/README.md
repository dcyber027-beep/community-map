# Android wrapper (Bubblewrap Trusted Web Activity)

This folder is the in-repo source for the Google Play build of **Melbourne
Community Map**. It wraps the live PWA at `https://commap.netlify.app` as a
Trusted Web Activity (TWA).

- **Package:** `au.communitymap.app`
- **Source of truth:** [`twa-manifest.json`](twa-manifest.json) (committed, no secrets)
- **Generated project + signed bundles:** produced locally, git-ignored (see [`.gitignore`](.gitignore))

The Bubblewrap CLI is already installed globally (`@bubblewrap/cli`). The two
steps below are interactive and involve your **upload signing key**, so you run
them yourself — the key password must be a secret only you hold (never commit
the keystore; back it up somewhere safe).

## 1. Create your upload keystore (one-time)

From this `android/` folder, pick your own strong password when prompted:

```powershell
keytool -genkeypair -v `
  -keystore android.keystore `
  -alias upload `
  -keyalg RSA -keysize 2048 -validity 9125 -storetype PKCS12
```

`twa-manifest.json` already points `signingKey.path` at `./android.keystore`
with alias `upload`, so no edits are needed if you keep those names.

## 2. Generate the Android project and build the bundle

`twa-manifest.json` holds every value Bubblewrap needs. Initialise the Gradle
project from the live web manifest, then build:

```powershell
# Scaffolds the Gradle project. When prompted, accept the JDK/Android SDK
# download, and confirm the values already in twa-manifest.json
# (package au.communitymap.app, name "Melbourne Community Map", etc.).
bubblewrap init --manifest https://commap.netlify.app/manifest.json

# Builds and signs the release bundle.
bubblewrap build
```

Output: `app-release-bundle.aab` (this is what you upload to Play). It and the
generated Gradle files stay out of git by design.

## 3. Get your upload key SHA-256 fingerprint

You will need this for `frontend/.well-known/assetlinks.json` (Phase D):

```powershell
keytool -list -v -keystore android.keystore -alias upload
```

Copy the `SHA256:` line. After you upload the `.aab` and enrol in **Play App
Signing**, Play Console will also show a second SHA-256 (the app-signing key).
Both go into `assetlinks.json`.

## 4. Future releases

Bump `appVersionCode` (and usually `appVersionName`) in `twa-manifest.json`,
then re-run `bubblewrap build`. Each Play upload needs a higher
`appVersionCode`.

## What is committed vs. not

- Committed: `twa-manifest.json`, this `README.md`, `.gitignore`.
- Never committed: `android.keystore` / any `*.jks` / `*.keystore`,
  `local.properties`, `*.aab` / `*.apk`, and the `.gradle/` / `build/` outputs.
