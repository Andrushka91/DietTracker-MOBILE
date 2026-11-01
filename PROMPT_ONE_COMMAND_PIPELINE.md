# Prompt — one command that runs the whole pipeline (reusable)

A copy-paste prompt for any other Android / React Native / desktop project: it
makes the AI turn *install dependencies → build the artifact → boot the
emulator/device → install → launch* into **one** npm script with numbered steps,
logs and fail-with-fix messages — the same shape as `npm run emulator:apk` in this
repo (see the [README](./README.md#-quick-start--one-command-six-steps)).

**How to use it**

1. Open the other project, in the folder that owns its `package.json`.
2. Replace every `<PLACEHOLDER>` in the block below (the table at the end lists
   this repo's values as an example).
3. Paste the whole block into the AI chat — one message, then let it work.
4. Accept nothing until it shows a **real run** of the final command with all
   steps green (see *Definition of done*).

---

```text
GOAL
In this project (<PROJECT_NAME>, inside this folder) build ONE command that runs
the complete pipeline below, in this order. After a source change the developer
must type exactly one command and nothing else: no npm install, no build script,
no emulator start, no adb install, no "now open the app" step.

Command name: `npm run <COMMAND_NAME>` — reuse the name the project already uses
for "run on the emulator/device" if one exists; do not invent a second competing
name. Add variants only as flags (see below), never as a parallel script that
duplicates the logic.

THE SIX STEPS — each one prints `[n/6] <Title>` and then `OK`/`WARN`/`FAIL` plus
the value it actually used (path, size, duration, PID). No step may be silent,
and no step may be skipped without saying so:

[1/6] Toolchain   Locate the toolchain the build and the device need
                  (<SDK>, <JDK>, <adb>/<device tool>, project files). Print the
                  absolute path of each. If something is missing, FAIL with the
                  exact command or download link that installs it. Build the env
                  object (e.g. ANDROID_HOME, JAVA_HOME, PATH) that EVERY later
                  child process inherits — never rely on the user's shell.

[2/6] Packages    Run the dependency install unconditionally
                  (`npm install --no-audit --no-fund` or the project's
                  equivalent). Stream stdout+stderr into a log file
                  (<DEPENDENCIES_LOG>). If the install rewrites something inside
                  node_modules that the project patches (autolinking, postinstall
                  fixes), re-apply that patch right after — idempotently.

[3/6] Build       Run the real build that produces the artifact installed in
                  step 5 (<BUILD_COMMAND>, e.g. Gradle assembleRelease for every
                  ABI the project ships). Stream output to <BUILD_LOG>. Then
                  PROVE freshness: every expected artifact must exist AND have a
                  modification time newer than the moment this step started,
                  otherwise FAIL and list the missing/stale files. "The build
                  exited 0" is not proof — never install a stale artifact.

[4/6] Device      If a device/emulator is already running and booted, reuse it.
                  Otherwise boot <AVD_NAME> (or the project's default) and poll
                  until it reports boot complete, printing a live
                  "booting ... 4 s" line, with a 5-minute cap. Never start a
                  second emulator when one is still booting; wait for it.

[5/6] Install     Install the artifact with update-in-place semantics
                  (`adb install -r -d <apk>` or the platform equivalent) and pick
                  the variant the target can actually run (universal APK on an
                  x86_64 emulator, arm64 on a phone). On any install error, print
                  the single command that fixes THAT error code (e.g.
                  INSTALL_FAILED_UPDATE_INCOMPATIBLE -> the exact
                  `adb uninstall <package>`).

[6/6] Launch      Force-stop the app, start it, and print the PID it got.

REQUIRED FLAGS (all optional, all listed in --help)
  --skip-deps        leave step 2 out (fast re-run)
  --skip-build       leave step 3 out (JS-only changes)
  --apk / --only     steps 1,4,5,6 only: install the artifact that already exists
  --cold             cold boot the emulator
  --avd <name>       pick another AVD
  --device <serial>  target a specific device serial
  --reset            wipe app data before launch (true first-run state)
  --restart-adb      restart a wedged device server first
  --verbose          also stream the build output to the console
  -h, --help         print the usage text

HARD RULES
1. ONE script file (e.g. `scripts/dev.js`, plain Node, no new dependencies).
   The npm script is a one-liner that calls it with a flag.
2. The step counter must be COMPUTED from the flags actually used — `[2/6]`,
   `[3/6]` … must stay consistent for every flag combination.
3. Long-running children (install, build) must stream into a log file and keep
   the console alive with a dot every ~3 s; on FAIL print the last 20-40 log
   lines plus the path of the full log. Add a watchdog timeout that kills the
   child when it expires.
4. Every child process runs with the env from step 1 and with `windowsHide`, and
   never depends on the current working directory being perfect.
5. Windows specifics that WILL bite you — handle them explicitly:
   - `spawn('npm')` fails with ENOENT, and spawning `*.cmd` / `*.bat` directly
     throws EINVAL on current Node: route those through the shell
     (`shell: true`) or `cmd.exe /c`.
   - The project path can contain a SPACE — quote the executable (and keep those
     quotes after cmd.exe strips the outer pair).
   - A wedged device server must be detected with a short timeout and reported
     with `adb kill-server` / `--restart-adb`, never hang forever.
6. Idempotent helpers only: tool discovery, ninja/patch fixes and similar may run
   on every build; running them twice must be harmless.
7. Do not remove the ability to reproduce a *user install*: the "install the
   artifact that already exists" variant must stay available.
8. Keep the existing README's style; do not reformat unrelated sections, do not
   rename existing scripts, do not add new dependencies.

DOCUMENTATION (part of the job, not optional)
A. At the very beginning of README.md, right under the title and before any other
   section: the one command in a code block, one sentence saying it is the whole
   pipeline, and a table with exactly these columns:

       | # | Step | What the script actually runs | Log / what it prints |

   one row per step, with the real commands and the real log file names. Follow
   it with a real sample of the console output and a short "variants" table
   (default / install-only / --skip-deps / alias).
B. Update the "I want to… → command" table, the scripts table and the flags
   table so they match the new behaviour exactly.
C. Update the script's `--help` header so it lists the same steps and flags.
D. Every log path and every message you document must be the real one — no
   invented file names.

DEFINITION OF DONE (do not stop earlier)
1. Run the full command for real and paste the terminal output: all six steps
   green, artifact installed, app launched with a PID.
2. Run the "artifact already exists" variant and paste that output too.
3. Break a step on purpose (wrong AVD name, deleted artifact) and show that the
   message names the failing step and the exact command that fixes it.
4. Report which files you created/changed and why — English, no placeholders, no
   TODOs left behind.
5. Leave the machine as you found it: stop the emulator if you booted it, delete
   the temporary logs you created for testing.

PROJECT VALUES TO USE
  project name:       <PROJECT_NAME>
  package/app id:     <APP_ID>
  default AVD/device: <AVD_NAME>
  build command:      <BUILD_COMMAND>
  artifact(s):        <ARTIFACT_PATHS>
  install command:    <INSTALL_COMMAND>
  launch command:     <LAUNCH_COMMAND>
  logs:               <DEPENDENCIES_LOG>, <BUILD_LOG>
```

---

## The values used in this repository (copy them as the worked example)

| Placeholder | Value here |
|---|---|
| `<PROJECT_NAME>` | Diet Tracker — React Native / Expo, Android emulator |
| `<COMMAND_NAME>` | `emulator:apk` (`npm run refresh` runs the identical `--all` sequence) |
| `<APP_ID>` | `com.diettracker.app` |
| `<AVD_NAME>` | `Medium_Phone_API_37.0` (fallback: the first AVD) |
| `<BUILD_COMMAND>` | `scripts\build-apk.bat` → `gradlew assembleRelease` twice: universal, then `-PreactNativeArchitectures=arm64-v8a` |
| `<ARTIFACT_PATHS>` | `release\DietTracker-<versionName>-universal.apk` and `…-arm64-v8a.apk` (`versionName` read from `android/app/build.gradle`) |
| `<INSTALL_COMMAND>` | `adb install -r -d <apk>` — universal on the emulator, arm64 on a phone |
| `<LAUNCH_COMMAND>` | `adb shell am start -W -n com.diettracker.app/.MainActivity` |
| `<DEPENDENCIES_LOG>` | `npm-install.log` |
| `<BUILD_LOG>` | `release-build.log` (the debug/Metro build logs to `android-build.log`) |

## What the finished command looks like (this repo)

```
[1/6] Toolchain   OK    SDK C:\Users\<you>\AppData\Local\Android\Sdk
       JDK C:\Program Files\Eclipse Adoptium\jdk-21.0.13.9-hotspot\   adb ...\platform-tools\adb.exe
[2/6] Packages    OK    npm install 1 s - dependencies up to date
[3/6] Release     ..........OK    1 m 12 s - DietTracker-1.0.0.0-universal.apk 83.7 MB  +  DietTracker-1.0.0.0-arm64-v8a.apk 29 MB (version 1.0.0.0)
[4/6] Device      OK    emulator-5554 (Medium_Phone_API_37.0) - booted in 4 s
[5/6] Install     OK    DietTracker-1.0.0.0-universal.apk (83.7 MB, x86_64, version 1.0.0.0) installed
[6/6] Launch      OK    com.diettracker.app (pid 13886) started from the release APK

Ready - the release build runs on emulator-5554.
       this is the APK from the release page: bundled JavaScript, no Metro, no dev menu
```

## Why each hard rule exists (real bugs hit while building this one)

| Rule | The failure it prevents |
|---|---|
| route `npm` / `*.bat` through the shell | `FAIL could not start npm (spawn npm ENOENT)`, then `EINVAL` for `.cmd` on Node 20+, and `'"npm"' is not recognized as an internal or external command` when the quoting is wrong |
| quote the executable when the path has a space | `'D:\PROGRAMMING\REACT_NATIVE\DIET' is not recognized as an internal or external command` |
| freshness by mtime, not exit code | a build that "succeeded" but never rewrote the APK → the emulator ran the previous version |
| computed step counter | `[3/5]` printed after `[2/4]` as soon as flags changed the number of steps |
| re-apply the node_modules patch after install | `npm install` restored `expo-modules-autolinking` and dropped the drive-root fix → `Couldn't find package.json up from path R:\` |
| watchdog + `--restart-adb` | a wedged `adb` server hung every later adb call forever |

