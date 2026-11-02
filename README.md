# Diet Tracker — React Native (Android & iOS)

React Native port of the Windows Diet Tracker (WinUI 3 / .NET 10), built from
[PROMPT_SPEC.md](./PROMPT_SPEC.md). Same SQLite schema, same migration history,
same Google Drive dataset — a user signed into the same Google account sees the
same meals on Windows and on their phone. The app follows the system
dark/light theme automatically and ships English only.

## ⚡ Quick start — one command, six steps

```bash
npm run emulator:apk
```

**That is the whole pipeline after any change:** no separate `npm install`, no
`npm run apk`, no `adb install`, no `am start`. The script prints every step it
runs, and fails with the exact command that fixes the step that broke:

| # | Step | What the script actually runs | Log / what it prints |
|---|---|---|---|
| 1 | **Toolchain** | finds the Android SDK, the JDK and `adb`, then exports `ANDROID_HOME`, `JAVA_HOME` and the `PATH` every later command uses | the three absolute paths — or the exact command that installs the missing piece |
| 2 | **Packages** | `npm install --no-audit --no-fund`, then re-applies the expo-autolinking drive-root fix | `npm-install.log` — `OK npm install 1 s - dependencies up to date` |
| 3 | **Release** | `scripts\build-apk.bat`: Gradle `assembleRelease` twice (universal, then arm64-v8a), both copied to `release\`, then **both files are checked for a fresh timestamp** | `release-build.log` — sizes and version of both APKs |
| 4 | **Device** | reuses a running emulator or a connected phone, else boots the AVD `Medium_Phone_API_37.0` and waits (max 5 min) for `sys.boot_completed` | live `booting ... 4 s` line · `--cold`, `--avd <name>`, `--device <serial>` |
| 5 | **Install** | `adb install -r -d release\DietTracker-<version>-universal.apk` | `INSTALL_FAILED_*` → the one command that fixes it |
| 6 | **Launch** | `am start -n com.diettracker.app/.MainActivity` | the app's PID |

A real run on this machine:

```
Diet Tracker - Android dev session (6 steps)
  project D:\PROGRAMMING\REACT_NATIVE\DIET TRACKER
[1/6] Toolchain   OK    SDK C:\Users\<you>\AppData\Local\Android\Sdk
       JDK C:\Program Files\Eclipse Adoptium\jdk-21.0.13.9-hotspot\   adb ...\platform-tools\adb.exe
[2/6] Packages    OK    npm install 1 s - dependencies up to date
[3/6] Release     ..........OK    1 m 12 s - DietTracker-1.0.0.1-universal.apk 83.7 MB  +  DietTracker-1.0.0.1-arm64-v8a.apk 29 MB (version 1.0.0.1)
[4/6] Device      OK    emulator-5554 (Medium_Phone_API_37.0) - booted in 4 s
[5/6] Install     OK    DietTracker-1.0.0.1-universal.apk (83.7 MB, x86_64, version 1.0.0.1) installed
[6/6] Launch      OK    com.diettracker.app (pid 13289) started from the release APK

Ready - the release build runs on emulator-5554.
       this is the APK from the release page: bundled JavaScript, no Metro, no dev menu
