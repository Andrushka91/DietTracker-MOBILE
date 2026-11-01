#!/usr/bin/env node
/**
 * Diet Tracker - ONE command that runs the app on the Android emulator.
 *
 *   npm run emulator:apk       THE one command: npm install + rebuild both release
 *                              APKs + boot/reuse the AVD + install the APK + launch
 *                              the app - everything a change needs, no Metro
 *   npm run refresh            identical to emulator:apk (the same --all sequence)
 *   npm run emulator:apk:only  AVD + install the APK already in release\ + launch it
 *                              (no npm install, no build, no Metro)
 *   npm run dev                emulator + build + install + Metro + launch
 *   npm run dev:fast           Metro + relaunch only (JS/TS-only changes)
 *   npm run refresh:dev        npm install + debug build + Metro + launch
 *   npm run emulator           only start the AVD and wait until it is booted
 *   npm run emulator:stop      graceful shutdown (adb emu kill, snapshot-safe)
 *
 * This replaces the old scripts\dev.bat -> build-android.bat -> expo run:android
 * chain, which hid every error inside android-build.log and guessed the device
 * from `adb devices` output. The sequence below is the same work, but every step
 * either prints the value it used or fails with the exact fix:
 *
 *   [1/5] Toolchain    which Android SDK and JDK are used (or how to install one)
 *   [2/5] Device       reuses a running emulator (or a connected phone), else
 *                      boots the AVD with a live "booting ... 37 s" line
 *   [3/5] Build        gradle assembleDebug for the target ABI ONLY, then
 *                      adb install -r (full output still in android-build.log)
 *   [4/5] Metro        reuses a Metro that is already serving, else starts one
 *                      in THIS window so `r` / `j` keys and red boxes work
 *   [5/5] Launch       adb reverse tcp:8081 + am start com.diettracker.app
 *
 * `npm run emulator:apk` (= `npm run refresh`, the `--all` sequence) is every step
 * a change needs, in one command:
 *
 *   [1/6] Toolchain    Android SDK, JDK, adb
 *   [2/6] Packages     npm install
 *   [3/6] Release      scripts\build-apk.bat -> both release APKs in release\
 *                      (the two files are checked by timestamp, so a failed
 *                      bundle can never be installed as "the new build")
 *   [4/6] Device       boot / reuse the AVD
 *   [5/6] Install      adb install -r -d of the universal APK (x86_64 cannot run
 *                      the arm64 build)
 *   [6/6] Launch       am start com.diettracker.app
 *
 * No Metro and no dev client: the JavaScript is bundled inside the APK, so this
 * is what a user gets after sideloading the download. `--skip-deps` drops the
 * npm install, and `npm run emulator:apk:only` installs what is already in
 * release\ without building anything.
 *
 * Flags (all optional):
 *   -h, --help          this text
 *   -s, --skip-build    no Gradle install (fast loop for JS changes)
 *       --emulator-only only start / wait for the emulator
 *       --apk           install the APK already in release\ and launch it
 *                       (no npm install, no build, no Metro)
 *       --refresh/--all npm install + rebuild both release APKs + install +
 *                       launch (implies --apk and --deps)
 *       --deps          npm install first, then the normal sequence
 *                       (dev build + Metro)
 *       --skip-deps     leave the npm install out of --refresh / --deps
 *       --stop          gracefully shut the emulator down
 *       --cold          cold boot the AVD (-no-snapshot)
 *       --avd <name>    AVD to start (default: Medium_Phone_API_37.0, else first)
 *       --device <srln> target a specific adb serial
 *       --port <n>      Metro port (default 8081)
 *       --reset         clear the app data first (first-run state)
 *       --restart-adb   restart a wedged adb server before anything else
 *   -v, --verbose       stream the Gradle output to the console too
 */
'use strict';

const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const ANDROID_DIR = path.join(ROOT, 'android');
const LOG_FILE = path.join(ROOT, 'android-build.log');
const APK_FILE = path.join(ANDROID_DIR, 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
/** `npm run apk` writes the two standalone APKs here (ignored by git, published on the release page). */
const RELEASE_DIR = path.join(ROOT, 'release');
/** Output of the `npm install` that `--all` / `--deps` run (gitignored: *.log). */
const NPM_LOG = path.join(ROOT, 'npm-install.log');
/** Output of scripts\build-apk.bat when `--all` rebuilds the release APKs. */
const RELEASE_LOG = path.join(ROOT, 'release-build.log');
const BUILD_APK_BAT = path.join(__dirname, 'build-apk.bat');
const PACKAGE_ID = 'com.diettracker.app';
const MAIN_ACTIVITY = `${PACKAGE_ID}/.MainActivity`;
/** URL scheme from app.json - the prefix of the dev client deep link. */
const SCHEME = (() => {
  try {
    const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'app.json'), 'utf8'));
    return (config.expo && config.expo.scheme) || 'diettracker';
  } catch {
    return 'diettracker';
  }
})();
const DEFAULT_AVD = 'Medium_Phone_API_37.0';
const DEFAULT_PORT = 8081;

const DEVICE_TIMEOUT_MS = 90 * 1000;
const BOOT_TIMEOUT_MS = 5 * 60 * 1000;
const METRO_TIMEOUT_MS = 120 * 1000;

const IS_WINDOWS = process.platform === 'win32';

// ---------------------------------------------------------------------------
// arguments and console output
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2);

function has(...names) {
  return names.some((name) => argv.includes(name));
}

function value(name) {
  const index = argv.indexOf(name);
  if (index === -1) {
    return null;
  }
  const next = argv[index + 1];
  return next !== undefined && !next.startsWith('-') ? next : null;
}

