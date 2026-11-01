# Visual redesign — round 2: the calm meal journal

Second pass of the 2026-11 visual refresh of the mobile Diet Tracker
(`com.diettracker.app`, React Native 0.88 / Expo SDK 58). It is **presentation
only**: navigation, available actions, authentication, synchronization, the
SQLite schema, stored category icons/colours and user data are untouched.

| | |
|---|---|
| Working branch | `redesign/visual-refresh-20261101-r2` |
| Continued from | `redesign/visual-refresh-20261101` (first pass, commit `59662de`) |
| Rollback point | tag `backup/pre-redesign-20261101-2126` → commit `1116209ad00bd3183faf43abbd3b8db659bec5bd` |
| Merge / release | **not merged, no replacement release published** — awaiting review |

## 0. The backup was verified before any change

The first pass had already created the rollback point; this round re-verified it
against the remote instead of trusting the local tag:

| Check | Result |
|---|---|
| `git rev-parse backup/pre-redesign-20261101-2126^{}` | `1116209ad00bd3183faf43abbd3b8db659bec5bd` |
| `git ls-remote --tags origin` | tag object `f6dbd368…`, peeled commit `1116209a…` — same commit |
| Release `Working app before visual redesign` | published, not a draft, target `main` — <https://github.com/Andrushka91/DietTracker-MOBILE/releases/tag/backup/pre-redesign-20261101-2126> |
| Attached APKs | `…-universal.apk` 87.7 MB (`a87cf9c3925d85419c47b34b2db870ae1f3021325e6691304df7d884d41b5860`) and `…-arm64-v8a.apk` 30.4 MB (`d5ad1762bb2e6e5acd02b20e9da72c8bf21925a64049a8a9d18d93b4b08750fa`), digests from the GitHub API |
| Source of the APKs | release variant of `1.0.0.0` built from the backup commit; signed with the project's standard Android debug key (sideloading only, never Play) |
| Private configuration | none: `google-client.json` holds a **public** OAuth client id (no secret); no tokens, databases, photos or keystores in the repo or the APKs |

The new branch was created from the first-pass branch (so nothing was thrown
away); `main` and the backup tag were never rewritten or force-pushed.

## 1. What the audit found

The first pass had replaced the emoji chrome with Ionicons and calmed the
palette, but the screenshots in [`before/`](./before) still showed concrete
problems:

| Problem | Evidence |
|---|---|
| Every meal card wore a full 1.5 pt green/red frame | three bright green boxes in a column out-shouted the meal text |
| Five filled 32 pt chips per card (30 buttons on one screen) | the action row was the busiest thing on the card, and each chip was below the 44 pt touch minimum |
| Date + three large nav chips + bar + counters + four action chips | ~40 % of the first screen before the first meal |
| Two unlabelled ✕ / ✓ chips at page level | no visible meaning for “mark all missed / done” |
| Muted text `#98A2B3` on white | **2.6:1** contrast on 11–12 pt captions (fails WCAG AA) |
| Calendar painted all 42 day cells as grey tiles | the month read like a keyboard; day cells were 39 dp on a 360 dp phone |
| Statistics legend painted **Done** in the accent blue | Done is green everywhere else — one value, two colours |
| Disabled primary buttons were a washed accent fill with accent ink | “Synchronize now” looked broken, not unavailable |
| Settings began with a guest card that repeated the account card below | the same two facts twice, above the sign-in action |
| Templates showed raw ISO data (`2026-10-30`, `2026-10-30 20:43`) | machine text where a date belongs |
| Tab labels 10 pt, and truncated at 1.3× font scale | `Calend…`, `Statisti…`, `Templa…` |
| Photo badges were text glyphs (`⤢`, `✕`) with 36 pt touch areas | the last emoji chrome left, and too small to tap |

## 2. Research that was actually read

