# Visual redesign — stages 0–2 (before / after)

This folder is the evidence trail for the 2026-11 visual refresh of the mobile
Diet Tracker. It changed **presentation only**: navigation, features, workflows,
authentication, synchronization, the SQLite schema, stored category colours and
user data are untouched.

* `before/` — the shipping build of the previous design (release APK, no dev
  overlay), light and dark, all five screens.
* `after/` — the same five screens plus the verification shots, captured from the
  redesigned release APK on the same emulator/device profile.

| Screen | Before | After |
|---|---|---|
| Today | `before/light-today.png` · `before/dark-today.png` | `after/light-today.png` · `after/dark-today.png` |
| Calendar | `before/light-calendar.png` · `before/dark-calendar.png` | `after/light-calendar.png` · `after/dark-calendar.png` |
| Statistics | `before/light-statistics.png` · `before/dark-statistics.png` | `after/light-statistics.png` · `after/dark-statistics.png` |
| Templates | `before/light-templates.png` · `before/dark-templates.png` | `after/light-templates.png` · `after/dark-templates.png` |
| Settings | `before/light-settings.png` · `before/dark-settings.png` | `after/light-settings.png` · `after/dark-settings.png` |

Extra evidence in `after/`:

| File | What it proves |
|---|---|
| `verify-12h.png` | a real save: the 12-hour preference reached the database and repainted every time label |
| `verify-restart.png` | the same setting and all meals survived a cold `am force-stop` + relaunch |
| `verify-reverted.png` | the test change was reverted - times are back to 24-hour, counters unchanged |
| `wip-large-text.png` | font scale 1.3 - nothing clipped |
| `wip-keyboard.png` | meal editor with the keyboard up - fields and Save stay visible |

## What changed

### 1. Tokens (`src/ui/theme.ts`) — the whole skin in one file

| Token | Before | After | Why |
|---|---|---|---|
| card fill | grey `#E5E5EA` on `#F2F2F7` | white `#FFFFFF` on `#F4F6F8` | cards were *darker* than the page and read as pressed-in panels |
| accent | iOS systemBlue `#007AFF` | indigo `#4655D6` (`#8B95F6` dark) | one restrained accent that never competes with the three state hues |
| state colours | `#34C759` / `#FF3B30` / `#8E8E93` | `#1F9D63` / `#D64545` / `#8A93A3` | same meaning, calmer weight on a screen full of cards |
| dark page | `#000000` | `#0B0F14` | near-black with a blue cast, so elevated cards separate |
| control fill | translucent iOS fill | `#E6EBF2` (`#1F2833` dark) | chips must read as chips on the page *and* on a white card |
| ink on state fill | always white | `onState`: white / near-black | white on the bright dark-mode green was unreadable |
| card radius | 12 | 16 | softer, more contemporary grouping |
| card frame | 2 px | 1.5 px | the state frame still frames the card, without a hard outline |
| page padding / gaps | 8 / 8 | 14 / 10 | one spacing rhythm across the five pages |
| elevation | one shadow, `#000` 8 % | `cardShadow` + `raisedShadow` | depth order: page < card < floating tab bar |
| type | 400 / 600, titles 600 | + `OpenSans_700Bold`, `pageTitleStyle` | titles 700 with −0.6 tracking; labels 600, body 400 |

`pageTitleStyle` lives in the same file, so "Statistics", "Settings", "Templates",
the Dashboard date and the calendar month share one size, weight and tracking.

### 2. Icons (`src/ui/components/icons.tsx`) — one family, no emoji chrome

The tab bar, meal-card actions, status pills, chevrons, avatar and photo-viewer
close button were **emoji text**. They are now `Ionicons` from
`@expo/vector-icons@^15.0.2` — the version Expo pins for this SDK
(`node_modules/expo/bundledNativeModules.json`): pure JS + font assets, no native
module, no design-system dependency, no dependency migration.

* filled glyph while a tab is active, outline while it is not (the navigator's
  tint supplies accent / muted);
* meal actions: `camera-outline`, `create-outline`, `trash-outline`, `close`,
  `checkmark`;
* status pill: `checkmark` (done) / `close` (missed) **plus the word**, nothing
  for pending - colour is never the only signal;
* category emoji are **data** (`MealCategory.Icon` in SQLite) and were left
  exactly as they are.

### 3. Components

* `MealCard` — white fill, softer 1.5 px state frame, `cardShadow`, roomier
  padding, chip-cornered status pill with icon + word.
* `buttons.tsx` — chip radii, softer segmented control, and a **press dim**
  (opacity while the finger is down) so controls feel alive without animation.
* Dashboard — 8 px progress bar, tabular figures in the three counters, bold date.
* Calendar — bold month title, chevron icons, legend dots in the state colours,
  day rows keep their status-coloured frames.
* Settings — avatar is an icon (or the account photo), section rhythm unified.

## Validation

| Check | Result |
|---|---|
| `npm run typecheck` | clean |
| `npm run lint` | 0 errors (41 pre-existing warnings, unchanged) |
| `npm test` | 14 suites / 99 tests passed |
| Light + dark | all five screens captured from the release APK, both themes |
| Larger text | font scale 1.3 - no clipped labels, cards grow, tab bar fits |
| Keyboard | meal editor open with the keyboard up: card, fields and Cancel/Save stay visible |
| Scrolling / tab-bar clearance | last card clears the floating bar on every page (`floatingTabBarClearance` untouched, its test passes) |
| Safe areas | status bar / gesture inset respected in every screenshot |
| Saving | the 12-hour toggle wrote to SQLite and repainted every time label |
| Persistence | the value and all meals survived force-stop + relaunch |
| Data integrity | the test change was reverted - counters and meals unchanged |
| Crashes | `adb logcat`: no `FATAL` / `AndroidRuntime` / React error after the runs |

## Deliberately NOT in this round

Gradients, blur/glass materials, image-component replacement and animations were
left for a later stage, as agreed (stage 3+ would add `expo-linear-gradient`,
`expo-blur`, optionally `react-native-reanimated`).

## How to roll back

```bash
git switch main                        # the redesign lives on its own branch
# or the exact pre-redesign state:
git switch -c restore/previous-design backup/pre-redesign-20261101-2126
```

The backup release (`backup/pre-redesign-20261101-2126`) also carries the two
pre-redesign APKs, so the old design can be reinstalled on a phone without
rebuilding. Reinstalling keeps the app's data (same package id, same signing key).