const opts = {
  help: has('--help', '-h'),
  skipBuild: has('--skip-build', '-s'),
  emulatorOnly: has('--emulator-only'),
  // --refresh / --all is the one-command sequence: npm install, rebuild both
  // release APKs, boot the AVD, install that APK, launch the app.
  refresh: has('--refresh', '--all'),
  deps: has('--deps', '--install-deps', '--refresh', '--all') && !has('--skip-deps'),
  apk: has('--apk', '--release-apk', '--refresh', '--all'),
  stop: has('--stop'),
  cold: has('--cold'),
  reset: has('--reset'),
  restartAdb: has('--restart-adb'),
  verbose: has('--verbose', '-v'),
  avd: value('--avd') || process.env.DIETTRACKER_AVD || null,
  device: value('--device') || process.env.ANDROID_SERIAL || null,
  port: Number(value('--port') || DEFAULT_PORT),
};

let stepIndex = 0;
let stepTotal = 0;

function step(title) {
  stepIndex += 1;
  process.stdout.write(`[${stepIndex}/${stepTotal}] ${title.padEnd(11)} `);
}

/** Ends the current step line with a green-ish OK and the value that was used. */
function ok(text) {
  console.log(`OK    ${text}`);
}

function warn(text) {
  console.log(`WARN  ${text}`);
}

/** Ends the step line, prints the reason plus copy-paste hints, then exits. */
function fail(text, hints = []) {
  console.log(`FAIL  ${text}`);
  for (const hint of hints.filter(Boolean)) {
    console.log(`       ${hint}`);
  }
  process.exit(1);
}

function info(text) {
  console.log(`       ${text}`);
}

function duration(ms) {
  const seconds = Math.round(ms / 1000);
  return seconds >= 60 ? `${Math.floor(seconds / 60)} m ${seconds % 60} s` : `${seconds} s`;
}

