# iOS Publishing Strategy

## Recommendation

Use Safari PWA installation as the default iOS distribution path unless App Store presence is a hard requirement. The current app is primarily web-rendered, which is exactly what iOS Safari PWAs support.

If App Store presence is required, package the app with Capacitor and add native/app-like value before review. A bare WebView wrapper has a meaningful rejection risk under Apple's minimum functionality guideline.

## Option A: Safari PWA

Best when:

- The goal is mobile installability, not App Store discovery.
- You want the smallest maintenance burden.
- You do not need native push notifications, subscriptions, widgets, or deep OS integrations.

Work needed:

- Keep the manifest, icons, service worker, and mobile layout healthy.
- Add user-facing install instructions from Safari.
- Keep privacy, support, and terms URLs published.

## Option B: Capacitor App Store Build

Best when:

- App Store discovery is required.
- Native permission copy, launch screen, deep links, or platform integrations are important.
- You are prepared for App Review iteration.

Recommended native/app-like additions:

- Native launch screen and app icon set.
- Clear iOS permission descriptions for location and photo access.
- Native offline/error state for backend cold starts and network failures.
- Share/deep-link handling for opening specific map contexts.
- A dedicated moderation/report-content flow visible to reviewers.
- App Review demo notes and admin/demo credentials if reviewer access is needed.

## Capacitor Starting Commands

Run these only after deciding to pursue App Store packaging:

```powershell
npm init -y
npm install @capacitor/core @capacitor/cli
npx cap init "Melbourne Community Map" "au.communitymap.app" --web-dir frontend
npm install @capacitor/ios
npx cap add ios
npx cap sync ios
```

Then open the generated iOS project in Xcode, configure signing, set permission strings, test on device, and submit through App Store Connect.

## App Review Notes

Explain that the app:

- Provides community map/reporting utility specific to Melbourne.
- Uses location only when the user explicitly chooses current-location placement.
- Contains moderation and admin tools for user-generated content.
- Is not for emergencies and directs users to call 000 when needed.

Do not submit a plain WebView with no additional platform behavior or review context.
