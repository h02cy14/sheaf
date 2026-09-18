# CI, builds and installing test builds

Workflow: [`.github/workflows/ci.yml`](../.github/workflows/ci.yml). It runs on
every push to `main`, on every pull request, and on demand ("Run workflow").

## What runs

| Job | Runner | Produces |
|---|---|---|
| Lint, typecheck, test, JS licences | Ubuntu 24.04 | Nothing; blocks the build on failure |
| Rust licences, bans, sources | Ubuntu 24.04 | Nothing; blocks on a licence or telemetry violation |
| Rust security advisories | Ubuntu 24.04 | Report only (informational) |
| Desktop (Windows) | Windows Server 2025 | `Sheaf_<v>_x64-setup.exe`, `Sheaf_<v>_x64_en-US.msi` |
| Desktop (Linux) | Ubuntu 22.04 | `.AppImage`, `.deb`, `.rpm` (x86_64) |
| Android | Ubuntu 24.04 | `sheaf-android-universal.apk` (arm64, armv7, x86_64) |
| iOS | macOS 15 | `sheaf-ios-unsigned.ipa`, `sheaf-ios-simulator.zip` |
| Publish dev build | Ubuntu 24.04 | Replaces the **`dev-build`** pre-release with all of the above (pushes to `main` only) |

Every job's outputs are also attached to its run as Actions artifacts. Those
need a GitHub login to download; the `dev-build` release does not.

## Installing a test build

Everything comes from the repository's **Releases → Development build (latest
main)** page.

- **Windows:** download `…_x64-setup.exe` and run it. It isn't code-signed yet,
  so SmartScreen will warn: choose *More info → Run anyway*.
- **Linux:** `chmod +x Sheaf_*.AppImage && ./Sheaf_*.AppImage`, or
  `sudo apt install ./Sheaf_*_amd64.deb`.
- **Android:** open the release page on the phone, download
  `sheaf-android-universal.apk`, and allow your browser to install apps when
  asked. Play Protect may say the developer is unknown; choose *Install anyway*.
  New builds install over old ones because they share the development signing key.
- **iOS:** see below; iOS needs signing to install on a real device.

## Signing

### Android: development key (in place)

Release APKs are signed with a **development key**, so every CI build
installs over the previous one. It is not a Play Store upload key.

| Secret | Contents |
|---|---|
| `ANDROID_DEV_KEYSTORE_BASE64` | base64 of the PKCS12 keystore (alias `sheaf-dev`) |
| `ANDROID_DEV_KEYSTORE_PASSWORD` | its store and key password |

The keystore lives on the maintainer's machine in `%USERPROFILE%\.sheaf-signing\`,
**outside the repository**. If the secrets are missing (for example a pull
request from a fork), CI signs with a throwaway key so the APK still installs,
but it won't update over a development-signed install.

### iOS: to do, needs the owner's Apple Developer account

Today CI produces an **unsigned** IPA (for sideloading tools such as Sideloadly
or AltStore, which re-sign it with your Apple ID) and a **simulator** build. To
get installable, TestFlight-ready builds, the owner adds these secrets:

| Secret | Where it comes from |
|---|---|
| `APPLE_DEVELOPMENT_TEAM` | Apple Developer → Membership → Team ID |
| `APPLE_API_ISSUER`, `APPLE_API_KEY` | App Store Connect → Users and Access → Integrations → App Store Connect API (Issuer ID, Key ID) |
| `APPLE_API_KEY_P8_BASE64` | base64 of the downloaded `AuthKey_<KEYID>.p8` |

Once they exist, the iOS job switches to `tauri ios build --export-method app-store-connect`
with automatic signing, and adds a TestFlight upload step.

### Windows and Linux

Not code-signed yet. Windows signing (for example Azure Trusted Signing) is a
pre-release task, not a Phase 0 one.

## Building locally

```bash
pnpm install
pnpm dev                      # frontend only, in a browser (http://localhost:1420)
pnpm tauri dev                # desktop app with hot reload
pnpm tauri android dev        # Android emulator or USB device
pnpm tauri build              # desktop installers → target/release/bundle/
pnpm tauri android build --apk --target aarch64
pnpm check                    # everything CI's "checks" job runs
```

Prerequisites: Node ≥ 22.12, pnpm 10, Rust stable. On Windows, the Visual
Studio C++ Build Tools. For Android, the Android SDK, NDK 29 and a JDK 17+
(`JAVA_HOME`, `ANDROID_HOME` and `NDK_HOME` set). iOS builds need a Mac with Xcode.