function megabytes(bytes) {
  return `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// process helpers
// ---------------------------------------------------------------------------

/** Runs a command to completion and returns its exit code and output. */
function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, {
    cwd: options.cwd || ROOT,
    env: options.env || process.env,
    encoding: 'utf8',
    windowsHide: true,
    // A wedged adb server would otherwise block the session forever.
    timeout: options.timeoutMs || 30000,
  });
  const timedOut = Boolean(result.error && result.error.code === 'ETIMEDOUT');
  return {
    code: result.status === null ? -1 : result.status,
    stdout: (result.stdout || '').trim(),
    stderr: (result.stderr || '').trim(),
    error: result.error ? result.error.message : null,
    timedOut,
  };
}

/**
 * Windows keeps a single, case-insensitive `Path` variable: assigning `PATH`
 * next to an existing `Path` produces two entries and the child may see the
 * wrong one, so every variant is dropped before the new value is written.
 */
function setPath(env, valueToSet) {
  for (const key of Object.keys(env)) {
    if (key.toLowerCase() === 'path') {
      delete env[key];
    }
  }
  env[IS_WINDOWS ? 'Path' : 'PATH'] = valueToSet;
  return env;
}

// ---------------------------------------------------------------------------
// [1/..] toolchain - Android SDK, adb, emulator, JDK
// ---------------------------------------------------------------------------

function detectJdk() {
  const candidates = [
    process.env.JAVA_HOME,
    'C:\\Program Files\\Android\\Android Studio\\jbr',
    'C:\\Program Files\\Android\\Android Studio\\jre',
  ].filter(Boolean);
  for (const candidate of candidates) {
    const java = path.join(candidate, 'bin', IS_WINDOWS ? 'java.exe' : 'java');
    if (fs.existsSync(java)) {
      return candidate;
    }
  }
  // No JAVA_HOME: a `java` on PATH is enough for Gradle to start.
  const onPath = run(IS_WINDOWS ? 'where' : 'which', ['java']);
  return onPath.code === 0 && onPath.stdout !== '' ? null : undefined;
}

/**
 * Resolves the Android SDK + JDK and returns the environment every child
 * process (adb, emulator, Gradle, Metro) runs with. Exits with a copy-paste
 * fix when something is missing - that is the whole point of the preflight.
 */
function resolveTools() {
  const sdk =
    process.env.ANDROID_HOME ||
    process.env.ANDROID_SDK_ROOT ||
    path.join(process.env.LOCALAPPDATA || process.env.HOME || '', 'Android', 'Sdk');
  const adb = path.join(sdk, 'platform-tools', IS_WINDOWS ? 'adb.exe' : 'adb');
  const emulator = path.join(sdk, 'emulator', IS_WINDOWS ? 'emulator.exe' : 'emulator');

  if (!fs.existsSync(adb)) {
    fail(`adb was not found in the Android SDK (${sdk}).`, [
      'Install Android Studio with the SDK Platform-Tools, or point the script at',
      'an existing SDK:  set ANDROID_HOME=C:\\path\\to\\Android\\Sdk',
      'Download: https://developer.android.com/studio',
    ]);
  }

  // Gradle needs a JDK; Metro-only runs (--skip-build / --stop) do not.
  const jdk = opts.skipBuild || opts.stop ? null : detectJdk();
  if (jdk === undefined) {
    fail('no JDK found for Gradle.', [
      'Install Android Studio (it bundles one), or set JAVA_HOME:',
      'set JAVA_HOME=C:\\Program Files\\Android\\Android Studio\\jbr',
    ]);
  }

  const env = { ...process.env, ANDROID_HOME: sdk, ANDROID_SDK_ROOT: sdk };
  const pathParts = [path.join(sdk, 'platform-tools'), path.join(sdk, 'emulator')];
  if (jdk) {
    env.JAVA_HOME = jdk;
    pathParts.unshift(path.join(jdk, 'bin'));
  }
  pathParts.push(process.env.Path || process.env.PATH || '');
  setPath(env, pathParts.filter(Boolean).join(path.delimiter));

  return { sdk, adb, emulator, jdk, env };
}

/**
 * Makes sure the adb server answers. A wedged server (a forced kill of the
 * emulator, or several adb clients left behind) makes every later adb call hang
 * forever, so it is detected - and repaired - here, before anything else:
 * kill-server, then the Windows taskkill fallback when even that hangs.
 */
function ensureAdbServer(tools) {
  const startServer = () => run(tools.adb, ['start-server'], { env: tools.env, timeoutMs: 20000 });
  const responds = () => {
    const probe = run(tools.adb, ['devices'], { env: tools.env, timeoutMs: 15000 });
    return !probe.timedOut && probe.code === 0;
  };

  let server = startServer();
  if (!server.timedOut && server.code === 0 && responds()) {
    return;
  }

  console.log('');
  info('adb is not responding - restarting its server (adb kill-server)');
  run(tools.adb, ['kill-server'], { env: tools.env, timeoutMs: 15000 });
  if (!responds() && IS_WINDOWS) {
    // Last resort: hung adb client processes that kill-server cannot reach.
    info('still wedged - ending every adb.exe process');
    run('taskkill', ['/F', '/IM', 'adb.exe'], { env: tools.env, timeoutMs: 15000 });
  }
  server = startServer();
  if (server.timedOut || server.code !== 0 || !responds()) {
    fail('the adb server still does not answer after a restart.', [
      'Close Android Studio / the emulator console, then:',
      '  adb kill-server',
      '  adb start-server',
    ]);
  }
  info('adb server restarted');
}

function prepareToolchain() {
  step('Toolchain');
  const tools = resolveTools();
  if (opts.restartAdb) {
    run(tools.adb, ['kill-server'], { env: tools.env, timeoutMs: 15000 });
  }
  ensureAdbServer(tools);
  ok(`SDK ${tools.sdk}`);
  info(`JDK ${tools.jdk || 'java from PATH'}   adb ${tools.adb}`);
  return tools;
}

// ---------------------------------------------------------------------------
// [2/..] device - reuse what is running, otherwise boot the AVD
// ---------------------------------------------------------------------------

function listDevices(tools) {
  const result = run(tools.adb, ['devices', '-l'], { env: tools.env, timeoutMs: 20000 });
  if (result.timedOut) {
    fail('adb devices did not answer within 20 s (wedged adb server).', [
      'Restart it:  adb kill-server',
      'Or let this script do it:  npm run dev -- --restart-adb',
    ]);
  }
  if (result.code !== 0) {
    fail('adb devices failed.', [result.stderr || result.error || '']);
  }
  const devices = [];
  for (const line of result.stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('List of devices')) {
      continue;
    }
    const [serial, state] = trimmed.split(/\s+/);
    if (!serial || !state) {
      continue;
    }
    const model = /model:(\S+)/.exec(trimmed);
    devices.push({
      serial,
      state,
      model: model ? model[1] : '',
      isEmulator: /^emulator-\d+$/.test(serial),
    });
  }
  return devices;
}

function listAvds(tools) {
  if (!fs.existsSync(tools.emulator)) {
    return [];
  }
  const result = run(tools.emulator, ['-list-avds'], { env: tools.env });
  return result.stdout
    .split(/\r?\n/)
    .map((name) => name.trim())
    .filter(Boolean);
}

function deviceAbi(tools, serial) {
  const result = run(tools.adb, ['-s', serial, 'shell', 'getprop', 'ro.product.cpu.abi'], {
    env: tools.env,
  });
  return result.stdout.trim();
}

/** "Pixel 7, Android 14" - what the user recognises in the emulator window. */
function deviceName(tools, device) {
  const model = run(tools.adb, ['-s', device.serial, 'shell', 'getprop', 'ro.product.model'], {
    env: tools.env,
  }).stdout.trim();
  const release = run(tools.adb, [
    '-s',
    device.serial,
    'shell',
    'getprop',
    'ro.build.version.release',
  ], { env: tools.env }).stdout.trim();
  const parts = [model || device.model || device.serial];
  if (release) {
    parts.push(`Android ${release}`);
  }
  return parts.join(', ');
}

/** Polls adb until the AVD we just spawned shows up, and returns its serial. */
async function waitForEmulatorSerial(tools) {
  const started = Date.now();
  while (Date.now() - started < DEVICE_TIMEOUT_MS) {
    const emulator = listDevices(tools).find((device) => device.isEmulator);
    if (emulator) {
      return emulator.serial;
    }
    process.stdout.write('.');
    await sleep(1000);
  }
  return null;
}

/** Polls `sys.boot_completed` with an elapsed-seconds line until Android is up. */
async function waitForBoot(tools, serial) {
  const started = Date.now();
  while (Date.now() - started < BOOT_TIMEOUT_MS) {
    const result = run(tools.adb, ['-s', serial, 'shell', 'getprop', 'sys.boot_completed'], {
      env: tools.env,
    });
    if (result.stdout.trim() === '1') {
      return Date.now() - started;
    }
    process.stdout.write(`\r       booting ... ${Math.round((Date.now() - started) / 1000)} s   `);
    await sleep(2000);
  }
  return -1;
}

/** Starts the AVD detached (its own window) and waits until Android is booted. */
async function bootEmulator(tools) {
  const avds = listAvds(tools);
  if (avds.length === 0) {
    fail('no Android Virtual Device (AVD) is defined.', [
      'Create one: Android Studio > Device Manager > Create device (API 34+).',
      'Then run:  npm run dev',
    ]);
  }
  if (opts.avd && !avds.includes(opts.avd)) {
    fail(`the AVD "${opts.avd}" does not exist.`, [`Available: ${avds.join(', ')}`]);
  }
  const name = opts.avd || (avds.includes(DEFAULT_AVD) ? DEFAULT_AVD : avds[0]);

  const emulatorArgs = ['-avd', name].concat(opts.cold ? ['-no-snapshot'] : []);
  // -no-boot-anim shaves several seconds off every boot.
  emulatorArgs.push('-no-boot-anim');

  console.log('');
  info(`starting the AVD "${name}"${opts.cold ? ' (cold boot)' : ''} - its window stays open`);
  const child = spawn(tools.emulator, emulatorArgs, {
    env: tools.env,
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
  let died = false;
  child.on('exit', () => {
    died = true;
  });

  process.stdout.write('       waiting for the device');
  const serial = await waitForEmulatorSerial(tools);
  if (!serial) {
    if (died) {
      fail('the emulator exited while starting.', [
        'Run the AVD once from Android Studio > Device Manager to see the error.',
        'If a saved snapshot is corrupt, start with a cold boot:  npm run dev -- --cold',
      ]);
    }
    fail(`no emulator appeared within ${duration(DEVICE_TIMEOUT_MS)}.`, [
      `Start it by hand:  ${path.basename(tools.emulator)} -avd ${name}`,
    ]);
  }
  const boot = await waitForBoot(tools, serial);
  process.stdout.write('\r       ');
  if (boot < 0) {
    fail(`Android did not finish booting within ${duration(BOOT_TIMEOUT_MS)}.`, [
      'Try a cold boot:  npm run dev -- --cold',
      'A corrupt quick-boot snapshot is the usual cause: Device Manager > Wipe Data.',
    ]);
  }
  return { serial, isEmulator: true, model: '', state: 'device', bootMs: boot, avd: name };
}

/** Reuses a running emulator / phone, or boots the AVD when nothing is ready. */
async function ensureDevice(tools) {
  step('Device');
  const devices = listDevices(tools);

  if (opts.device) {
    const chosen = devices.find((device) => device.serial === opts.device);
    if (!chosen) {
      fail(`${opts.device} is not connected.`, ['adb devices', 'Start it, or drop --device.']);
    }
    if (chosen.state !== 'device') {
      fail(`${opts.device} is "${chosen.state}", not ready.`, [
        chosen.state === 'unauthorized'
          ? 'Accept the "Allow USB debugging" prompt on the phone, then run again.'
          : 'Wait for the device to finish booting, then run again.',
      ]);
    }
    ok(`${chosen.serial} (${deviceName(tools, chosen)}) - requested with --device`);
    return chosen;
  }

  const ready = devices.filter((device) => device.state === 'device');
  const emulator = ready.find((device) => device.isEmulator);
  if (emulator) {
    ok(`${emulator.serial} (${deviceName(tools, emulator)}) - already running`);
    return emulator;
  }
  const phone = ready.find((device) => !device.isEmulator);
  if (phone) {
    ok(`${phone.serial} (${deviceName(tools, phone)}) - connected phone`);
    return phone;
  }

  const unauthorized = devices.find((device) => device.state === 'unauthorized');
  if (unauthorized) {
    fail(`${unauthorized.serial} is connected but not authorized.`, [
      'Accept the "Allow USB debugging" prompt on the phone, then run again.',
    ]);
  }

  // A serial that is still listed as offline/booting is ours: wait for it
  // instead of starting a second AVD next to it.
  const booting = devices.find((device) => device.isEmulator);
  if (booting) {
    console.log('');
    info(`${booting.serial} is ${booting.state} - waiting for it to finish booting`);
    const boot = await waitForBoot(tools, booting.serial);
    process.stdout.write('\r       ');
    if (boot < 0) {
      fail(`${booting.serial} never reported sys.boot_completed.`, ['npm run dev -- --cold']);
    }
    ok(`${booting.serial} (${deviceName(tools, booting)}) - booted (${duration(boot)})`);
    return { ...booting, state: 'device' };
  }

  const booted = await bootEmulator(tools);
  ok(`${booted.serial} (${booted.avd}) - booted in ${duration(booted.bootMs)}`);
  return booted;
}


// ---------------------------------------------------------------------------
// [2/..] dependencies - npm install, always part of the one-command sequence
// ---------------------------------------------------------------------------

/**
 * `npm install` - the step that makes a newly added package visible to Gradle
 * (autolinking) and to Metro. It runs on every --all / --deps session, exactly
 * like a manual `npm install` would: a few seconds when nothing changed, and the
 * actual install when package.json or package-lock.json moved on.
 */
async function ensureDependencies(tools) {
  step('Packages');
  let result;
  try {
    result = await runLogged('npm', ['install', '--no-audit', '--no-fund'], {
      env: tools.env,
      logFile: NPM_LOG,
      display: 'npm install',
      timeoutMs: 20 * 60 * 1000,
    });
  } catch (error) {
    fail(`could not start npm (${error.message}).`, ['Is Node.js 22.11+ on PATH?  node -v']);
  }
  if (result.code !== 0) {
    console.log('');
    for (const line of tailOfLog(20, NPM_LOG)) {
      console.log(`       ${line}`);
    }
    fail(`npm install failed (exit ${result.code}) - full output: ${path.basename(NPM_LOG)}`, [
      'Retry by hand:  npm install',
    ]);
  }
  // A reinstall restores node_modules\expo-modules-autolinking from the registry
  // and drops the drive-root fix, so it is re-applied before Gradle links anything.
  run(process.execPath, [path.join(__dirname, 'patch-autolinking.js')], { env: tools.env });
  ok(`npm install ${duration(result.elapsed)} - dependencies up to date`);
  info(`full output: ${path.basename(NPM_LOG)}`);
  return true;
}


// ---------------------------------------------------------------------------
// [3/..] build - gradle assembleDebug for the target ABI, then adb install
// ---------------------------------------------------------------------------

function tailOfLog(lines, file = LOG_FILE) {
  try {
    const content = fs.readFileSync(file, 'utf8').split(/\r?\n/);
    return content.slice(-lines).filter((line) => line.trim() !== '');
  } catch {
    return [];
  }
}

/** Long-path ninja + the expo-autolinking edge fix, both idempotent. */
function prepareNativeBuild(tools) {
  const ninja = run(
    'powershell',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'ensure-ninja.ps1')],
    { env: tools.env },
  );
  if (ninja.code !== 0) {
    fail('could not prepare a long-path capable ninja.', [
      ninja.stderr || ninja.stdout || '',
      'Run it by hand to see why: powershell -ExecutionPolicy Bypass -File scripts\\ensure-ninja.ps1',
    ]);
  }
  const patch = run(process.execPath, [path.join(__dirname, 'patch-autolinking.js')], {
    env: tools.env,
  });
  if (patch.code !== 0) {
    fail('scripts\\patch-autolinking.js failed.', [patch.stderr || patch.stdout || '']);
  }
}

/**
 * Runs a long child process (Gradle, npm install, scripts\build-apk.bat),
 * streams its output into a log file and prints a dot every 3 s, so a build that
 * takes minutes never looks hung. `.bat` / `.cmd` files go through cmd.exe:
 * spawning a batch file directly is refused by current Node versions.
 */
function runLogged(command, commandArgs, options = {}) {
  const logFile = options.logFile || LOG_FILE;
  const display = options.display || [command, ...commandArgs].join(' ');
  fs.writeFileSync(logFile, `${new Date().toISOString()}  ${display}\n`);

  return new Promise((resolve, reject) => {
    const started = Date.now();
    const log = fs.createWriteStream(logFile, { flags: 'a' });
    const spawnOptions = {
      cwd: options.cwd || ROOT,
      env: options.env || process.env,
      windowsHide: true,
    };
    const child =
      // npm / npx are `npm.cmd` shims and a batch file cannot be spawned
      // directly (EINVAL on current Node), so anything without an `.exe`
      // extension - and every .bat/.cmd - runs through cmd.exe via `shell`.
      // The executable is quoted here because this project path contains a
      // space; cmd.exe /s then keeps those quotes when it strips the outer pair.
      IS_WINDOWS && (path.extname(command) === '' || /\.(bat|cmd)$/i.test(command))
        ? spawn(
            [/\s/.test(command) ? `"${command}"` : command, ...commandArgs].join(' '),
            { ...spawnOptions, shell: true },
          )
        : spawn(command, commandArgs, spawnOptions);
    const watchdog = options.timeoutMs ? setTimeout(() => child.kill(), options.timeoutMs) : null;

    child.stdout.pipe(log);
    child.stderr.pipe(log);
    if (opts.verbose) {
      child.stdout.pipe(process.stdout);
      child.stderr.pipe(process.stderr);
    }
    const tick = setInterval(() => process.stdout.write('.'), 3000);
    const finish = () => {
      clearInterval(tick);
      if (watchdog) {
        clearTimeout(watchdog);
      }
      log.end();
    };
    child.on('error', (error) => {
      finish();
      reject(error);
    });
    child.on('close', (code) => {
      finish();
      resolve({ code, elapsed: Date.now() - started, command: display });
    });
  });
}

/** Runs Gradle with a compact progress line; the full output goes to the log. */
function gradleBuild(tools, abi) {
  const gradleArgs = ['assembleDebug'];
  if (abi) {
    // Only the ABI of the target device: the emulator is x86_64, a phone is
    // arm64-v8a, and building all four would quadruple the install size/time.
    gradleArgs.push(`-PreactNativeArchitectures=${abi}`);
  }
  return runLogged(path.join(ANDROID_DIR, IS_WINDOWS ? 'gradlew.bat' : 'gradlew'), gradleArgs, {
    cwd: ANDROID_DIR,
    env: tools.env,
    logFile: LOG_FILE,
    display: `gradlew${IS_WINDOWS ? '.bat' : ''} ${gradleArgs.join(' ')}`,
  });
}

async function buildAndInstall(tools, target) {
  step('Build');
  prepareNativeBuild(tools);

  const abi = deviceAbi(tools, target.serial);
  let result;
  try {
    result = await gradleBuild(tools, abi);
  } catch (error) {
    fail(`could not start Gradle (${error.message}).`, ['npm install', 'npm run dev']);
  }
  if (result.code !== 0) {
    console.log('');
    for (const line of tailOfLog(40)) {
      console.log(`       ${line}`);
    }
    fail(`Gradle failed (exit ${result.code}) - full output: android-build.log`, [
      `Retry just the build:  cd android && ${result.command}`,
    ]);
  }
  const size = fs.existsSync(APK_FILE) ? megabytes(fs.statSync(APK_FILE).size) : 'unknown size';
  if (!fs.existsSync(APK_FILE)) {
    fail('Gradle reported success but app-debug.apk is missing.', [APK_FILE]);
  }

  const install = run(tools.adb, ['-s', target.serial, 'install', '-r', '-d', APK_FILE], {
    env: tools.env,
    timeoutMs: 180000,
  });
  if (install.code !== 0) {
    fail('adb install failed.', [
      install.stderr || install.stdout || '',
      `Retry:  adb -s ${target.serial} install -r -d "${APK_FILE}"`,
    ]);
  }
  ok(`${duration(result.elapsed)} - app-debug.apk ${size} (${abi || 'all ABIs'}) installed`);
}


// ---------------------------------------------------------------------------
// [3/4] --apk : install the standalone release APK from release\ and launch it
// ---------------------------------------------------------------------------

/**
 * `versionName` of the Android build (e.g. "1.0.0.0") - the same string
 * scripts\build-apk.bat puts in the file name, so a version bump needs no edit
 * here. Null when it cannot be read.
 */
function releaseVersion() {
  try {
    const gradle = fs.readFileSync(path.join(ANDROID_DIR, 'app', 'build.gradle'), 'utf8');
    const match = /versionName\s+"([^"]+)"/.exec(gradle);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

/**
 * Picks the release APK that THIS device can run: the arm64 build only on an
 * arm64 device (an x86_64 emulator cannot install it - the package simply
 * refuses with INSTALL_FAILED_NO_MATCHING_ABIS), the universal one everywhere
 * else.
 */
function releaseApkFor(tools, target) {
  const abi = deviceAbi(tools, target.serial);
  const version = releaseVersion();
  if (version === null) {
    fail('android/app/build.gradle has no versionName.');
  }
  const arm64 = path.join(RELEASE_DIR, `DietTracker-${version}-arm64-v8a.apk`);
  const universal = path.join(RELEASE_DIR, `DietTracker-${version}-universal.apk`);
  const preferred = abi.startsWith('arm64') ? [arm64, universal] : [universal, arm64];
  const found = preferred.find((file) => fs.existsSync(file));
  if (!found) {
    fail(`no release APK for version ${version} in release\\.`, [
      'Build it first:  npm run apk',
      `Expected:  ${path.relative(ROOT, preferred[0])}`,
    ]);
  }
  return { file: found, abi, version };
}

async function installReleaseApk(tools, target) {
  step('Install');
  const { file, abi, version } = releaseApkFor(tools, target);
  const name = path.basename(file);
  const size = megabytes(fs.statSync(file).size);

  // A release APK is signed with the debug key too, so `-r` updates an installed
  // debug build and vice versa; `-d` keeps that true across version codes.
  const install = run(tools.adb, ['-s', target.serial, 'install', '-r', '-d', file], {
    env: tools.env,
    timeoutMs: 180000,
  });
  const output = `${install.stdout || ''}${install.stderr || ''}`;
  if (install.code !== 0 || !/Success/i.test(output)) {
    const hints = [
      output.trim(),
      `Retry:  adb -s ${target.serial} install -r -d "${file}"`,
    ];
    if (/INSTALL_FAILED_UPDATE_INCOMPATIBLE|signatures do not match/i.test(output)) {
      hints.push('An APK with another signature is installed - remove it once:');
      hints.push(`  adb -s ${target.serial} uninstall ${PACKAGE_ID}`);
    }
    if (/INSTALL_FAILED_NO_MATCHING_ABIS/i.test(output)) {
      hints.push(`${name} does not contain the ABI of ${target.serial} (${abi || 'unknown'}) - use the universal APK.`);
    }
    fail(`adb install failed for ${name}.`, hints);
  }
  ok(`${name} (${size}, ${abi || 'unknown ABI'}, version ${version}) installed`);
  return { file, version };
}

/** Starts the installed release app: its JavaScript is bundled, so no Metro and no deep link. */
function launchReleaseApp(tools, target) {
  step('Launch');
  const adb = (adbArgs) => run(tools.adb, ['-s', target.serial, ...adbArgs], { env: tools.env });

  if (opts.reset) {
    adb(['shell', 'pm', 'clear', PACKAGE_ID]);
    info('app data cleared - the next start is a first run');
  }
  adb(['shell', 'am', 'force-stop', PACKAGE_ID]);
  const started = adb(['shell', 'am', 'start', '-W', '-n', MAIN_ACTIVITY]);
  if (started.code !== 0 || /Error/i.test(started.stdout)) {
    fail('could not launch the release app.', [
      started.stdout || '',
      started.stderr || '',
      `adb -s ${target.serial} shell am start -n ${MAIN_ACTIVITY}`,
    ]);
  }
  const pid = adb(['shell', 'pidof', PACKAGE_ID]).stdout.trim();
  ok(`${PACKAGE_ID}${pid ? ` (pid ${pid})` : ''} started from the release APK`);
}


// ---------------------------------------------------------------------------
// [3/..] --all : rebuild both release APKs (npm install already ran)
// ---------------------------------------------------------------------------

/** The two files scripts\build-apk.bat writes for a version, in reverse size order. */
function releaseArtifacts(version) {
  return ['universal', 'arm64-v8a'].map((abi) => path.join(RELEASE_DIR, `DietTracker-${version}-${abi}.apk`));
}

/**
 * The `Release` step of the one-command sequence: `scripts\build-apk.bat` runs
 * both Gradle release builds (`npm run apk`), and the files it wrote are checked
 * by timestamp, so a bundle that silently failed can never be installed as "the
 * new build". The install and launch that follow are the `--apk` code path.
 */
async function buildReleaseApks(tools) {
  step('Release');
  if (!IS_WINDOWS) {
    fail('rebuilding the release APKs needs scripts\\build-apk.bat (Windows).', [
      'Build them on Windows, or install a release APK that already exists:  npm run emulator:apk',
    ]);
  }
  prepareNativeBuild(tools);
  info(`build-apk.bat: universal + arm64-v8a, output in ${path.basename(RELEASE_LOG)} - 3-10 min`);

  const startedAt = Date.now();
  let result;
  try {
    result = await runLogged(BUILD_APK_BAT, [], {
      env: tools.env,
      logFile: RELEASE_LOG,
      display: 'scripts\\build-apk.bat',
      timeoutMs: 60 * 60 * 1000,
    });
  } catch (error) {
    fail(`could not start build-apk.bat (${error.message}).`, ['Retry by hand:  npm run apk']);
  }
  if (result.code !== 0) {
    console.log('');
    for (const line of tailOfLog(25, RELEASE_LOG)) {
      console.log(`       ${line}`);
    }
    fail(`build-apk.bat failed (exit ${result.code}) - full output: ${path.basename(RELEASE_LOG)}`, [
      'The Gradle error is at the end of that log; retry by hand:  npm run apk',
    ]);
  }

  const version = releaseVersion();
  if (!version) {
    fail('could not read versionName from android\\app\\build.gradle.', [
      path.join(ANDROID_DIR, 'app', 'build.gradle'),
    ]);
  }
  // Both files have to be new: build-apk.bat copies them out of Gradle, and a
  // silent copy failure would otherwise hand the emulator the previous build.
  const stale = releaseArtifacts(version).filter(
    (file) => !fs.existsSync(file) || fs.statSync(file).mtimeMs < startedAt,
  );
  if (stale.length > 0) {
    fail('build-apk.bat finished but did not rewrite:', [
      ...stale.map((file) => path.relative(ROOT, file)),
      `VERSION in scripts\\build-apk.bat must match versionName "${version}"`,
    ]);
  }
  const sizes = releaseArtifacts(version)
    .map((file) => `${path.basename(file)} ${megabytes(fs.statSync(file).size)}`)
    .join('  +  ');
  ok(`${duration(result.elapsed)} - ${sizes} (version ${version})`);
  return version;
}


// ---------------------------------------------------------------------------
// [4/..] Metro - reuse a running server, otherwise own one in this window
// ---------------------------------------------------------------------------

const EXPO_CLI = path.join(ROOT, 'node_modules', 'expo', 'bin', 'cli');

/** 'running' (Metro answers /status), 'other' (port taken by something else) or 'none'. */
function metroStatus(port) {
  return new Promise((resolve) => {
    const request = http.get(
      { host: '127.0.0.1', port, path: '/status', timeout: 1000 },
      (response) => {
        let body = '';
        response.on('data', (chunk) => {
          body += chunk;
        });
        response.on('end', () => {
          resolve(/packager-status:running/.test(body) ? 'running' : 'other');
        });
      },
    );
    request.on('timeout', () => {
      request.destroy();
      resolve('none');
    });
    request.on('error', () => resolve('none'));
  });
}

async function waitForMetro(port, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if ((await metroStatus(port)) === 'running') {
      return true;
    }
    await sleep(500);
  }
  return false;
}

async function startMetro(tools) {
  step('Metro');
  const status = await metroStatus(opts.port);
  if (status === 'running') {
    ok(`already serving port ${opts.port} - reusing that window`);
    return null;
  }
  if (status === 'other') {
    console.log('');
    fail(`port ${opts.port} is used by something that is not Metro.`, [
      'Close that process, or pick another port:  npm run dev -- --port 8082',
    ]);
  }
  if (!fs.existsSync(EXPO_CLI)) {
    console.log('');
    fail('the Expo CLI is missing (node_modules/expo/bin/cli).', ['npm install']);
  }

  console.log('');
  info(`starting Metro on port ${opts.port} - this window owns it, Ctrl+C stops it`);
  // --dev-client: the debug build is an Expo development client, so Metro has to
  // serve the dev-client manifest (the launcher and the deep link expect it).
  const child = spawn(
    process.execPath,
    [EXPO_CLI, 'start', '--dev-client', '--port', String(opts.port)],
    {
      cwd: ROOT,
      stdio: 'inherit',
      env: tools.env,
    },
  );
  const ready = await waitForMetro(opts.port, METRO_TIMEOUT_MS);
  if (!ready) {
    child.kill();
    fail(`Metro did not answer on port ${opts.port} within ${duration(METRO_TIMEOUT_MS)}.`, [
      'Run it alone to see why:  npm start',
    ]);
  }
  console.log('');
  ok(`listening on http://localhost:${opts.port} - bundling errors show up here`);
  return child;
}