```

Three details the steps hide:

* **Which APK** — `universal` on an x86_64 emulator (an arm64 APK is refused with
  `INSTALL_FAILED_NO_MATCHING_ABIS`), `arm64-v8a` on a phone. The version comes
  from `android/app/build.gradle`, so a version bump needs no change here.
* **It updates, never replaces** — `adb install -r -d` keeps the app's data; a
  signature clash prints the one `adb uninstall` line that fixes it. `--reset`
  wipes the data first for a true first-run check.
* **No Metro, no dev menu** — the JavaScript is bundled inside the APK, so this is
  exactly what a user gets after sideloading the download.

Requirements: the **Android SDK** (Android Studio) and Node.js 22.11 — nothing
else: no Metro, no Expo Go, no cable. Flags reach the script after `--`:
`npm run emulator:apk -- --reset --cold`.

| Variant | Difference |
|---|---|
| **`npm run emulator:apk`** | all six steps — the default after any change |
| `npm run refresh` | alias, the identical `--all` sequence |
| `npm run emulator:apk:only` (`--apk`) | 4 steps — device, install, launch on the APK already in `release\` (no npm install, no Gradle) |
| `npm run emulator:apk -- --skip-deps` | 5 steps — the same chain without the `npm install` |

| I want to… | Command |
|---|---|
| **Everything after a change** (npm install + both APKs + install + app) | **`npm run emulator:apk`** |
| Same thing (alias, identical sequence) | `npm run refresh` |
| Re-install the APK already in `release\` (no npm install, no build) | `npm run emulator:apk:only` |
| **Develop** with hot reload on the emulator (builds a debug APK + Metro) | `npm run dev` |
| Develop from my **phone** with Expo Go and a QR code (no SDK, no APK) | `npm start` |
| Rebuild the two release APKs only | `npm run apk` |
| Stop the emulator gracefully (snapshot-safe) | `npm run emulator:stop` |

Full details, flags and troubleshooting: [Local Android emulator](#local-android-emulator-android-studio-sdk).

## Install and run — step by step

> **Work inside this folder** (`react-native/`). The `package.json` in the
> repository root belongs to the Windows app — every command below is run in
> *this* directory.

### 1. Prerequisites

| Requirement | Check / get it |
|---|---|
| Node.js 22.11+ | `node -v` — install from [nodejs.org](https://nodejs.org) if missing |
| **Expo Go** on your phone | [Google Play](https://play.google.com/store/apps/details?id=host.exp.exponent) or the iOS App Store |
| Same Wi-Fi network | phone and this computer on one network (no guest network, no VPN) |

No Android SDK, no Xcode, no Java, no APK — Expo Go is the whole toolchain.
(Only the two emulator commands, `npm run dev` and `npm run emulator:apk`, need
the Android SDK; both are described at the top of this file.)

### 2. Install the dependencies (once per machine)

```bash
cd react-native        # from the repository root
npm install            # installs everything from package-lock.json
```

### 3. Sanity check (once — optional but recommended)

```bash
npm run check          # typecheck + lint + 99 unit tests — must be green
```

### 4. Start the dev server

```bash
npm start
```

Leave this terminal open — it prints a **QR code** and keeps serving the app
(first start takes ~10–30 seconds).

### 5. Open the app on your phone

1. Unlock the phone and open **Expo Go**.
2. Tap the scan icon (or just point the phone camera at the terminal) so it
   scans the **QR code**.
3. The JS bundle downloads (first time: a few seconds) and the app opens
   straight on **Today** — you are in. There is no sign-in wall: guest mode is
   fully functional, and the Google account is connected later from **Settings**
   (only needed for synchronization).

Expected path, step by step: QR → loading spinner → the five meal cards of the
Today tab.

### 6. Everyday workflow

* Edit any file → the phone updates instantly (fast refresh).
* Press `r` in the terminal → manual reload. `Ctrl+C` → stop the server.
* Next session: just `npm start` again — there is **no build step and no
  APK**; JS/TS changes are live on save.
* An APK is only needed if you ever add a library *outside* Expo
  (`npm run eas:android:dev`) — there are currently none.
* Prefer the **real Android emulator** instead of Expo Go? One command does the
  whole thing (boot, build, install, Metro, open the app): `npm run dev` — see
  [Local Android emulator](#local-android-emulator-android-studio-sdk).
* Want to see the **released build** instead (bundled JavaScript, no Metro, no
  dev menu — what the download page ships)? `npm run emulator:apk` runs the whole
  chain for that build: `npm install`, both release APKs, the emulator, the
  install and the launch.

Something not working? Jump to [Troubleshooting](#troubleshooting).

### All npm scripts

| Script | What it does | Extra requirements |
|---|---|---|
| `npm start` | **Expo dev server that prints a QR code — the phone-testing command** | — |
| `npm run eas:login` | Log in to your Expo account (optional — only for cloud builds) | free account at [expo.dev](https://expo.dev) |
| `npm run eas:android:dev` | Optional cloud build of a standalone APK (Expo Go is the default) | after `eas:login` |
| `npm run check` | `typecheck` + `lint` + `test` in one go | — |
| `npm test` · `npm run lint` · `npm run typecheck` | Individual checks | — |
| `npm run start:rn` | removed — `npm start` is the Metro command | — |
| `npm run dev` | **The emulator command**: reuses/boots the AVD, builds + installs for the device ABI, starts Metro in this window, opens the app | Android SDK |
| `npm run dev:fast` | Same session without Gradle (Metro + relaunch) — for JS/TS changes | Android SDK + an installed debug build |
| `npm run apk` | **Standalone release APKs** (JavaScript bundled, no Metro) into `release\` | Android SDK |
| `npm run refresh` | Identical to `npm run emulator:apk` (same npm install → APKs → emulator → install → launch sequence, second name) | Android SDK |
| `npm run refresh:dev` | `npm install`, then a debug build + Metro + launch (a dev session that also picks up newly added packages) | Android SDK |
| `npm run emulator` | Start the AVD and wait until Android is booted (no build, no Metro) | Android SDK |
| **`npm run emulator:apk`** | **One command, the whole chain**: `npm install` → rebuild **both** release APKs → boot/reuse the AVD → install the APK → launch the app. No Metro | Android SDK |
| `npm run emulator:apk:only` | Re-install the APK already in `release\` and launch it — no npm install, no Gradle, no Metro | Android SDK + `npm run apk` once |
| `npm run emulator:stop` | Gracefully stop the emulator (snapshot-safe `adb emu kill`) | Android SDK |
| `npm run ios` | Local build + install (`expo run:ios`) | macOS + Xcode |
| `npm run generate` | Re-embed migrations + English strings from the Windows sources | Windows repo one level up |

Nothing requires a global install — `expo`, `eas-cli`, `react-native`,
`tsc`, `jest` and `eslint` are all resolved through these scripts.

> **Expo Go is the default way onto a phone** — every native module the app
> uses ships inside Expo Go (see the next section). `npm run dev` /
> `npm run ios` are **local** builds; Android needs the Android SDK (this
> machine has it, see *Local Android emulator* below), iOS needs Xcode.

## Design system (tokens, icons, screenshots)

The whole look comes from **one token file** and **one icon component**, so a
visual change never touches logic, navigation or data:

| What | Where |
|---|---|
| Colours (light + dark), state colours, radii, spacing, text scale, elevation | `src/ui/theme.ts` (`themeColors`, `metrics`, `typeScale`, `pageTitleStyle`, `cardShadow`, `raisedShadow`) |
| Icons — one family for tabs, actions, pills and chrome | `src/ui/components/icons.tsx` (`Ionicons` from the Expo-pinned `@expo/vector-icons`) |
| Dialogs — one bottom-sheet surface (grabber, title + X, icon rows) | `src/ui/components/dialogs.tsx` (`DialogSheet`, `SheetRow`) |

Rules that keep it coherent: cards are always lighter than the page and lifted by
`cardShadow`; the accent (indigo) is the only interactive colour; the three state
colours mean the same everywhere and are always repeated in words, never colour
alone. Meal-category emoji come from `MealCategory.Icon` in SQLite and are **data**,
not design.

The visual refresh is documented (and reversible) on the
`redesign/visual-refresh-20261101` branch (first pass) and the
`redesign/visual-refresh-20261101-r2` branch (second pass: state rail instead of
framed cards, reworked header/calendar/statistics, readable contrast, 44 pt
targets, large-text fixes). The rollback point is the
`backup/pre-redesign-20261101-2126` tag and its GitHub release.

Round 3 (`redesign/ui-r3-20261102`) builds on that: a compact two-line day header
with one completion summary and evenly aligned counts, photos as one horizontal
row of 48 pt thumbnails beside the meal text, a full-screen viewer with paging,
pinch/double-tap zoom and a confirmed remove action, a month board with five
meal-state marks per recorded day, a statistics page with ONE primary measure
(Done / all planned slots) plus an interactive breakdown, and a grouped Settings
page. Its rollback point is the `backup/pre-redesign-r3-20261102-1244` tag and its
GitHub release.

The design rounds' screenshot archives were removed from the repository to keep
it lean; the code, the token table above and the tests are the record of the
final look (every screen is covered by `__tests__/`, and the emulator run is
described in the release notes).

## Standalone release APK

`npm run apk` builds what you install on a phone **without** a development server:

| Artifact | Size | For |
|---|---|---|
| `release\DietTracker-1.0.0.1-arm64-v8a.apk` | ~29 MB | every modern phone (64-bit ARM) |
| `release\DietTracker-1.0.0.1-universal.apk` | ~84 MB | any device, including 32-bit ARM and x86 emulators |

The JavaScript is bundled inside the APK (Hermes bytecode, ~3.2 MB), so the app starts on its own -
no Metro, no USB cable, no Expo Go. The release variant is signed with the standard **Android debug
key** (`android/app/build.gradle`, `signingConfig signingConfigs.debug`): that is what makes
sideloading work, and it can update a build that was signed with the same key. A Google Play upload
needs its own keystore.

The version comes from `android/app/build.gradle` (`versionName "1.0.0.1"`, `versionCode 2`), which is
the identity the release is tagged with. `app.json` deliberately keeps the three-part `1.0.0`, because
iOS requires `CFBundleShortVersionString` in that form and `expo prebuild` would otherwise overwrite
the Android version with it.

Install: copy the APK to the phone, open it, allow *install unknown apps* for the app you opened it
from, and confirm. On a connected device the same thing is
`adb install -r release\DietTracker-1.0.0.1-arm64-v8a.apk`.

## Keyword: **“same version”** — commit, push, deploy APK

Write **`same version`** (or *“push commit on same version, deploy apk on same version”*)
and the whole release round runs, with **no version bump anywhere**:

| Step | Command | Guard |
|---|---|---|
| 1. Verify | `npm run check` (`tsc --noEmit` + `eslint .` + `jest`) | must be green; 0 errors, tests all passing |
| 2. Bundle both APKs | `npm run apk` (`scripts\build-apk.bat`) | rewrites `release\DietTracker-1.0.0.1-arm64-v8a.apk` + `-universal.apk` |
| 3. Commit | `git add -A` + `git commit -m "<what changed>"` (one message in English, no `--amend`) | working tree of the previous round is clean |
| 4. Push | `git push origin main` | remote `https://github.com/Andrushka91/DietTracker-MOBILE.git` |
| 5. **Publish on the release page** | `gh release upload v1.0.0.1 release\DietTracker-1.0.0.1-arm64-v8a.apk release\DietTracker-1.0.0.1-universal.apk --clobber` | the SAME `v1.0.0.1` release is reused, its two assets are replaced |
| 6. Report | APK names, sizes, SHA-256 (local `sha256sum` **and** the asset digest from `gh release view v1.0.0.1 --json assets`) | the digests must match |

