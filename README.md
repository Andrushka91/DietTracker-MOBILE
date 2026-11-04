# Diet Tracker — React Native (Android & iOS)

React Native port of the Windows Diet Tracker (WinUI 3 / .NET 10): same SQLite
schema and migration history, same Google Drive dataset — the same account sees
the same meals on Windows and on the phone. System dark/light theme, English only.

**At a glance:** Expo SDK 58 · React Native 0.88 · TypeScript · SQLite with 12
migrations (`user_version = 12`) · Drive `appDataFolder` sync · 37 test suites /
308 tests · package `com.diettracker.app` · version `1.0.0.1` (`versionCode 2`).

## Quick start

```bash
npm run emulator:apk
```

One command runs the whole pipeline after any change — no separate `npm install`,
`npm run apk`, `adb install` or `am start`.

| # | Step | What it runs |
|---|---|---|
| 1 | Toolchain | finds SDK / JDK / adb, exports `ANDROID_HOME`, `JAVA_HOME`, `PATH` |
| 2 | Packages | `npm install --no-audit --no-fund` + the autolinking drive-root fix → `npm-install.log` |
| 3 | Release | `scripts\build-apk.bat`: Gradle `assembleRelease` twice (universal, arm64-v8a) into `release\`, both checked for a fresh timestamp → `release-build.log` |
| 4 | Device | reuses a running emulator or phone, else boots AVD `Medium_Phone_API_37.0` (max 5 min) — and only continues once `adb get-state` plus a real shell round trip answer twice (a quick-boot snapshot restores `sys.boot_completed` *before* adbd reconnects) |
| 5 | Install | `adb install -r -d release\DietTracker-<version>-universal.apk` — a transport that drops right after the boot is waited for and the install is retried, the last attempt with `--no-streaming`. A PackageManager that never answers (the state a half-restored quick-boot snapshot brings back) is healed: `adb reboot`, and if that fails the AVD is stopped, its snapshot deleted and cold booted — the install then still happens |
| 6 | Launch | `am start -n com.diettracker.app/.MainActivity` |

* The **universal** APK runs on x86_64 emulators (an arm64 APK is refused with
  `INSTALL_FAILED_NO_MATCHING_ABIS`); **arm64-v8a** runs on phones. The version
  comes from `android/app/build.gradle`, so a bump needs no change here.
* `-r -d` **updates** the app and keeps its data (`--reset` wipes it first).
* The JavaScript is bundled inside the APK: no Metro, no dev menu — exactly what
  a sideloaded release gives a user.

Requirements: **Android SDK** (Android Studio) + **Node.js 22.11**. Flags go
after `--`: `npm run emulator:apk -- --reset --cold`.

| Variant | What it does |
|---|---|
| `npm run emulator:apk` · `npm run refresh` | all six steps (default after a change) |
| `npm run emulator:apk:only` | device → install → launch the APK already in `release\` |
| `npm run emulator:apk -- --skip-deps` | the same chain without `npm install` |
| `npm run dev` | debug build + Metro + hot reload on the emulator |

## Commands

| Script | Purpose | Needs |
|---|---|---|
| `npm start` | Expo dev server + QR code (phone via Expo Go) | — |
| `npm run dev` | boot/reuse the AVD, debug build, Metro, launch | Android SDK |
| `npm run dev:fast` | Metro + relaunch only (the JS/TS loop) | SDK + installed debug build |
| `npm run refresh:dev` | `npm install`, then the `npm run dev` sequence | Android SDK |
| `npm run apk` | both standalone release APKs into `release\` | Android SDK |
| `npm run emulator:apk` | `npm install` + both APKs + install + launch | Android SDK |
| `npm run emulator:apk:only` | install + launch the existing APK | SDK + `npm run apk` once |
| `npm run emulator` | start the AVD and wait for boot | Android SDK |
| `npm run emulator:stop` | graceful, snapshot-safe shutdown | Android SDK |
| `npm run check` | `typecheck` + `lint` + `test` | — |
| `npm run typecheck` · `lint` · `test` | individual checks | — |
| `npm run ios` | local iOS build (`expo run:ios`) | macOS + Xcode |
| `npm run generate` | re-embed migrations + English strings from the Windows sources | Windows repo next to this one |
| `npm run eas:login` · `eas:android:dev` | optional cloud build | free expo.dev account |

Nothing needs a global install: `expo`, `react-native`, `tsc`, `jest` and
`eslint` all resolve through these scripts.

## Phone testing with Expo Go

1. Node.js 22.11+, **Expo Go** on the phone, phone and computer on the same
   Wi-Fi (no guest network, no VPN).
2. `npm install` — once per machine.
3. `npm run check` — optional, must be green.
4. `npm start` — keep the terminal open; it prints a QR code.
5. Scan the QR with Expo Go. The app opens on **Today**: there is no sign-in
   wall, guest mode is fully functional, and the Google account is connected
   later from **Settings** (only needed for synchronization).
6. Edit a file → fast refresh; `r` reloads; `Ctrl+C` stops. Next session is just
   `npm start` — no build step and no APK.

Notes:

* `react-native-svg@15.16.0` draws the progress ring: a dev client or APK built
  before it was added must be rebuilt, or the ring fails to load its native view.
* **Google sign-in and cloud sync need the local build** (`npm run dev`): auth is
  native Google Identity Services (`modules/google-auth`), which Expo Go cannot
  host. Everything else runs in Expo Go on Android and iOS.
* Different networks? `npm start -- --tunnel` (accept the `@expo/ngrok` install).
* iOS: Expo Go from the App Store. A Mac/EAS build is only needed for native
  code outside Expo — there is none.
* Expo-Go-safe modules only: `expo-sqlite`, `expo-notifications`,
  `expo-secure-store`, `expo-file-system`, `expo-image-picker`,
  `expo-image-manipulator`, `expo-print`, plus `@react-native-community/netinfo`,
  `react-native-screens`, `react-native-safe-area-context`, React Navigation and
  `react-native-svg` — all verified against SDK 58's `bundledNativeModules.json`.

## Android emulator & release APKs

```bash
npm install            # once per machine
npm run emulator:apk   # npm install + both APKs + emulator + install + launch
npm run dev            # OR: debug build + Metro, hot reload while coding
npm run emulator:stop  # when done (never force-kill: it corrupts quick-boot snapshots)
```

`npm run dev` runs five steps: toolchain → device → `assembleDebug` **for the
target ABI only** (`x86_64` on the emulator, `arm64-v8a` on a phone, ~12-40 s) →
Metro in the same window → `adb reverse tcp:8081` plus the dev-client deep link,
so the app opens directly instead of the "Development servers" launcher. The full
Gradle output goes to `android-build.log`; failures print its last 40 lines.

After a change:

| Change | Command |
|---|---|
| JS/TS while developing | `npm run dev:fast` (Metro reload only, seconds) |
| sources, `package.json`, native code, `app.json` | `npm run emulator:apk` |
| nothing, the APK is already built | `npm run emulator:apk:only` |

Flags (after `--`):

| Flag | Effect |
|---|---|
| `--all` (alias `--refresh`) | `npm install` + both release APKs + install + launch |
| `--apk` | install/launch the APK already in `release\` |
| `--deps` · `--skip-deps` | include / leave out the `npm install` |
| `--emulator-only` | start the AVD and wait for boot |
| `--stop` | `adb emu kill`, waits for the emulator to disappear |
| `--cold` | cold boot (`-no-snapshot`) when a snapshot is corrupt |
| `--avd <name>` · `--device <serial>` | another AVD / a specific adb serial |
| `--port <n>` | Metro on another port (default 8081) |
| `--reset` | wipe the app data first (first-run state) |
| `--restart-adb` | `adb kill-server` first, when adb is wedged |
| `--verbose` · `--help` | stream the Gradle output / the full flag list |

Common failures — the script prints the exact fix:

| Symptom | What it reports |
|---|---|
| no SDK / JDK / AVD | the absolute path it looked for plus how to install it or set `ANDROID_HOME` / `JAVA_HOME` |
| emulator never boots | waits 5 min, then suggests `--cold` or Wipe Data |
| phone connected but not authorized | `FAIL <serial> is connected but not authorized` |
| Gradle error | last 40 lines of `android-build.log` + the retry command |
| port 8081 taken | `--port 8082` |
| adb hangs | every call is timeout-bounded; the script restarts adb itself |

**Windows long paths.** RN 0.88 codegen paths exceed the 260-character limit and
the SDK's ninja 1.10 refuses them. `scripts/ensure-ninja.ps1` (run by
`npm run dev` and `npm run apk`) upgrades `ninja.exe` to 1.12.1 and keeps a
backup, so Gradle, Metro and Android Studio work on the real folder — no `subst`
drive.

## Releasing — “same version”

Write **`same version`** and the round runs without touching any version number:

| Step | Command | Guard |
|---|---|---|
| 1 Verify | `npm run check` | green |
| 2 Bundle | `npm run apk` | both APKs rewritten in `release\` |
| 3 Commit | `git add -A && git commit -m "<what changed>"` | one English message, no `--amend` |
| 4 Push | `git push origin main` | `github.com/Andrushka91/DietTracker-MOBILE` |
| 5 Publish | `gh release upload v1.0.0.1 release\DietTracker-1.0.0.1-arm64-v8a.apk release\DietTracker-1.0.0.1-universal.apk --clobber` | the same `v1.0.0.1` release, assets replaced |
| 6 Report | APK names, sizes, SHA-256 (local + `gh release view v1.0.0.1 --json assets`) | digests match |

Rules: build **before** the commit (the commit holds the shipped code); build
logs stay untracked; nothing is force-pushed, no tag moves, existing assets are
replaced. A **new** version, tag and release only when the request says *new
version*. The version lives in `android/app/build.gradle`
(`versionName "1.0.0.1"`, `versionCode 2`); `app.json` keeps the three-part
`1.0.0` because iOS requires that form.

Artifacts: `release\DietTracker-1.0.0.1-arm64-v8a.apk` (~30 MB, modern phones)
and `release\DietTracker-1.0.0.1-universal.apk` (~85 MB, any ABI). The JS is
bundled (Hermes bytecode) and the APK is signed with the standard **Android debug
key** (`signingConfig signingConfigs.debug`) — fine for sideloading and updates
with the same key; a Play Store upload needs its own keystore.

## Google client configuration

* `google-client.json` (committed with placeholders): `androidClientId`, optional
  `webClientId` / `iosClientId`. **No secret exists** in the mobile flow: the
  Android OAuth client is a native (RFC 8252) registration identified by package
  name + SHA-1. Sign-in fails fast with `Auth_google_not_configured` while the id
  is empty; guest mode works fully without it.
* Sign-in is native Google Identity Services: `modules/google-auth` (Kotlin)
  wraps `AuthorizationClient` (`play-services-auth`). Tokens renew **silently**
  while the saved grant covers the scopes, so background sync never opens login
  UI and reports `AuthenticationRequired` instead (local records are never
  deleted). Identity (sub / email / name) comes from the OIDC userinfo endpoint.
* Only the `drive.appdata` scope is requested — the app never sees other Drive
  files.
* iOS sign-in is future work: without `iosClientId` it fails fast.

## Architecture

```
src/
  domain/     pure rules ported 1:1 from DietTracker.Core (no React Native imports):
              enums, models, completion/slot/photo/copy/content/frequency rules,
              validators, analytics, JSON envelope + payload codecs, hashing
  data/       expo-sqlite: connection, 12 migrations, repositories, photo store
              (files + 256 px thumbnails), .dtbackup, integrity check
  cloud/      Google auth (native GIS + secure-store), Drive v3 provider (flat
              "__" names in appDataFolder, identical to Windows), durable outbox,
              sync engine (push/pull, echo suppression, conflicts, tombstones,
              backoff), account session lifecycle
  services/   bootstrap, meal tracking facade, reminders, connectivity, device id
  ui/         theme (single source), app context, shell, components, screens:
              Dashboard, Calendar, Statistics, Templates, Settings