// ---------------------------------------------------------------------------
// [5/..] launch the installed app on the device Metro serves
// ---------------------------------------------------------------------------

function launchApp(tools, target) {
  const adb = (adbArgs) => run(tools.adb, ['-s', target.serial, ...adbArgs], { env: tools.env });

  // Metro is reached through the USB/emulator bridge, not the network: without
  // this the app shows "Could not connect to development server".
  const reverse = adb(['reverse', `tcp:${opts.port}`, `tcp:${opts.port}`]);
  if (reverse.code !== 0) {
    warn(`adb reverse failed - the app may not reach Metro (${reverse.stderr || reverse.error})`);
  }
  if (opts.reset) {
    adb(['shell', 'pm', 'clear', PACKAGE_ID]);
    info('app data cleared - the next start is a first run');
  }
  adb(['shell', 'am', 'force-stop', PACKAGE_ID]);

  // The debug build carries expo-dev-client, so a bare activity start only gets
  // as far as its launcher ("Development servers"). Handing it the dev-server
  // URL through the app's own scheme is what opens the app itself.
  const devServerUrl = encodeURIComponent(`http://localhost:${opts.port}`);
  const deepLink = `${SCHEME}://expo-development-client/?url=${devServerUrl}`;
  const viaLink = adb([
    'shell',
    'am',
    'start',
    '-a',
    'android.intent.action.VIEW',
    '-d',
    deepLink,
    PACKAGE_ID,
  ]);
  if (viaLink.code === 0 && !/Error/i.test(viaLink.stdout)) {
    return;
  }

  // Fallback for a build without the dev client (release-like debug APK).
  const started = adb(['shell', 'am', 'start', '-n', MAIN_ACTIVITY]);
  if (started.code !== 0 || /Error/i.test(started.stdout)) {
    fail('could not launch the app.', [
      started.stdout || '',
      started.stderr || '',
      opts.skipBuild
        ? 'The debug build is probably not installed yet - run: npm run dev'
        : `adb -s ${target.serial} shell am start -n ${MAIN_ACTIVITY}`,
    ]);
  }
}