Rules that make this reproducible:

* **Steps 2 and 5 always run together.** A build that only sits in `release\`
  is not a release: the APKs are uploaded to the `v1.0.0.1` release with
  `--clobber`, which replaces the previous files of the same name
  ([releases/tag/v1.0.0.1](https://github.com/Andrushka91/DietTracker-MOBILE/releases/tag/v1.0.0.1)).
* **The version never changes in this flow.** `android/app/build.gradle`
  (`versionName "1.0.0.1"`, `versionCode 2`) and `app.json` (`version: "1.0.0"`)
  stay exactly as they are — the new APKs replace the previous files of the
  same name on disk and on the release page, and `adb install -r` /
  sideloading updates the installed app because the debug key is unchanged.
* A **new** version (`1.0.0.1`, `versionCode 2`, …) is only ever produced when
  the request explicitly says *new version* — that is also the only case where
  a new tag and a new release are created (`git tag v1.0.0.1` +
  `gh release create v1.0.0.1 …`).
* The build is done **before** the commit, so the commit contains the code the
  shipped APK was built from. Build logs (`release-build.log`,
  `android-build.log`) stay untracked.
* Nothing is force-pushed, no tag is moved, no history is rewritten; existing
  release assets are replaced, never the release itself.

Expected artifacts after a run (both on disk and on the release page):

| File | ~Size | Local SHA-256 |
|---|---|---|
| `release\DietTracker-1.0.0.1-arm64-v8a.apk` | 30 MB | `c0c74efb…e93f44c8` (1.0.0.1 / 2026-11-01, parallel sync) |
| `release\DietTracker-1.0.0.1-universal.apk` | 88 MB | `997f8fa2…49f9e60b` (1.0.0.1 / 2026-11-01, parallel sync) |


## Local Android emulator (Android Studio SDK)

The debug APK is built and installed locally, so the app runs on the AVD
without Expo Go.

### One command per testing session

```bash
npm install                # once per machine — npm run emulator:apk does it as well
npm run emulator:apk       # the whole chain: npm install + both APKs + emulator + install + app
npm run dev                # OR: debug build + Metro, for hot reload while coding
npm run emulator:stop      # when done: graceful, snapshot-safe shutdown
```

### The APK users download — `npm run emulator:apk:only`

`npm run apk` builds the standalone APKs into `release\`;
`npm run emulator:apk:only` (`--apk`) installs the one that is already there and
starts it, exactly as a user would experience the download — no `npm install`, no
Gradle, no Metro:

```
[1/4] Toolchain   OK    SDK C:\Users\<you>\AppData\Local\Android\Sdk
[2/4] Device      OK    emulator-5554 (Medium_Phone_API_37.0) - already running
[3/4] Install     OK    DietTracker-1.0.0.1-universal.apk (83.7 MB, x86_64, version 1.0.0.1) installed
[4/4] Launch      OK    com.diettracker.app (pid 13112) started from the release APK

Ready - the release build runs on emulator-5554.
       this is the APK from the release page: bundled JavaScript, no Metro, no dev menu
       npm run emulator:stop   shut the emulator down gracefully (snapshot-safe)
```

What it does, and why it is a separate command from the full `npm run emulator:apk`:

* **The emulator is booted or reused for you** — the same device step (`--avd`,
  `--device`, `--cold`, a still-booting serial is waited for) as `npm run dev`.
* **It installs `release\DietTracker-<version>-*.apk`**, picking the file the
  device can actually run: the **universal** APK on an x86_64 emulator (the
  arm64 build is refused with `INSTALL_FAILED_NO_MATCHING_ABIS`), the arm64 one
  on an arm64 phone. The version comes from `android/app/build.gradle`, so a
  version bump needs no change here.
* **No Metro and no dev client**: the JavaScript is bundled inside the APK, so
  the app is opened with a plain `am start` and has no reload/dev menu — this is
  the build the release page ships. `--reset` clears the data first for a
  first-run check.
* **It updates instead of replacing**: the release APK is signed with the same
  debug key, so `adb install -r -d` keeps the app's data (a signature mismatch
  prints the one `adb uninstall` line that fixes it).

### After a change — `npm run emulator:apk`

It is the same command in every case, and it covers all four things you would
otherwise type by hand (`npm install`, `npm run apk`, install, launch):

| What you changed | Command | What runs |
|---|---|---|
| JS/TS under `src\`, while developing | `npm run dev:fast` | Metro reload only — seconds |
| anywhere in the sources | **`npm run emulator:apk`** | `npm install` → `build-apk.bat` (both release APKs) → install → launch |
| `package.json` / a newly added package | **`npm run emulator:apk`** | the same — the dependency step installs it |
| native code / `app.json` | **`npm run emulator:apk`** | the same (Gradle recompiles the native part) |
| nothing, APK already built | `npm run emulator:apk:only` | install + launch the APK already in `release\` |

```
[2/6] Packages    OK    npm install 1 s - dependencies up to date
[3/6] Release     ..........OK    1 m 12 s - DietTracker-1.0.0.1-universal.apk 83.7 MB  +  DietTracker-1.0.0.1-arm64-v8a.apk 29 MB (version 1.0.0.1)
[5/6] Install     OK    DietTracker-1.0.0.1-universal.apk (83.7 MB, x86_64, version 1.0.0.1) installed
[6/6] Launch      OK    com.diettracker.app (pid 13886) started from the release APK
```

* **Packages** — a plain `npm install` (`--no-audit --no-fund`): a second when
  nothing changed, the real install after a dependency edit. Output:
  `npm-install.log`; the autolinking drive-root fix is re-applied right after it.
  `--skip-deps` leaves this step out.
* **Release** — `scripts\build-apk.bat`: the same two Gradle release builds
  `npm run apk` runs. Both files are then checked for a fresh timestamp, so a
  bundle that silently failed can never be installed as "the new build".
  Output: `release-build.log` (dots are progress, `--verbose` streams it).
* **Install / Launch** — the **universal** APK on the x86_64 emulator,
  `adb install -r -d`, then `am start`. No Metro, no dev menu.

`npm run refresh` is the same sequence (`--all`) under a second name, and
`npm run refresh:dev` (`--deps`) is that dependency step followed by the
`npm run dev` sequence (debug build + Metro + hot reload) — the right one when
you added a package and want to keep developing.

`npm run dev` (`scripts/dev.js`) is the whole flow in one readable sequence —
every step prints the value it used, or the exact command that fixes it:

```
[1/5] Toolchain   OK    SDK C:\Users\<you>\AppData\Local\Android\Sdk
       JDK C:\Program Files\Android\Android Studio\jbr   adb ...\platform-tools\adb.exe