| Source | What was taken from it |
|---|---|
| [Apple HIG — Tab bars](https://developer.apple.com/design/human-interface-guidelines/tab-bars) (read as the `.md` version) | keep every tab visible with an icon **and** a one-word label, prefer filled symbols for the active tab, never disable a tab |
| [Apple HIG — Typography](https://developer.apple.com/design/human-interface-guidelines/typography) | 17 pt default / 11 pt minimum on iOS; hierarchy through size, weight and colour; avoid light weights; keep the typeface count low |
| [Material 3 — Cards (Compose)](https://developer.android.com/develop/ui/compose/components/card) | filled / elevated / outlined cards; elevation carries separation; cards group related content instead of decorating every block |
| [Material 3 in Compose — colour roles](https://developer.android.com/develop/ui/compose/designsystems/material3) | always pair a container with its `on-` colour (primary/on-primary, surface/on-surface) to keep contrast |
| [React Native — Accessibility](https://reactnative.dev/docs/accessibility) | `accessibilityRole/Label/State`, and touch targets sized for a finger rather than for the glyph |
| [Yazio (App Store screenshots)](https://apps.apple.com/us/app/ai-calorie-tracker-by-yazio/id946099227) | compact meal **rows** with the category icon in a soft circle, a quiet “Summary” label, one accent for actions; the meal name, not the chrome, is the loudest element |
| [MyFitnessPal (App Store screenshots)](https://apps.apple.com/us/app/myfitnesspal-calorie-counter/id341232718) | a large friendly page title, small muted section captions outside the cards, generous card padding, four tabs and one clearly primary action |
| [Lifesum (App Store screenshots)](https://apps.apple.com/us/app/lifesum-ai-calorie-counter/id286906691) | photo-first rows (56 pt thumbnail + title + metadata), macro chips that never rely on colour alone, a calm bar |
| [PROMPT_SPEC.md](../../../PROMPT_SPEC.md) §8–9 | the mandatory status meanings, screen inventory and theme switching the redesign must preserve |

Two pages were **not** usable: `m3.material.io` component/colour pages render
only with JavaScript (the fetcher returned the shell), so the Android developer
documentation above was used for the same Material 3 material. No external
generator produced React Native code; every component here is hand-written in
this repository. The available MCP/connector tooling is app-oriented (GitHub,
Drive, Slack, …) with no design-generation service connected, so the emulator
captures were the visual ground truth. Nothing was uploaded to an external
design service.

## 3. The direction: one calm surface, one accent, three states

**“A quiet meal journal.”** A meal card should look like a page in a notebook: a
calm surface, one thin state rail, the meal text in charge, tools secondary.
The accent is reserved for *actions*; state colours only ever mean
done / missed / pending, and they are always repeated in words.

| Token | Light | Dark | Why |
|---|---|---|---|
| page | `#F4F6F8` | `#0B0F14` | cool wash; cards always read lighter |
| card | `#FFFFFF` | `#151B23` | elevation, not a grey fill |
| hairline | `#EDF1F6` | `#222B36` | separates a card's tools from its content |
| accent (actions) | `#4655D6` | `#8B95F6` | never one of the three state hues |
| done | `#157A4C` | `#34D399` | deep enough for white text (5.36:1); bright in dark with dark ink |
| missed | `#C43A3A` | `#F87171` | 5.23:1 on white |
| pending | `#8A93A3` | `#94A3B8` | dot + neutral outline pill |
| secondary text | `#3F4A5A` | `#C6D0DC` | 8.98:1 / 11.09:1 on cards |
| muted text | `#667085` | `#9AA8BA` | 4.97:1 / 7.16:1 on cards (was 2.6:1) |
| disabled fill / ink | `#E9EEF5` / `#7C8798` | `#1B222B` / `#8B98A9` | a distinct unavailable state |

Shape and rhythm: card radius 16, small controls 10, status pills capsule
(999), state rail 3 pt, page margin 16 (calendar 12 for the grid), card gap 12,
minimum touch 44 pt. Type stays Open Sans — page titles 22–28 pt bold with
−0.6 tracking, card titles 16 semibold, body 14–15, metadata 11–12.

States are explicit: **selected** = accent outline/fill; **disabled** = neutral
fill + muted ink with `accessibilityState`; **pressed** = dim only; **loading**
= the existing global overlay; **empty** = a sentence (meals) or an icon + a
sentence (templates); **error** = the existing red card banner, unchanged.

## 4. What changed, screen by screen

### Meal card (`src/ui/components/MealCard.tsx`)
* neutral 1 pt card + shadow; a 3 pt **state rail** on the leading edge replaces
  the full green/red frame; the pill still says Done / Missed / Pending in words;
* the category emoji sits on a 38 pt soft tile, aligned with the name/time block;
* title 16 semibold, description 14/19, a hairline, then the five actions;
* the five actions are now plain 44 pt glyph buttons (no five chips): camera,
  edit, clear (red glyph), missed (red ✕), done (green ✓) — identical order,
  labels and disabled rules as before;
* an empty card says “No meal recorded yet” instead of showing a hole.

### Dashboard (`src/ui/screens/DashboardScreen.tsx`)
* date 22 bold; **‹ / Today / ›** compact row (chevrons are 44 pt icon buttons,
  the words live in the accessibility labels);
* progress bar + its percentage in text; three counters unchanged in meaning;
* save actions on one line, **All missed / All done** as labelled compact
  buttons on a second right-aligned line (previously two unlabelled chips);
* a quiet “MEALS” caption groups the five cards.

### Calendar (`src/ui/screens/CalendarScreen.tsx`)
* day cells are **air**: a plain number, a 6 pt state dot for a decided day and
  the “3/5” share; today keeps the accent square, the selected day an accent
  outline; out-of-month days are dimmed;
* grid cells are 52 dp on a 411 dp phone and **45 dp on a 360 dp phone** (were
  39 dp); page margin 12 and panel padding 10 give the grid its width;
* weekdays and legend use readable ink; the selected date is the medium form
  (“1 November 2026”) so it cannot clip at large text;
* the selected day's meal rows carry the same state rail instead of five
  coloured frames, and no shadow (they live inside the white panel).

### Statistics (`src/ui/screens/StatisticsScreen.tsx`)
* segmented control now reads **Day / Week / Month / Year** instead of D/W/M/Y;
* the **Done** series is green again (it was drawn in the accent blue);
* each bar has a full-height track, so a share reads as a proportion; the
  period chart is centred, the yearly chart spreads across the panel;
* yearly captions are month abbreviations (“Jan … Dec”), not two-digit numbers;
* chevron icon buttons replace the text ‹ › arrows.

### Settings (`src/ui/screens/SettingsScreen.tsx`)
* the duplicate guest card is gone; the privacy sentence now lives in the
  account card (as the signed-out variant of the save hint);
* disabled controls use the neutral disabled pair; section captions darkened;
* body 14/20 and hints 12/17 for legibility; spacing 14 between cards.

### Templates (`src/ui/screens/TemplatesScreen.tsx`)
* a template named after its day shows “30 October 2026”, not `2026-10-30`;
* “Updated 20:43” instead of a second ISO timestamp; an icon tile marks a day
  or a single-meal template; capsule kind chip; icon-and-sentence empty state.

### Shared (`App.tsx`, `buttons.tsx`, `PhotoGallery.tsx`, `dialogs.tsx`, `theme.ts`)
* one icon family everywhere: **photo expand/remove badges** are Ionicons now
  (24 pt badge + hitSlop = 44 pt), and the photo viewer’s close dial is 44 pt;
* icon buttons are 44 pt; compact buttons and segments keep their visual size
  and gain 4 pt hitSlop (≥44 pt effective);
* segmented items are 40 pt tall (48 pt effective), buttons get an explicit
  disabled state and a press dim;
* dialog cards use the same 16 pt radius, 14/20 message text and 10 pt inputs;
* the tab bar keeps five icon+label tabs; the label is a custom `Text` capped at
  1.15× so `Templates` never becomes `Templat…` at 1.3× system text.

## 5. Deliberate departures from PROMPT_SPEC.md

| Spec | What it asks | What this build does | Why |
|---|---|---|---|
| §8.3 status pill | icon + text, **white text** on Pending gray / Done green / Missed red | Done and Missed keep a solid state fill with `onState` ink; **Pending is an outline pill** (pale fill, secondary ink, gray dot) | white on the old mid-gray was ~2.9:1; the outline keeps contrast and stops Pending from looking like a disabled button |
| §8.5 day cells | gray/green/red background tint **and** a border that repeats it | neutral cell + a 6 pt state dot + “3/5”; today keeps the accent fill, selection an accent outline | 42 tinted tiles competed with the meals; the state is still visible and is spelled out in the day list and legend |
| §8.5 cell content | mini meal cards inside the day cells | compact meal rows under the grid (first-pass deviation, kept) | 45 pt cells cannot hold a legible mini card on a phone |
| §9.3 state tokens | `doneColor #107C10`, `missedColor #A4262C`, `pendingColor #8A8886` | `#157A4C` / `#C43A3A` / `#8A93A3` in light, brighter equivalents in dark | the meaning is unchanged; the deeper hues reach 4.5:1 with white pill text |
| §9.4 card separation | border-based in light, surface-based in dark | surface + soft shadow + 1 pt hairline in **both** themes | one card anatomy in both themes is simpler than two rules, and matches the dark design |
| §8.2 day actions | labelled *Mark all DONE / MISSED* (spec text) | visible **All done / All missed** chips with a coloured glyph; accessibility labels stay “Mark all meals as DONE/MISSED” | fits a phone header while removing two unlabelled buttons |
| §9.4 font scaling | scale must not break layouts | everything scales; only the **tab caption** is capped at 1.15× | five single-word labels cannot stay whole at 1.3× on a 360 dp phone |

Everything else in §8–9 is preserved: five tabs, every action, inline editors,
guest mode, account actions, six sync states, calendar selection/open-day,
statistics periods, template apply, dialogs, theme switching, and the database.

## 6. Refinements made after looking at the rendered screens

The first render was not accepted as final. These were the concrete corrections:

1. **Header actions wrapped badly** — with four equal chips, “All done” fell to a
   second line on the left. Fixed by two deliberate rows (save actions, then a
   right-aligned day-action pair).
2. **Empty cards looked broken** — five tools under an empty header. Added the
   quiet “No meal recorded yet” line.
3. **Calendar rows floated** — their shadows sat on the white panel. Removed the
   shadow there and removed the rail from *pending* rows so a pending row is as
   calm as a pending meal card.
4. **Template metadata repeated the date** — now “Updated 20:43” when the name is
   that date.
5. **At 360 dp / 1.3× text** the first build truncated three tab labels, wrapped
   “Next day” onto its own line, clipped the selected date and pushed “3/5” out
   of its cell. Fixed with a capped custom tab label, chevron day navigation, the
   medium date form, capped day-cell text and **45 pt cells**.
6. **Statistics bars floated** without a scale and hugged the left edge. Added
   tracks, centred the period chart and spread the yearly chart.
7. **The Done legend was blue** while Done was green everywhere else. It is green
   again (a real semantic bug, not a taste change).
8. **Settings repeated itself** and its disabled primary looked broken. Merged
   the guest card into the account card and replaced the washed accent disabled
   style with the neutral disabled pair.

Each fix was re-rendered on the emulator before the next one; the capture set in
[`after/`](./after) is from the final release build.

## 7. Validation

| Check | Command | Result |
|---|---|---|
| Types | `node node_modules/typescript/bin/tsc --noEmit` | clean |
| Lint | `node node_modules/eslint/bin/eslint.js .` | **0 errors**, 118 warnings — the repo's long-standing `no-bitwise` / `no-void` / inline-style warnings (5 inline style, 1 unused disable); no errors |
| Tests | `node node_modules/jest/bin/jest.js` | **14 suites / 99 tests passed** |
| Release build | `scripts\build-apk.bat` | both APKs rebuilt at 23:31/23:32 on 2026-11-01 (`arm64-v8a` 30,634,597 B `fc74b20d…`, `universal` 87,986,224 B `91a208b5…`); **not uploaded** |
| Install | `adb install -r -d release\…-universal.apk` | updates in place, all existing meals kept |
| Save | edited Lunch’s description, pressed Save | value written and shown immediately |
| Persistence | `am force-stop` + relaunch | value still there; counters still 3 done / 0 missed / 2 pending |
| Data restored | description set back to its original text, Save, cold restart | original text back; counters unchanged; no reset, no new meals |
| Theme | `cmd uimode night yes/no` while open | every screen repainted, including calendar cells |
| Layout audit | `node docs/design/round2/layout-audit.js <ui.xml> …` | 0 off-screen nodes on all five screens at 411 dp and 360 dp; day cells 52 dp / 45 dp; no content under the floating bar at rest |
| Tab-bar clearance | last Dashboard action bottom 2061 px vs bar top 2187 px; calendar legend 2054 vs 2187 | 48 dp / 50 dp of air |
| Screenshot sanity | colour histograms + background samples of every file | all 24 captures valid, correct page colour per theme (not blank) |

Contrast, computed from the token values (WCAG ratio):

| Pair | Light | Dark |
|---|---|---|
| primary text / card | 17.75 | 16.13 |
| secondary text / card | 8.98 | 11.09 |
| muted text / card | **4.97** | 7.16 |
| Done pill ink / fill | 5.36 | 10.00 |
| Missed pill ink / fill | 5.23 | 6.95 |
| Pending pill ink / fill | 7.70 | 9.55 |
| accent button ink / fill | 5.95 | 7.07 |

**Not exercised in this round (stated honestly):**

* **Cloud synchronization** — the app is in guest mode here (“No account
  connected”). The save path and the journal/sync code are untouched, but a real
  upload/download would need the owner’s Google account, so it was not run.
* **Photo cards, photo viewer and upload spinner** — the existing data has no
  photographs. Adding one would change the user’s data *and* start a cloud
  upload, so it was deliberately not done; the gallery was reviewed in code and
  only its badges/sizes changed.
* **Empty Templates, loading, error, pending-sync and conflict states** — not
  reachable without deleting data or breaking the network/account; their code
  paths were only reviewed.
* **iOS** — no macOS/Xcode in this environment; all captures are Android
  (`Medium_Phone_API_37.0`, 1080×2400 @420 dpi and a 360 dp profile).
* **Final-capture eyeballing** — the screenshot reader in this session stopped
  returning images after the mid-round captures. The final release screenshots
  were therefore verified by UI-hierarchy bounds, touch-target measurements,
  colour/contrast maths and pixel sampling instead of by eye; every earlier
  iteration (same layout, before the last small size/label corrections) was
  inspected visually.

## 8. Screenshot index

`before/` = the previous design from the installed release APK; `after/` = the
final release build of this branch. Both light and dark, same emulator, same
existing test meals (no data reset).

| Screen | Before | After (light) | After (dark) |
|---|---|---|---|
| Today | [`before/light-today.png`](./before/light-today.png) | [`after/light-today.png`](./after/light-today.png) | [`after/dark-today.png`](./after/dark-today.png) |
| Calendar | [`before/light-calendar.png`](./before/light-calendar.png) | [`after/light-calendar.png`](./after/light-calendar.png) | [`after/dark-calendar.png`](./after/dark-calendar.png) |
| Statistics | [`before/light-statistics.png`](./before/light-statistics.png) | [`after/light-statistics.png`](./after/light-statistics.png) | [`after/dark-statistics.png`](./after/dark-statistics.png) |
| Templates | [`before/light-templates.png`](./before/light-templates.png) | [`after/light-templates.png`](./after/light-templates.png) | [`after/dark-templates.png`](./after/dark-templates.png) |
| Settings | [`before/light-settings.png`](./before/light-settings.png) | [`after/light-settings.png`](./after/light-settings.png) | [`after/dark-settings.png`](./after/dark-settings.png) |

Extra evidence in `after/`:

| File | What it shows |
|---|---|
| `light-today-bottom.png`, `dark-today-bottom.png` | the pending/empty cards and the last card clearing the tab bar |
| `light-statistics-year.png`, `light-statistics-day.png` | the yearly month captions and the single-day chart |
| `light-settings-bottom.png` | privacy/backup card with the neutral disabled controls |
| `large-text-today*.png`, `large-text-calendar.png`, `large-text-settings.png` | font scale 1.3 — no clipped labels, cards grow, tab labels whole |
| `small-screen-*.png` | 360 dp width at 1.0× — day cells 45 dp, nothing off-screen |
| `editor-keyboard*.png` | meal editor with the keyboard up; the card scrolls so Cancel/Save clear the keyboard |

`layout-audit.js` is the small reader used for the bounds report; run
`node docs/design/round2/layout-audit.js <uiautomator-dump.xml> [width height density]`.

## 9. Files touched

| Area | Files |
|---|---|
| Tokens | `src/ui/theme.ts` (palette, contrast, radii, spacing, rail, disabled, `statusPillColors`) |
| Shared controls | `src/ui/components/buttons.tsx`, `dialogs.tsx`, `PhotoGallery.tsx`, `PhotoViewer.tsx`, `App.tsx` (tab label) |
| Screens | `src/ui/components/MealCard.tsx`, `src/ui/screens/{Dashboard,Calendar,Statistics,Settings,Templates}Screen.tsx` |
| Text helpers | `src/ui/strings.ts` (RN-only labels, `formatMediumDate`, `formatMonthShort`) |
| Evidence | `docs/design/round2/*` (this file, captures, audit script) |

No new dependency was added. No gradient, blur, image-library change or
animation was introduced (outside the agreed scope). No business logic,
navigation, schema, migration, sync, auth or stored data was modified.

## 10. Restoring the previous design

Nothing in this branch is merged. To go back:

```bash
git switch main                                  # the shipping original
# or the exact pre-redesign source:
git switch -c restore/previous-design backup/pre-redesign-20261101-2126
# or keep the first-pass redesign instead of this round:
git switch redesign/visual-refresh-20261101
```

The backup release also carries the two pre-redesign APKs — installing either
over the app keeps all data (same package id, same debug signing key):

<https://github.com/Andrushka91/DietTracker-MOBILE/releases/tag/backup/pre-redesign-20261101-2126>

This branch changes no database migration and no stored value, so switching
branches (or reinstalling the old APK) cannot orphan the meals, photos,
templates or preferences you already have.

## 11. Reproducing the captures

```bash
# release build + emulator + install + launch
npm run emulator:apk

# light / dark
adb shell cmd uimode night no    # or yes
adb exec-out screencap -p > shot.png

# larger text
adb shell settings put system font_scale 1.3   # reset with 1.0

# 360 dp phone profile
adb shell wm size 720x1600
adb shell wm density 320
# reset with: wm size reset; wm density reset
```

Captures were taken on `Medium_Phone_API_37.0` (1080×2400, 420 dpi) with the
release APK, no Metro and no dev overlay, using the meals that were already in
the app. No data was reset or seeded for the screenshots.