function printSummary(target, ownsMetro) {
  console.log('');
  console.log(`Ready - ${PACKAGE_ID} runs on ${target.serial}.`);
  info('save any file under src\\ - the app reloads by itself');
  if (ownsMetro) {
    info('press r in this window to reload, j to open the JS debugger');
    info('Ctrl+C stops Metro - the emulator keeps running');
  } else {
    info('Metro stays in the window that already serves it (press r there to reload)');
  }
  info('npm run emulator:stop   shut the emulator down gracefully (snapshot-safe)');
  info('npm run dev:fast        next session without a Gradle build');
  console.log('');
}

/** Summary of `--apk`: the shipped build, so the reload lines of a dev session do not apply. */
function printApkSummary(target, release) {
  console.log('');
  console.log(`Ready - the release build runs on ${target.serial}.`);
  info('this is the APK from the release page: bundled JavaScript, no Metro, no dev menu');
  info(`${path.basename(release.file)}  (version ${release.version})`);
  info('npm run emulator:stop     shut the emulator down gracefully (snapshot-safe)');
  info('npm run emulator:apk      the whole chain again: npm install + both APKs + this');
  info('npm run emulator:apk:only just install / relaunch this APK (no build, fast)');
  info('npm run dev               development session with hot reload instead');
  console.log('');
}