[2/5] Device      OK    emulator-5554 (sdk_gphone64_x86_64, Android 17) - already running
[3/5] Build       .....OK    38 s - app-debug.apk 74.5 MB (x86_64) installed
[4/5] Metro       OK    listening on http://localhost:8081 - bundling errors show up here
[5/5] Launch      OK    com.diettracker.app started

Ready - com.diettracker.app runs on emulator-5554.
```

What it does for you:

* **Device** — reuses a running emulator, or a phone that is connected, and only
  boots the AVD when neither exists (live `booting ... 24 s` line, AVD window
  stays open). A serial that is still booting is waited for instead of starting
  a second emulator.
* **Build** — `gradle assembleDebug` **for the target ABI only** (`x86_64` on the
  emulator, `arm64-v8a` on a phone): ~12-40 s instead of minutes, 74 MB instead
  of 215 MB, then `adb install -r -d`. The full Gradle output still goes to
  `android-build.log`; the console shows a compact progress line and, on
  failure, the last 40 log lines. `npm run dev -- --verbose` streams everything.
* **Metro** — started in **this window** (`expo start --dev-client`), so
  `r` (reload), `j` (debugger) and red bundling errors work; if a Metro is
  already answering on the port, it is reused instead of starting a second one.
* **Launch** — `adb reverse tcp:8081`, then the app is opened through the
  dev-client deep link (`diettracker://expo-development-client/?url=…`) so it
  goes straight into the app instead of the "Development servers" launcher.

End a session with `Ctrl+C` in that window (stops Metro, keeps the emulator) and
then `npm run emulator:stop` — never force-kill the emulator, that is what
corrupts quick-boot snapshots.

### Flags