```

* **Parity generators** — `scripts/generate.js` copies byte-for-byte:
  `src/data/migrations/*.sql` → `src/data/sql/migrations.generated.ts` (from
  `src/DietTracker.Infrastructure/Database/Migrations`, `user_version = 12`) and
  `Resources.resw` → `src/ui/strings.generated.ts` (255 English strings with
  `{0}` formatting). Re-run after refreshing either source; never renumber or
  reorder migrations.
* **Upload** (`uploadOutbox`): the coalesced outbox is the source of truth; one
  folder listing per pass builds the `path → id` index; 6 parallel requests; each
  document settles alone (success leaves the outbox, failure records backoff);
  the push phase is serialized process-wide; SQLite transactions are queued so
  the database keeps one writer.
* **Download** (`pullChanges` + `src/cloud/parallel.ts`): a bounded window of 8
  prefetched downloads; the apply order is untouched (foreign keys, retry
  watermark); failures stay at their own position; a photo's bytes start with its
  metadata; the identity is cached per pull; one folder listing per cycle, shared
  with the push (snapshot taken before it).
* **Account boundary is symmetric** — signing in and out both block on the same
  determinate bar (`preparing → uploading → downloading → finishing`, with
  `mode: 'signIn' | 'signOut'`). Sign-in budget 90 s; sign-out budget 30 s,
  ignores the backoff window, retries only empty rounds, and is **refused**
  (cache kept) when changes still cannot be synced.
* `android/` comes from `npx expo prebuild`; the pre-Expo native folders are kept
  in `.native-backup-android/` and `.native-backup-ios/`.


## Design system

| What | Where |
|---|---|
| Colours (light/dark), state colours, radii, spacing, type scale, elevation | `src/ui/theme.ts` (`themeColors`, `metrics`, `typeScale`, `pageTitleStyle`, `cardShadow`, `raisedShadow`) |
| Icons — Ionicons, with documented Feather / MaterialCommunityIcons exceptions | `src/ui/components/icons.tsx` |
| Dialogs — one bottom sheet plus one centered card surface | `src/ui/components/dialogs.tsx` |

Rules: cards are lighter than the page and lifted by `cardShadow`; indigo is the
only interactive colour; the three state colours mean the same thing everywhere
and are always repeated in words, never colour alone. `MealCategory.Icon` stays
data (Windows draws it); the phone uses `src/ui/mealGlyphs.ts`. Open Sans is
bundled, sizes follow the iOS text styles, and there is no app bar
(`headerShown: false`) — every page draws its own heading.

Layout facts worth knowing:

* **Settings** — grouped white cards (16 pt corners, 1 pt frame, 16 pt gutter),
  11 pt caps captions, compact **44 pt rows (54 pt with a detail line)**, a 22 pt
  glyph in a 24 pt column, and ONE 1 pt divider between rows that spans the
  **full card width**, drawn in `cardDivider` at ~85 %. The sync row carries a
  **32 pt pale-indigo “Sync now” pill** (12 pt corners, 6 pt hitSlop → 44 pt
  target).
* **Templates** — compact cards with a “Meal preview” accordion and one
  full-width **Apply to date** button; a template carries no state or photos.
  Applying opens the **compact date sheet** (`PromptDialog`'s opt-in
  `layout: 'template-date'`): the reference's header — a 40 pt pale-indigo
  calendar tile, the bold **Apply template** title with the real template summary
  (`30 October 2026 · 5 meals`) stacked under it, and the close X — then a
  “Date to apply” label with a **Today** shortcut (fills the field only),
  a 48 pt outlined date field with its `YYYY-MM-DD` hint (replaced in place by the
  validation error), and a 1 : 1.8 **Cancel / Apply template** pair that stacks at
  full width below 350 dp or above a 1.15 font scale.
* **Calendar** — month grid with five state dots per recorded day plus a key, day
  rows under the grid, “Open day” as a 36 pt capsule, today = hollow accent ring,
  selected day = accent fill.
* **Statistics** — one primary measure plus an interactive breakdown; slot counts
  as glyph + bold number + label in three columns.
* **Dashboard** — a day header CARD (14 dp inset, 1 pt frame) holding: the date
  navigation (44 pt arrows, 20 pt bold date, 11 pt neutral year), an **80 dp
  ring with an 8 pt stroke at the LEFT** and, at its right, ONE tinted strip with
  **Done | Missed | Pending as three equal columns** (16 pt glyph + 22 pt bold
  value above a 12 pt label, two 1 × 32 pt rules, 64 dp minimum, 12 pt corners);
  then two **44 pt outlined** bulk buttons (state glyph, neutral label, 10 dp
  apart) and the conditional Save-all row. The current day is marked **without
  any word**: a static 6 dp indigo dot, a pale-indigo date badge and indigo date
  ink (year stays neutral) — every other day is plain and shows a 44 pt
  icon-only return-to-current-day shortcut. Below 340 dp / above 1.4 font scale
  the strip stacks into full-width rows; below 350 dp / above 1.2 the actions
  stack. Then five permanent meal cards, one fixed entry per category: a compact
  header (36 pt glyph tile, 16 pt category over a 12 pt time, an 11 pt badge whose
  glyph is a clock / ✓ / ✕), the meal text on the LEFT with the SAME horizontal
  strip of up to three **48 pt / 8 pt-corner / 4 pt-apart** thumbnails on the
  RIGHT (the strip only drops below the text when the row would leave the text
  under 120 pt, or above 1.4 font scale), one 1 pt rule inset 14 pt from both
  edges, and a nearly-white toolbar of five **44 pt pressables holding 36 pt
  outlined tiles**. An inline editor replaces the toolbar (whose single divider
  sits one strip padding, 10 pt, from the ✕); up to three 48 pt photos per meal
  and a full-screen viewer with paging/zoom.
* **Tab bar** — **docked** (a normal sibling under the pages: full width, no side
  insets, no shadow, its surface covering the bottom safe area). `src/ui/tabBar.ts`
  is the one source of truth: `TAB_BAR_CONTENT_HEIGHT` (68 = 6 pt top air + 2 × 5
  pt tab padding + a 52 pt tab), `TAB_BAR_CONTENT_GAP` (18) and
  `tabBarHeight(inset)`. Pages only pad their scroll content with
  `TAB_BAR_CONTENT_GAP`, because the navigator already reserves the bar's height.
* **Launcher icon** — `scripts/make-icons.py` derives every Android asset from
  the Windows `DietTracker.ico`.
* Screenshots are not committed; `__tests__/` and the token table are the record
  of the look.

## Tests & status

* `npm run check` is green: strict TypeScript + ESLint, **37 suites / 308
  tests**. They cover the domain rules and validators, photo rules, DST-safe
  calendar stepping, sync frequency and backoff, payload/envelope round-trips,
  Drive addressing, the string table, the weekday bitmask, the sign-in and
  sign-out barriers, the upload and download pipelines, the docked tab-bar
  geometry for six device insets, and every screen.
* Verified on the local Android emulator (API 37, x86_64 release APK): first
  launch straight into the dashboard (no sign-in wall), guest mode, the five
  permanent cards, one-tap save with the keyboard open, DONE / MISSED, templates,
  calendar, statistics, settings (storage, database path, integrity check), the
  system photo picker and automatic dark mode.
* Honest limits: the Drive paths have **not** been exercised against a real
  account (that needs a client registration and a human consent); iOS sign-in is
  future work; Expo Go cannot run sign-in.
* Deliberate deviations: reminders ship in **parity mode** (schema + scheduler +
  notification actions, no per-slot settings until Windows has it); PDF exports
  only surface the status flow (`expo-print` is not wired); “Start at boot” and
  the tray toggles are hidden while the 12-hour clock toggle is live; “Apply to
  date” uses a masked `yyyy-MM-dd` prompt and “Save day as template” an empty
  name prompt — both validated and tested.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Scan fails / cannot connect | same Wi-Fi (no guest network), VPN off, server running, Node.js allowed in Windows Firewall — or `npm start -- --tunnel` |
| “This project uses SDK 58, but Expo Go is running SDK …” | update Expo Go from the store |
| `setNotificationChannelAsync … NullPointerException` | some Expo Go Android builds reject native channel creation; the app is best-effort and reminders still fire |
| `[auth] Google client not configured` | expected while `google-client.json` ids are empty; guest mode works |
| Cold start shows the “Development Build” launcher | dev-client screen: `npm run dev` skips it, or tap **Diet Tracker** |
| `Unable to open exp://…` | no dev server — run `npm start` |
| `EADDRINUSE :::8081` | free the port (`Get-NetTCPConnection -LocalPort 8081 -State Listen \| ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }` on Windows, `lsof -ti :8081 \| xargs kill -9` elsewhere) or `npm run dev -- --port 8082` |
| `adb install … device offline` / `failed to run abb_exec` | the AVD restored a quick-boot snapshot and adbd reconnected in the middle of the install. The script now waits for two shell round trips before installing and retries (3rd try `--no-streaming`); if it still fails: `npm run emulator:stop`, then `npm run emulator:apk -- --cold` |
| `the package manager … does not answer` (`pm path android` times out) | the quick-boot snapshot came back half-restored: `sys.boot_completed` says 1 while `pm` / `am` hang. The script reboots Android inside the emulator, and if that does not help it stops the AVD, deletes its broken snapshot and cold boots it, so the install still runs. Manual fix: `npm run emulator:stop`, then `npm run emulator:apk -- --cold`; if even that fails, **Wipe Data** in Device Manager once |
| Blue screen “Base module not found” | historical `op-sqlite` error; the app now uses Expo-Go-safe modules only — restart Expo Go and rescan |