// ---------------------------------------------------------------------------
// --stop : graceful emulator shutdown (never force-kill: it corrupts snapshots)
// ---------------------------------------------------------------------------

async function stopEmulator(tools) {
  const emulators = listDevices(tools).filter((device) => device.isEmulator);
  if (emulators.length === 0) {
    console.log('No emulator is running - nothing to stop.');
    return;
  }
  for (const device of emulators) {
    console.log(`Stopping ${device.serial} with "adb emu kill" (snapshot-safe) ...`);
    run(tools.adb, ['-s', device.serial, 'emu', 'kill'], { env: tools.env });
  }
  const started = Date.now();
  let remaining = emulators.map((device) => device.serial);
  while (Date.now() - started < 30000) {
    remaining = listDevices(tools)
      .filter((device) => device.isEmulator)
      .map((device) => device.serial);
    if (remaining.length === 0) {
      break;
    }
    await sleep(1000);
  }
  if (remaining.length > 0) {
    warn(`still running after 30 s: ${remaining.join(', ')}`);
    info('close the emulator window as a last resort');
    process.exitCode = 1;
    return;
  }
  console.log(`Emulator stopped cleanly after ${duration(Date.now() - started)}.`);
}

// ---------------------------------------------------------------------------
// help, banner and the sequence itself
// ---------------------------------------------------------------------------