| Flag | What it changes |
|---|---|
| `npm run dev:fast` | `--skip-build`: Metro + relaunch only — the loop for JS/TS changes |
| `npm run emulator:apk` · `npm run refresh` | `--all` (alias `--refresh`): `npm install` + both release APKs + install + launch (implies `--apk` and `--deps`) |
| `npm run emulator:apk:only` | `--apk`: install the APK already in `release\` and launch it (no npm install, no build, no Metro) |
| `npm run refresh:dev` | `--deps`: `npm install` first, then the normal dev sequence |
| `--skip-deps` | leave the `npm install` out of `--all` / `--deps` |
| `npm run emulator` | `--emulator-only`: just start the AVD and wait for boot |
| `npm run emulator:stop` | `--stop`: `adb emu kill`, waits for the emulator to disappear |
| `--cold` | cold boot (`-no-snapshot`) when a saved snapshot is corrupt |
| `--avd <name>` | start another AVD (default `Medium_Phone_API_37.0`, else the first) |
| `--device <serial>` | target a specific `adb` serial (e.g. a USB phone) |
| `--port <n>` | Metro on another port (default 8081) |
| `--reset` | wipe the app data first (first-run state) |
| `--restart-adb` | `adb kill-server` first, when adb itself is wedged |
| `--verbose` · `--help` | stream the Gradle output · the full flag list |

Anything after `--` reaches the script: `npm run dev -- --cold --reset`.

### When something goes wrong

| Symptom | What the script says / does |
|---|---|
| No Android SDK | `FAIL adb was not found in the Android SDK (…)` + how to install it or set `ANDROID_HOME` |
| No JDK | `FAIL no JDK found for Gradle` + `set JAVA_HOME=…\Android Studio\jbr` |
| No AVD defined | `FAIL no Android Virtual Device (AVD) is defined` + Device Manager hint |
| Emulator never boots | waits 5 min, then suggests `npm run dev -- --cold` / Wipe Data |
| Phone prompts for debugging | `FAIL <serial> is connected but not authorized` |
| Gradle error | the last 40 lines of `android-build.log` + the exact retry command |
| Port 8081 taken | `FAIL port 8081 is used by something that is not Metro` + `--port 8082` |
| adb hangs (zombie server) | every adb call has a timeout; the script restarts adb itself (`kill-server` → `taskkill /F /IM adb.exe` on Windows) and only fails if that does not help |

Metro can still be started on its own (`npm start`) — `npm run dev` then reuses
it, or attaches with `adb reverse tcp:8081 tcp:8081`. `expo run:android` /
`expo run:ios` remain available for one-off native builds, but the emulator
workflow above is the supported one. A dev build shows React Native's yellow
`process.env.EXPO_OS is not defined` warning once per launch — it comes from
`babel-preset-expo` in dev mode and does not exist in the release APK.

**Windows long paths (important).** React Native 0.88 generates C++ codegen
objects whose full path is ~360 characters, longer than the legacy Windows
260-character limit. The `ninja` that ships with the SDK's CMake 3.22 is
version 1.10 and refuses such paths ("`Filename longer than 260 characters`"),
which is the real reason the native build failed. `scripts/ensure-ninja.ps1`
(fired automatically by `npm run dev` and `npm run apk`) upgrades that `ninja.exe` to the
official 1.12.1 build (which understands long paths) and keeps a backup of the
original; the registry's `LongPathsEnabled` stays as it is. No `subst` drive is
needed any more, so Gradle, Metro and Android Studio all work on the real
folder.

## Google client configuration (spec 7.1.4 — no secret in the repo)

* `google-client.json` (committed with placeholders): `androidClientId`
  (`247931361024-…`, the "DietTracker Android (local build)" registration for
  package `com.diettracker.app` + the debug SHA-1), optional `webClientId` and
  `iosClientId`. **No secret exists in the mobile flow and none is embedded**:
  the Android OAuth client is a native (RFC 8252) registration identified by
  package name + SHA-1, so there is nothing confidential to keep out of the
  repo. Sign-in fails fast with `Auth_google_not_configured` while the id is
  empty.
* Sign-in is **native Google Identity Services**: the local Expo module
  `modules/google-auth` (Kotlin) wraps `AuthorizationClient`
  (play-services-auth `auth.api.identity`). Interactive sign-in shows the GIS
  account chooser + consent; as long as the saved grant covers the scopes,
  access tokens renew **silently** — background sync never opens login UI and
  raises `AuthenticationRequired` instead (local records are never deleted).
  Identity (sub/email/name) comes from the OpenID Connect userinfo endpoint.
* The `drive.appdata` scope is requested — the app never sees the user's
  other Drive files.
* iOS native sign-in is future work: without `iosClientId` sign-in fails fast
  (`Auth_google_not_configured`). Expo Go also cannot run sign-in any more
  (it needs the local native module) — use the local build (`npm run dev`).

## Parity generators (spec 4.3 / 1.5)

`scripts/generate.js` embeds, byte-for-byte:

* `src/data/migrations/*.sql` → `src/data/sql/migrations.generated.ts`
  (copied 1:1 from `src/DietTracker.Infrastructure/Database/Migrations` — a
  database exported from Windows opens on mobile without repair, `user_version = 12`)
* `src/DietTracker.App/Resources/Strings/en-US/Resources.resw` →
  `src/ui/strings.generated.ts` (all 242 English strings with `{0}` formatting)

Re-run it after refreshing either source. Never renumber or reorder migrations.

## Layout (spec 3.4)

```
src/
  domain/     pure rules ported 1:1 from DietTracker.Core (no React Native imports)
              enums, models, completion/slot/photo/copy/content/frequency rules,
              validators, analytics, JSON envelope + payload codecs, hashing
  data/       SQLite (expo-sqlite): connection, 12 migrations, repositories,
              photo store (files, 256px thumbnails), .dtbackup, integrity check
  cloud/      Google auth (native GIS AuthorizationClient via modules/google-auth
              + secure-store), Drive v3 provider (flat
              "__" names in appDataFolder — identical addressing to Windows),
              durable outbox journal, sync engine (push/pull/echo suppression/
              conflicts/tombstones/backoff), account session lifecycle
  services/   bootstrap, meal tracking facade, reminders (expo-notifications
              triggers), connectivity, device id
  ui/         theme (single source, system appearance), app context, shell
              components (busy overlay, dialogs), screens: Dashboard, Calendar,
              Statistics, Templates, Settings
```

## Why Expo Go can run this app

The original port was built on community native libraries (`op-sqlite`,
`notifee`, native Google Sign-In, `react-native-keychain`, …). Those **cannot**
run inside Expo Go — it is a fixed binary from the store that you cannot add
native code to (that is what caused the old blue "Base module not found"
error). The app now uses only modules that ship **inside Expo Go**, which is
why the scan above needs zero build steps:

* `expo-sqlite` — the same 12 migrations, byte-identical schema
  (`user_version = 12`, a Windows database opens unchanged)
* `expo-notifications` — reminder triggers, channels, action buttons, snooze
* `expo-secure-store` — token storage (Keychain / Keystore equivalent)
* `expo-file-system` — photos, backups, device id files
* `expo-image-picker` + `expo-image-manipulator` — camera/gallery and
  256 px JPEG thumbnails
* `modules/google-auth` — native Google Identity Services sign-in
  (**dev build only**, not Expo Go)
* `expo-print` — reserved for the A4 PDF writer
* plus `@react-native-community/netinfo`, `react-native-screens`,
  `react-native-safe-area-context` and React Navigation — all Expo Go natives

Every module above was verified against Expo SDK 58's
`bundledNativeModules.json` (the authoritative list of what Expo Go contains).

## First walkthrough on the device

1. The app opens on **Today** — guest mode is fully functional offline, no
   account needed. To synchronize, open **Settings → Account → Sign in with
   Google** (requires real ids in `google-client.json`, see *Google client
   configuration* above); records created as a guest are adopted by the account.
   Signing in runs behind the **same determinate bar as signing out**: the whole
   dataset of the account is pulled before the screens come back, so the Today
   tab and the calendar are complete from the first frame instead of filling up
   a minute later.
2. **Today tab**: five permanent meal cards — type a title + description,
   Save, then ✓ DONE / ✕ MISSED; photographs via 📷 (the camera takes a new
   picture, the gallery picks existing ones - up to three per meal). The ✓ / ✕
   of a card, and the two day-wide "Mark all" buttons, only act on cards that
   have a title or a description: an untouched card keeps its grey PENDING frame
   and is never confirmed by accident.
3. **Calendar / Statistics / Templates / Settings** tabs along the bottom;
   Settings → *Export data* writes a `.dtbackup` you can restore on Windows.

Synchronization has no banner and no gesture: changes travel to the account and
back silently in the background (after a save, on start-up, when the app returns
to the front, on reconnection), and every tab reloads itself when it comes to the
front or when a background cycle brought new records. A manual cycle is available
from **Settings → Synchronization → Synchronize now**, where the last successful
synchronization is shown as well. The wording of the account boundary says what
it does: the phone **syncs with the cloud** - it never talks about "uploading".

## Requirements & limits for scanning

* Phone and computer on the **same Wi-Fi** (guest networks often isolate
  devices); no VPN.
* Windows Firewall must allow Node.js on private networks (accept the prompt
  on first `npm start`).
* Cross-network fallback: `npm start -- --tunnel` (Expo installs `@expo/ngrok`
  when asked) — the QR then works over the internet too.
* iOS: **Expo Go from the App Store** works the same way — scan the QR there
  (Windows cannot build iOS locally; a Mac or EAS build is only needed if you
  ever add a library outside Expo, of which there are currently none).

## How the upload works (outbox → Google Drive)

Every local write is committed to SQLite first and then recorded in the durable
outbox (`SyncOperation`); the screens never wait for the network. The upload
pipeline (`uploadOutbox` in `src/cloud/syncEngine.ts`) is the single path used by
the background cycle, "Synchronize now" and the sign-out barrier, and it follows
the standard offline-first rules:

1. **The outbox is the source of truth** and is already coalesced per document -
   ten edits of the same meal are one operation, not ten.
2. **One listing per pass** builds the `path → Drive file id` index, so each
   document updates the object it already has instead of creating a copy.
3. **A small bounded window of parallel requests (6)** - uploads are latency
   bound, so a sequential loop paid one round trip per document.
4. **Every document settles on its own**: a success leaves the outbox, a failure
   records the exponential backoff and stays, so the reported progress always
   means "documents that really reached the cloud".
5. **The push phase is serialized process-wide**, so a background cycle and an
   account boundary can never upload the same outbox twice.
6. **The local database keeps one writer**: `withTransactionAsync` is a pair of
   statements, so `src/data/sqlite.ts` queues transactions - parallel uploads can
   otherwise interleave `BEGIN`/`COMMIT` and fail with "cannot start a
   transaction within a transaction".

Sign-out is the one operation that must finish before the session changes: it
drains the outbox behind a determinate bar, ignores the backoff window, reuses the
listing between rounds, retries only rounds that achieved nothing, and stops at a
whole-operation budget (30 s). When the outbox still cannot be emptied the local
cache is kept and the sign-out is **refused** - the phone never deletes the only
copy of a record.

Two defects of the previous version are covered by regression tests:

* the barrier drove a full synchronization *cycle*, so when a background cycle was
  already running the barrier received **that** promise: its progress callback was
  never installed (bar at 0 %), an 8 s deadline fired, and after four rounds the
  sign-out was refused although the upload was still going. It now drains the
  outbox itself (`__tests__/uploadPipeline.test.ts`);
* on Android the first tap after typing in the meal editor only dismissed the
  keyboard, because the dashboard `ScrollView` used the default
  `keyboardShouldPersistTaps="never"`. It is now `"handled"`, and the card also
  keeps a re-entry guard so a double tap writes the record once
  (`__tests__/mealCardSave.test.tsx`).

The round after that fixed what those two did not cover - **the Save button of a
card that already held a photograph, and the sign-out that deleted changes the
cloud had never received**:

* the slot upsert replaced the row's **primary key**
  (`ON CONFLICT ... DO UPDATE SET Id = excluded.Id`). `MealPhoto.MealEntryId`
  references it and there is no `ON UPDATE` action, so as soon as a photograph
  existed the write was rolled back with `FOREIGN KEY constraint failed` - the
  editor stayed open and Save looked dead, while meals without pictures saved
  normally. The key is never rewritten now (a draft with another id simply
  updates the slot's content) and the card reports a rejected write on its error
  line instead of swallowing it (`__tests__/photoSave.test.ts`);
* the outbox was journaled with the id from the screen's draft. After the fix
  above that draft id can differ from the stored row, so the journal now names
  the row the database keeps - otherwise the push would have "completed" a
  document that no longer existed and the edit would never have reached the
  cloud;
* a write made while the screens still cached `accountId = null` (the first
  frames after a sign-in or a restart) was journaled **nowhere**: it was written
  locally, the cloud never saw it, and the sign-out then had nothing to sync
  before it deleted the cache - the "fast sign-out, changes gone" report
  (`__tests__/syncRescue.test.ts`). `cloud/journal.ts` resolves "no cached id" to
  the ACTIVE account row and journals nothing only in true guest mode;
* the sign-out barrier now **queues every record the provider has not confirmed**
  (`pushAllLocalRecords({ onlyPending: true })`) before it counts the outbox, so
  a lost journal entry can no longer cost data: the bar syncs the content
  (meals, photographs, templates, reminders), then removes the cache. The bar's
  wording says *"Syncing with the cloud…"* and *"{0} of {1} change(s) synced
  with the cloud"* instead of talking about uploads.

**The account boundary is now symmetric - the user waits in BOTH directions.**
Signing in used to return immediately and pull the dataset in the background, so
the Today tab and the calendar were empty for a minute and the account looked
wiped. `signInWithGoogle` now runs the first synchronization INSIDE the call
(`runCycleAndWait`, which first awaits a cycle that is already running so its own
progress callbacks really fire) and reports it through the same blocking bar:
`preparing` → `uploading` (adoption of guest records) → `downloading` (one step
per document of the account's dataset, via the new `onDownloadProgress` of the
pull) → `finishing`. The frames carry `mode: 'signIn' | 'signOut'`, so the same
`ProgressOverlay` says *"Signing in…" / "Syncing your data with the cloud…" /
"X of Y document(s) received from the cloud" / "Opening your account…"* on the
way in and the sign-out sentences on the way out. A 90 s budget bounds the wait:
when the connection dies the bar closes, the account stays connected and the
regular triggers keep pulling (`__tests__/signInBarrier.test.ts`).

**The bulk DONE / MISSED actions respect the same rule as the cards.** The skip
test was `hasUserContent`, which counts a state, a photograph or a planned time -
so an untouched card that a previous "Mark all MISSED" had turned red (or one
that only carried a picture) was flipped to green while the dialog claimed only
edited cards can be confirmed. `hasMealText` (a title **or** a description) is now
the single gate for the card's ✓ / ✕, for `markAllDone`, for `markAllMissed` and
for the two buttons' enabled state; an untouched card keeps its grey PENDING
frame (and is not even written, so it stays a placeholder). The "nothing could be
marked" acknowledgement is a **single-OK** alert (it used to pass the same label
to cancel and confirm, drawing two identical "OK" buttons), and a partial result
is reported in the floating caption ("2 meal(s) marked as done. 3 card(s) without
a title or description were left as they are.") instead of interrupting the page
(`__tests__/bulkDone.test.ts`).
## How the download works (parallel pull → the 0-100 % bar)

The pull used to be a strictly sequential loop: `downloadObject` (one round trip),
apply to SQLite, next document. A first sign-in of an account holding a few
hundred records therefore spent most of its time **waiting**, and the bar crawled
even on a fast connection. It is now a small pipeline
(`src/cloud/parallel.ts`, used by `pullChanges`):

* **A bounded sliding window of 8 downloads** (`prefetchInOrder`). JavaScript is
  single threaded, so the parallelism that matters here is I/O: eight documents
  are in the native HTTP stack while the loop applies the current one. Eight is
  the "transfers" value the mainstream sync clients use and stays far below the
  provider's per-user quota; the window is never larger than the queue.
* **The apply order is untouched** - SQLite foreign keys (a photograph only after
  its meal) and the retry watermark depend on it. A document's failure is
  delivered at *its own* position, never into another document's slot, and it
  never becomes an unhandled rejection while earlier documents are applied.
* **A photograph's bytes start travelling with its metadata** (two pictures in
  memory): the apply step awaits bytes that are already on their way instead of
  issuing a second request per picture.
* **The identity of the pass is read once.** `loadLocalIdentity()` used to re-read
  the profile and the category table for *every* document; it is cached per pull
  and re-read only after a document that carries ids (profile, categories) was
  applied.
* **One folder listing per cycle.** The push phase already lists the dataset for
  its `path → id` index; the pull of the same cycle filters that snapshot
  (`selectChanges`) instead of asking the provider for the identical listing a
  second time. The snapshot is the one taken **before** the push, so a document
  this device just uploaded is never downloaded back.

The same work is covered by `__tests__/parallelFetch.test.ts` (order, bound,
failure isolation, cancel) and `__tests__/pullPipeline.test.ts` (documents really
travel in parallel, and a cycle pays for one listing). The sign-in bar is fed by
the same counts, so it now moves in steps of up to eight documents.



## Troubleshooting

**Scan fails / app says it cannot connect**
* Phone and computer must be on the **same Wi-Fi** (not a guest network), VPN off.
* The server must be running (`npm start`) and that terminal kept open.
* Windows Firewall: allow **Node.js** on private networks when prompted.
* Different networks? Use the tunnel: `npm start -- --tunnel` (accept the
  `@expo/ngrok` install) — the QR then works across the internet.

**Expo Go: "This project uses SDK 58, but Expo Go is running SDK …"**
* Version mismatch between the Expo Go app and this project. Update **Expo
  Go** from the Play Store / App Store (or install the exact version the
  message asks for), then scan again.

**`Call to function 'ExpoNotificationChannelManager.setNotificationChannelAsync' has been rejected … NullPointerException`**
* Some Expo Go (Android) builds reject the *native* notification-channel
  creation (the app's arguments are valid — verified against the SDK 58 enum
  spaces). The app handles this: every channel/category step is best-effort,
  a warning is logged, reminders are still scheduled, and Android delivers
  the notifications through its fallback channel. Nothing else is affected;
  real development builds create the channels normally.

**`WARN  [auth] Google client not configured - sign-in is disabled`**
* Expected while `google-client.json` has empty ids — sign-in stays disabled
  (fail-fast, spec 7.1.4) until you configure real Google client ids (see
  *Google client configuration* above). Guest mode works fully without it.

**Cold start shows the “Diet Tracker – Development Build” launcher**
* That is the expo-dev-client screen of a debug build. `npm run dev` skips it by
  opening the app through the dev-client deep link; when you start the app by
  hand, tap the **Diet Tracker** entry (or the one under *Recently opened*) to
  load the bundle from Metro. The app opens directly once that server has been
  used in the current session.

**Expo Go: "Unable to open exp://…" / nothing happens after scanning**
* No dev server is running — run `npm start` first, then scan again. Expo Go
  only loads the project while Metro serves it.

**`Error: listen EADDRINUSE: address already in use :::8081`**
* A previous `npm start` / `npm run dev` was not stopped with `Ctrl+C` and still
  owns the port. Free it, then start again:

```powershell
# Windows (PowerShell)
Get-NetTCPConnection -LocalPort 8081 -State Listen |
  ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
npm start
```

```bash
# macOS / Linux
lsof -ti :8081 | xargs kill -9
npm start
```

* Note: `npm start` (Expo) **auto-falls-back** to 8082/8083 with
  *"Port 8081 is being used by another process"*. The QR still works, but a
  stale server is holding resources — kill it with the command above to keep
  the default port. `npm run dev` reports the same situation as
  `FAIL port 8081 is used by something that is not Metro` and takes `--port`.
* Alternative: run on another port with `npm run dev -- --port 8082`.

**Blue screen: `Something went wrong. [runtime not ready]: Error: Base module not found…`**
* Historical error from before the Expo-module migration: `@op-engineering/
  op-sqlite` threw when the bundle ran in a binary without the app's native
  code. The app now uses **only** modules that ship inside Expo Go, so this
  error cannot occur in the supported workflow. If you still see it, restart
  Expo Go and `npm start`, and make sure you scan with **Expo Go** — and that
  you are not loading the bundle into an old leftover dev-build APK.

## Status & honesty statement

* `npm run check` (strict TypeScript + ESLint) is green and **99 unit tests**
  pass (completion rules, five-slot permanence, validators, photo
  rules, copy rules, analytics incl. the “–” case, DST-safe calendar day
  stepping, sync frequency/backoff, payload + envelope round-trip, Drive
  addressing, string table incl. `{0:0.#}` specifiers, weekday bitmask, the
  sign-out boundary: forced upload, progress frames, refusal that keeps data,
  the parallel upload pipeline (bounded window, monotonic progress, bounded
  retry budget, one save per press in the meal card editor, and the floating
  tab bar clearance for six real device insets),
  the parallel download pipeline (ordered prefetch window, per-document failure
  isolation, cancel, one folder listing per cycle).
* Verified on the local Android emulator (API 37, x86_64 release APK
  `DietTracker-1.0.0.1-universal.apk` installed over the previous build):
  first launch straight into the dashboard (no sign-in wall) → guest mode,
  the five permanent cards, inline edit + **one-tap save with the keyboard
  open** (title and description written, editor closed, no second press),
  mark DONE / mark all MISSED, progress + counters, day templates
  (save-as-template prompt, apply-to-date), calendar month navigation,
  statistics, settings (cadence buttons, storage usage, database path,
  integrity check → “no problems”), the system photo picker, and the
  automatic **dark mode** switch (`adb shell cmd uimode night yes|no`).
* Most of the app runs in **Expo Go** (Android + iOS); **Google sign-in and
  cloud sync need the local debug build** (see *Local Android emulator*)
  because authentication is native Google Identity Services
  (`modules/google-auth`) since the browser-redirect flow was replaced. All
  data modules still go through Expo SDK modules — `expo-sqlite` (the same
  12 migrations, identical schema), `expo-notifications`, `expo-secure-store`,
  `expo-file-system`, `expo-image-picker`, `expo-image-manipulator`.
  `android/` exists from `npx expo prebuild` (pre-Expo copies in
  `.native-backup-android/` / `.native-backup-ios/`), and the Google Drive
  paths have **not** been exercised against a real account (no client
  registration + interactive consent needs a human) — exactly the same honesty
  statement as the Windows README.
* Known deviations from the spec, recorded deliberately:
  * Reminders ship in **parity mode** (schema + scheduler + notification
    actions exist; no per-slot Reminders settings section) — the spec's
    §10.4(b) full mode requires the identical feature on Windows first.
  * PDF exports (report/calendar) currently surface the status flow; the
    A4 writer (`expo-print`) is not wired yet and the full report layout is
    pending. `.dtbackup` export/restore is fully implemented.
  * “Start at boot” (Android) and the Windows-only tray toggles are hidden
    (spec 17.4); the 12-hour clock toggle is present and immediate.
  * “Apply to date” asks for `yyyy-MM-dd` in a small prompt pre-filled with
    today instead of a native date picker (no extra picker dependency), and the
    bottom-tab icons are the equivalent emoji because Android has no Segoe
    Fluent glyph font — both keep the Windows interaction and labelling.
  * The card state bar sits on the **top** edge of the card: the Windows card draws the
    same 4 px bar along its bottom border (`BorderThickness="1,1,1,4"`). On the phone the
    state colour is the card's **top border** (`borderTopWidth: metrics.stateBar` in
    `src/ui/components/MealCard.tsx`), so a border follows the rounded corners and the
    top stays exactly as round as the bottom.
  * The visual language is **Apple Human Interface Guidelines** (iOS system colours and
    materials) rather than the WinUI tokens of the desktop app: systemBlue `#007AFF`
    (dark `#0A84FF`) as the interactive tint, systemGreen / systemRed for Done / Missed,
    systemGray for pending, `systemGroupedBackground` pages with
    `secondarySystemGroupedBackground` cards (light `#F2F2F7` + white, dark black +
    `#1C1C1E`), label alpha stacks for the text hierarchy and opaque separators. Cards
    are borderless and float on a soft shadow (`cardShadow` in `src/ui/theme.ts`), the
    typography follows the iOS text styles (`typeScale`: largeTitle 34 → caption2 11),
    buttons are capsules, the dialogs are iOS alerts (hairline action strip) and the
    calendar paints soft state washes with the **whole day square** of today filled in
    the accent blue (no circle around the number) instead of the Windows 2 px day
    frames. All logic, data flow and wording stay identical.
  * Cards and counters use the exact iOS state colours of the palette in `src/ui/theme.ts`
    (done `#34C759`, missed `#FF3B30`, pending `#8E8E93`; calendar cells `#E5E5EA`), and
    `MealCategory.Color` is not painted as a card fill — the card keeps its neutral
    surface and the state lives in the top border + status pill. Every card on every page
    shares the `cardFill` tone `#E5E5EA` (iOS systemGray5) — the same grey as the
    calendar's untouched day squares (dark mode keeps the standard `#1C1C1E` elevated
    card on the black page). The calendar panel itself stays white, because its grey
    squares and day rows need the light canvas behind them to keep their contrast.
  * The bottom-tab navigator has **no app bar** (`headerShown: false`): like the Windows
    pages, every screen opens with its own heading (the long date, the month,
    "Statistics", "Templates", "Settings") and the shell pads the status bar itself.
    The calendar lists the five cards of the selected day under the month grid, and a
    row opens that date on the dashboard.
  * The app bundles **Open Sans** (`@expo-google-fonts/open-sans`, loaded with
    `expo-font` in `App.tsx`) so both platforms draw the identical humanist sans
    without redistributing a proprietary system face. The regular cut carries the body
    text and every button label (no bold top buttons), the semibold cut only the
    headings, card titles, counters and status pills; sizes and weights follow the
    iOS text styles from `typeScale`.
  * The calendar's day cells show the day number, the photo marker and the **n/5**
    count instead of the miniature meal cards: a phone cell is about 44 pt wide, so
    the five meals of the selected day are listed as full rows under the grid (title,
    category, time, photo count, status pill) - same information, legible size. Those
    rows keep the dashboard card's 9 pt inset inside their 2 pt state border, so the
    slot emoji has air around it instead of sitting on the stroke.
  * The calendar header is one symmetrical block: the ‹ / › month arrows are pinned to
    the panel's two edges (so the left arrow sits exactly above the left edge of the
    grid and the right one above the right edge of the action row) with the month label
    filling the space between them, and the selected day's long date
    ("Sunday, 1 November 2026") rides to the right of **Open day**, bottom-aligned with
    the buttons instead of taking a line of its own. The confirmed / missed / pending
    counters that used to sit under those buttons are gone - the day cells and the
    status pills already carry that state, and the date line was what pushed the grid
    down.
  * **Photographs on a card**: the strip has its own row above the action buttons
    and draws three 56 pt tiles, so all three pictures of a meal fit side by side
    on the narrowest phone instead of wrapping. Each tile carries two badges - the
    **⤢ "Show"** button (bottom-left) opens the in-app full-screen viewer, and the
    **✕** keeps its old top-right corner for removal; tapping the picture itself
    still opens it too. The camera button on the card offers *Camera* / *Gallery*
    (`expo-image-picker.launchCameraAsync`, permission asked on first use), so a
    photograph can be taken while the meal is on the table.
  * **Signing out cannot skip the upload.** The account card opens the iOS-style
    confirmation, then the global overlay shows a determinate bar from 0 % to 100 %
    (`busyProgress` in `src/ui/appContext.tsx`, painted by `ProgressOverlay` in
    `src/ui/components/shell.tsx`): every settled outbox document moves it, the
    failed-operation backoff window is ignored (`ignoreBackoff` in
    `src/cloud/syncEngine.ts`) and up to four deadline-bounded attempts ride out a
    short network drop. There is no "sign out anyway"/discard button any more - if
    the outbox still cannot be emptied, the sign-out is **refused** with one
    acknowledgement dialog and the cache stays untouched, because those changes are
    only on this device. (The `discardChanges` flag of `signOutGoogle` survives for
    the unit test only.)
  * The **launcher icon is the Windows app icon** (the blue tile with the white disc
    and the green fork/knife): `scripts/make-icons.py` derives every Android asset
    from `WINDOWS_APPS/src/DietTracker.App/Assets/DietTracker.ico` - legacy
    `mipmap-*dpi/ic_launcher.png`, the circular `ic_launcher_round.png`, the
    `mipmap-anydpi-v26` adaptive icon (72 dp safe zone over the same blue
    `#1A7AC5`) and `assets/icon.png` / `assets/adaptive-icon.png` for Expo.
  * The bottom bar makes the **current tab** obvious: the active tab's glyph sits
    in a tinted chip and its caption is bold, while all five glyphs stay the same
    quiet outline - `layers-outline` and `settings-outline` from Ionicons, the
    house and the stats bars from Feather, the calendar from
    MaterialCommunityIcons. Those three are the UI's only non-Ionicons glyphs,
    each picked because Ionicons has no twin of the mockup's shape: its house
    carries an eaved roof and a chimney stub, its calendars are heavier with a
    thick header band and larger dots, and its bar charts carry a left/bottom
    axis with hollow bars (`FeatherIcon` / `MaterialIcon` in
    `src/ui/components/icons.tsx`). The mockup never swaps a glyph for a filled
    twin either, so the selection reads from the chip, the accent ink and the
    caption weight. The statistics caption is the
    short `Stats` (`Rn_NavStats`) while the page itself keeps its `Statistics`
    title. Both halves live in `src/ui/components/TabBar.tsx` (`TabBarGlyph`,
    `TabBarLabel`), the chip is a wash of the theme accent
    (`tabActiveChipFill`: 10 % light / 18 % dark), and the navigator's tint still
    carries the ink - no colour is hardcoded, so both themes follow. The chip
    is reserved on every tab, so switching tabs never moves a glyph, and the bar's
    height/inset/clearance in `src/ui/tabBar.ts` are unchanged.
    `__tests__/tabBarAppearance.test.tsx` pins the chip geometry and fill, the
    bold active caption, the five outline glyphs and the five captions.
  * Every scrolling page leaves room for the **floating tab bar** below its last
    card, and that room is now *measured* instead of guessed: `src/ui/tabBar.ts` is
    the single source of truth for the bar's geometry (`TAB_BAR_HEIGHT` 66,
    `TAB_BAR_SIDE_INSET` 14, `TAB_BAR_MIN_BOTTOM_OFFSET` 10,
    `TAB_BAR_CLEARANCE_GAP` 32). The navigator in `App.tsx` draws the bar with those
    constants and every page (dashboard, calendar, statistics, templates, settings)
    pads its scroll content with `useFloatingTabBarClearance()` =
    *device bottom safe-area inset (floor 10)* + *bar height the navigator
    published* + *32 pt of air*. Both device-dependent halves are read at runtime
    (safe-area context + `BottomTabBarHeightContext`), so a phone with a 3-button
    navigation bar and one with a 48 pt gesture area keep the SAME visible gap, and
    a change of the bar's height/float in `App.tsx` moves every page with it - the
    previous fixed "110 pt + inset" constant was a guess that left too little air on
    some devices (the calendar's day rows and legend ended flush against the bar)
    and a visible hole on others. `__tests__/tabBarClearance.test.ts` pins the
    formula for six real insets and fails if a page ever hardcodes the number again.
