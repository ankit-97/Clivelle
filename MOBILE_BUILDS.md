# Clivelle mobile builds

Clivelle is currently a responsive HTML/CSS/JavaScript storefront. Capacitor packages the existing storefront into native Android and iOS shells; it does not turn demo services into production services.

## Android

1. Open the repository's **Actions** tab.
2. Select **Build Clivelle for Android** and choose **Run workflow** (or wait for the workflow after a relevant push to main).
3. Download the `clivelle-android-debug` artifact from the completed run.
4. Extract the ZIP and install `app-debug.apk` on an Android device. This is a debug/testing APK, not a Play Store release.

## iOS

Run **Build Clivelle for iOS** from Actions and download `clivelle-ios-simulator`. This is a simulator build for testing in the iOS Simulator on a Mac. It is not an installable iPhone IPA.

A signed iPhone build for TestFlight/App Store distribution requires an Apple Developer account and signing assets (distribution certificate and provisioning profile). Configure those securely as GitHub Actions secrets before adding a signed-device workflow.

## App identity

- Display name: Clivelle
- Bundle identifier: `in.clivelle.shop`
- Web assets: copied from the repository root into `www/` during each build

## Before production release

The current storefront contains demo sign-in and demo checkout behavior, and stores cart/account/order data locally on the device. Connect a real authentication provider, backend/database, inventory/order service, payment gateway, privacy policy, and shipping/returns operations before accepting real customers or payments. Add final app icons, splash screens, and store metadata before publishing.


## Free installable web app (PWA)

Clivelle can also be installed from a public HTTPS website on iPhone, Android, and desktop browsers. No Apple Developer membership or app-store payment is required.

1. In repository **Settings → Pages**, set **Build and deployment → Source** to **GitHub Actions**.
2. The **Deploy Clivelle PWA** workflow builds the static web app and publishes it to GitHub Pages after changes to the storefront.
3. Share the published URL with customers.
4. On iPhone/iPad, open the URL in Safari, tap **Share → Add to Home Screen → Add**.
5. On Android, open the URL in Chrome and choose **Install app** or **Add to Home screen**.

The PWA uses a web app manifest and a service worker for a basic offline app shell. The existing sign-in, cart, checkout, and order flows remain prototype/demo features stored locally in the browser; no real payment is taken.