function printHelp() {
  // The usage text is the header comment of this file - one place to maintain.
  const header = fs.readFileSync(path.join(__dirname, 'dev.js'), 'utf8').split('*/')[0];
  console.log(
    header
      .replace(/\r/g, '')
      .replace(/^#!.*\n/, '')
      .replace(/^\/\*\*?/, '')
      .replace(/^ ?\* ?/gm, '')
      .trim(),
  );
}

function banner() {
  console.log('');
  console.log(`Diet Tracker - Android dev session (${stepTotal} steps)`);
  console.log(`  project ${ROOT}`);
}

function computeSteps() {
  let total = 2; // toolchain, device
  if (opts.deps) {
    total += 1; // npm install (skipped when node_modules is current)
  }
  if (opts.refresh) {
    total += 1; // both release APKs
  }
  if (opts.emulatorOnly) {
    return total;
  }
  if (opts.apk) {
    return total + 2; // install, launch
  }
  if (!opts.skipBuild) {
    total += 1;
  }
  return total + 2; // Metro, launch
}

async function main() {
  if (opts.help) {
    printHelp();
    return;
  }
  if (opts.stop) {
    await stopEmulator(resolveTools());
    return;
  }

  stepTotal = computeSteps();
  banner();
  const tools = prepareToolchain();

  // Dependencies come before every build: Gradle reads node_modules for the
  // autolinking manifest and Metro bundles out of it, so a newly added package
  // that was never installed shows up as a confusing "module not found" later.
  if (opts.deps) {
    await ensureDependencies(tools);
  }
  // --all rebuilds what `--apk` installs, so it happens before the emulator is
  // even booted - the AVD is not needed to produce the APKs.
  if (opts.refresh) {
    await buildReleaseApks(tools);
  }

  const target = await ensureDevice(tools);

  if (opts.emulatorOnly) {
    console.log('');
    console.log(`Emulator ${target.serial} is ready - start a session with:  npm run dev`);
    return;
  }

  // --apk: the shipped build, installed and launched as a user would run it.
  if (opts.apk) {
    const release = await installReleaseApk(tools, target);
    launchReleaseApp(tools, target);
    printApkSummary(target, release);
    return;
  }

  if (!opts.skipBuild) {
    await buildAndInstall(tools, target);
  }

  const metro = await startMetro(tools);
  step('Launch');
  launchApp(tools, target);
  ok(`${PACKAGE_ID} started`);
  printSummary(target, metro !== null);

  if (metro !== null) {
    // Metro holds the console until Ctrl+C: its keys (r / j / m) stay usable.
    const code = await new Promise((resolve) => metro.on('close', resolve));
    process.exitCode = code || 0;
  }
}

main().catch((error) => {
  console.error(`\nUnexpected failure: ${error && error.message ? error.message : error}`);
  process.exitCode = 1;
});
