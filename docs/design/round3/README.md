# Visual redesign — round 3: the approved review design

Third pass of the 2026-11 visual refresh of the mobile Diet Tracker
(`com.diettracker.app`, React Native 0.88 / Expo SDK 58). It is **presentation
only**: navigation, available actions, authentication, synchronization, the SQLite
schema, the cloud format, stored category icons/colours and user data are
untouched.

| | |
|---|---|
| Working branch | `redesign/ui-r3-20261102` |
| Base (pre-r3) revision | `0001423` — *Record the APK scan behind the backup release claim* |
| Rollback point | tag `backup/pre-redesign-r3-20261102-1244` → commit `0001423` (already pushed) |
| Rollback release | <https://github.com/Andrushka91/DietTracker-MOBILE/releases/tag/backup/pre-redesign-r3-20261102-1244> |
| Recovered partial work | commit `3ac903c` (local checkpoint of the interrupted session) |
| Merge / release | **not merged, no replacement production release published** — awaiting review |

## 0. Where this round started

The previous session was stopped halfway. The work on disk was recovered instead
of restarted:

1. `git status` showed four modified files (`DashboardScreen`, `MealCard`,
   `PhotoGallery`, `PhotoViewer`), untracked `docs/design/round3/` and a stray
   `nul` file (34 bytes, the output of a redirected shell command — left in place,
   never committed).
2. The partial edits were **committed as a local checkpoint** (`3ac903c`, branch
   `checkpoint/r3-partial-20261102`) before anything else was touched, so the
   interrupted state stays recoverable.
3. The pre-r3 backup was verified rather than re-created: the remote tag peels to
   `0001423` (`git ls-remote --tags origin`) and the GitHub release above already
   targets that tag.
4. `tsc --noEmit` and `eslint` ran on the recovered files first: the partial edits
   were already type- and lint-clean (0 errors), so the remaining failures were
   genuinely new work, not inherited breakage.
5. The emulator's `adbd` was wedged (every `adb shell` command hung, the device
   reported `offline`). The AVD was restarted; app data lives on the AVD disk and
   survived (meals, photos and settings are still on the device).

## 1. Reference: what was actually rendered

The five HTML mockups in
`…\.codex\visualizations\2026\10\30\01a18e4e-…` were rendered locally in headless
Chrome through the DevTools protocol (full-page captures at 2×, `light-dark()`
driven by an emulated `prefers-color-scheme`) and inspected as images:

| Mockup | Inspected |
|---|---|
| `diettracker-r3-review-today.html` | light + dark, 412 dp and 360 dp |
| `diettracker-r3-review-photos.html` | card strip, viewer, `…` options sheet |
| `diettracker-r3-review-calendar.html` | month board, another selected date |
| `diettracker-r3-review-statistics.html` | week, day, month, year, a selected row, both disclosures |
| `diettracker-r3-review-settings.html` | light + dark |

Measurements taken from the rendered CSS (and used verbatim where the existing
tokens allow it):

| Element | Reference value |
|---|---|
| Day header | 48 pt arrows either side of a centred two-line date (18 pt / 11 pt), no ellipsis, no chevron beside the date |
| Progress | 5 pt track, then `n of m completed` at 11 pt |
| Counts | three equal columns, 13 pt glyph + 14 pt number + 11 pt label |
| Bulk actions | two equal 48 pt buttons, 10 pt apart |
| Section caption | 11 pt caps, 1.1 tracking |
| Card | radius 15, 1 pt border, 13 pt padding, 3 pt state rail inset 12 pt |
| Card header | 36 pt emoji tile, 14 pt category, 11 pt time, tinted status pill (4×8 padding) |
| Card body | 16 pt title over 13 pt muted description, **12 pt** to the photo column |
| Photos | one row, 48 × 48 tiles, 6 pt gaps, radius 9, no overlay badges |
| Card tools | hairline + five 48 pt icon buttons, 17 pt glyphs |
| Viewer | dark chrome, X / meal+date / `…`; contained image; `‹ n of m ›`, zoom out/in; 48 pt thumbnails with accent ring; hint line |
| Calendar | board card: 18 pt month + arrows, 11 pt weekdays, 30 pt day circle (filled = selected, outline = today), five 4×3 pt marks, key row, `Five marks · five meal slots` + `Today` |
| Agenda row | 44 pt time column, 13 pt title, 11 pt category + photo count, tinted pill |
| Statistics | 4-up segmented (raised white selected segment), range row, primary panel (38 pt percentage + fraction + composition bar + 3 counts), 44 pt breakdown rows, tinted selection card |
| Settings | grouped cards, 58 pt rows, 30 pt leading glyph, 14 pt label over 11 pt detail, 11 pt caps captions |

## 2. What changed

### Today (`DashboardScreen`, `MealCard`, `PhotoGallery`)

* The date is a **control**, not the page title: previous arrow, `Sun 1 Nov` over
  `2026`, next arrow. The long `Sunday, 1 November 2026` title, its 26 pt weight
  and the ellipsis are gone; nothing sits beside the date. Tapping the date still
  opens the Calendar tab (tap-to-select-date), and **Go to today** appears only
  while another day is open.
* One completion summary replaces the bare percentage (`3 of 5 completed`), and
  Done / Missed / Pending became three equal columns with state glyphs, so the
  counts line up at every number width.
* The two bulk actions are one equal-width row; the **contextual Save all** now
  exists only while an inline editor is open and sits below them. Drafts,
  validation, confirmations and the "no empty meal can be done" rules are
  unchanged (`__tests__/bulkDone.test.ts`, `mealCardSave.test.tsx` still pass).
* Meal cards keep category/time/status above and the five actions below, with the
  title and description in the LEFT column and up to three 48 pt thumbnails in ONE
  HORIZONTAL ROW on the RIGHT (6 pt gaps, 12 pt column gap). Without photos the
  text reclaims the full width. The pills became tinted (state colour on a wash of
  itself) via `softPillColors`.
* `Save day as template` is a quiet accent text button below the meal list.

### Photo viewer (`PhotoViewer`)

Rewritten against the rendered mockups and the review notes: dark chrome in both
themes, `Close` / meal + date / `…`, the original image **contained** (never
stretched), horizontal **swipe paging** (`pagingEnabled`, arrows and thumbnails as
alternatives), **pinch (1–4×) and double-tap (2.5×) zoom** with panning while
zoomed (PanResponder + Animated — no new native dependency), a 48 pt thumbnail
strip with an accent ring, the paging hint, and a bottom **Photo options** sheet
holding `Photo details` and `Remove photo`. Removal always asks first and then
calls the existing `removePhoto` + journal/sync path. Cancelling the camera or the
gallery still returns without any write (`pickPhotos` returns on `canceled`).

### Calendar

Rebuilt as the approved month board: `Calendar` + `Today` in the page header, a
subtitle, then ONE surface holding the month label with its two arrows, the
Monday-first weekday row, the day grid (filled circle = selected, accent outline =
today, 38 % opacity = adjacent month) and **five meal-slot marks per recorded day**
in meal order. The key row (`Done / Missed / Pending`) and the
`Five marks · five meal slots` / `Today` foot line sit inside the same board.
Below it: the selected date with `n done · n missed · n pending · n photos` and an
**Open day** action, then a grouped agenda (time, title, category + photo count,
status pill). Selecting a date only previews its agenda; opening the diary stays
explicit. Month navigation and `Today` work locally, and the screen now accepts an
`initialDate` param so Statistics can send it to a period.

### Statistics

Day / Week / Month / Year with the exact range printed (`26 Oct – 1 Nov 2026`,
`November 2026`, `2026`). ONE primary measure: **Done ÷ all planned slots** with
its fraction (`3 / 35`), a status composition bar and three aligned counts, plus a
context line that discloses upcoming slots (`Includes 295 upcoming slots.`).
Under it an interactive breakdown whose rows follow the period — meals for a day,
days for a week, **partial calendar weeks** for a month, months for a year — each
with `done / planned` or `Later` when the whole row lies in the future. Selecting a
row shows its counts and an explicit `View day` / `Calendar` action. Two
disclosures: `By meal type` (hidden for a single day) and `How the numbers work`,
which keeps **Done ÷ (Done + Missed)** as the separately labelled *Among recorded
outcomes* rate. Empty periods get a purposeful empty state; large yearly totals
(1825 slots) keep their own space instead of colliding with the labels.

The rows and counts live in `src/ui/statisticsBreakdown.ts` (pure, no React
Native), so the maths is testable; `src/ui/screens/StatisticsScreen.tsx` only
renders it. No domain calculation was changed.

### Settings

Regrouped into Account, General, Cloud sync, Data & backup and More, all in the
approved compact row anatomy. The account row shows the real identity (Google name
/ e-mail / quota when signed in, `Guest account` otherwise) and the one account
action; export and restore are separate rows; the database path and the integrity
check moved into `Advanced & diagnostics`; the schedule picker expands from
`Scheduled cloud checks`; and the note under Cloud sync states the truth — saving a
meal starts a sync attempt, the schedule only decides how often the app also checks
the cloud. Guest / pending / offline / error / expired states each get their own
title + detail (`describeSync`).

### Small shared changes

| File | Change |
|---|---|
| `src/ui/theme.ts` | `softPillColors()` + `tintAlpha()` (the wash used by the card and agenda pills) |
| `src/ui/components/buttons.tsx` | `IconButton` gained `size`/`touch`; `Segmented` now draws the raised **surface** segment with accent ink from the review design |
| `src/ui/strings.ts` | r3 presentation strings (`Rn_…`), plus `formatCompactDate`, `formatShortDayMonth`, `formatWeekdayDay` |
| `App.tsx` | the Calendar tab forwards an optional `date` param to `CalendarScreen` |


## 3. Validation

### Static checks

| Check | Result |
|---|---|
| `tsc --noEmit` | clean |
| `eslint src App.tsx` | **0 errors**, 116 warnings — all from the pre-existing rule families (`no-void`, `react-native/no-inline-styles`, `no-bitwise` in App.tsx, `react/no-unstable-nested-components`); no rule was disabled |
| `jest` | **16 suites / 114 tests pass** (14 pre-existing suites untouched, 2 new) |

New coverage (focused, not a rewrite):

* `__tests__/r3Formatting.test.ts` — the compact date and statistics labels, and
  `tintAlpha`, which pins the bug found during the redesign: `withAlpha()` on an
  already-converted theme colour read `#RRGGBBAA` as `#AARRGGBB` and turned the
  green pill purple.
* `__tests__/statisticsBreakdown.test.ts` — period ranges, slot counting (all five
  per day), the upcoming disclosure (today's slots are *not* upcoming), and the row
  shapes/denominators for day, week, partial-week month rows and the 12 months of a
  year (1825 slots), including that every row adds up to the period denominator.

### On the emulator (release build of this branch)

`gradlew.bat assembleRelease` from the r3 source, then `adb install -r` over the
existing install (same debug-key signature, so **app data was preserved** — the
same meals and photographs are still on the device). 88.0 MB universal APK.

Verified by driving the UI and reading back the accessibility tree (text, labels,
bounds, enabled/selected states):

| Behaviour | Result |
|---|---|
| Compact header, `n of 5 completed`, three aligned counts, two equal bulk buttons | ✔ labels and geometry as designed |
| Date tap opens the calendar, `Go to today` only on other days | ✔ |
| Contextual `Save all` appears only with an open editor | ✔ (`Save all` present after `Edit`, absent before) |
| 3-photo card → viewer: meal + date, `1 of 3`, thumbnails, zoom, paging | ✔ |
| Viewer swipe to the next photo (`1 of 3` → `2 of 3`, image changes) | ✔ |
| Zoom in enables `Zoom out` (scale leaves 1×) | ✔ |
| `…` sheet: `Photo options`, `Photo details`, `Remove photo` | ✔ |
| Remove → confirmation text → `No` keeps all three photos | ✔ |
| Calendar: month board, per-day status in the accessible name (`… , 3 confirmed, 0 missed, 2 pending`), key + foot rows, selected-date summary, agenda rows | ✔ |
| Statistics: week 26 Oct–1 Nov → `9%`, `3 / 35`, no upcoming; year → `<1%`, `3 / 1825`, `Includes 295 upcoming slots`, 12 month rows; month → `1 Nov` / `2 Nov – 8 Nov` partial weeks with `Later`; day → `By meal` + empty state | ✔ |
| Breakdown selection → counts + `View day` / `Calendar`; `Calendar` opens the calendar on the period's month | ✔ |
| `By meal type` expands (Breakfast / Morning snack / Lunch `1 / 7 done`), hidden in day mode | ✔ |
| Settings: grouped rows with dividers, `Cloud contents` disabled while signed out, `Photo storage 0.73 MB`, `About DietTracker 1.0.0` | ✔ |
| Large text (`font_scale 1.3`): date, `3 of 5 completed` and the three counts stay inside the content width | ✔ (bounds checked) |
| 360 dp (`wm density 480`): Today and Calendar render, density then restored to 420 | ✔ |


### What was and was NOT compared visually

* **Compared visually** (rendered mockup vs emulator screenshot): Today (empty and
  with three photos), Settings (top and bottom), Calendar, Statistics (empty week).
  Layout, hierarchy, spacing, photo placement and the grouped layout were adjusted
  once from that comparison — description colour, tinted pills, row dividers and the
  segmented control all came out of it.
* **Not compared visually after that point**: the session's image-reading quota was
  exhausted mid-round. From then on the emulator was verified **structurally**
  (accessibility tree: text, order, bounds, states) and the screenshots in `after/`
  were captured for review but not re-read by the implementer. This is a real gap in
  the acceptance evidence, not a claim of a pixel match: the viewer, the calendar
  marks, the statistics states and every dark capture still need a human look.
* iOS was **not** run (no macOS host here). The code only uses cross-platform React
  Native APIs (`PanResponder`, `Animated`, paging `ScrollView`), but that is an
  argument, not a test.

## 4. Screenshots

`docs/design/round3/before/today-current.png` is the pre-r3 Today screen captured by
the previous session. `docs/design/round3/after/` holds this round:

| File | What |
|---|---|
| `light-today.png` | Today, 1 Nov, three photos on the Morning snack card, `Go to today` |
| `light-viewer.png`, `light-viewer-options.png` | full viewer and its options sheet |
| `light-calendar.png` | month board + selected-day agenda |
| `light-statistics-week.png`, `-week-data.png`, `-day.png`, `-month.png`, `-year.png` | every period, including an empty week and a week with data |
| `light-settings.png`, `light-settings-bottom.png` | grouped Settings, top and bottom |
| `dark-today.png`, `dark-calendar.png`, `dark-statistics-week.png`, `dark-settings.png` | the same surfaces in dark |
| `dp360-today.png`, `dp360-calendar.png` | 360 dp width |
| `large-text-today.png`, `large-text-settings.png` | `font_scale 1.3` |

## 5. Rollback (keeps user data)

```bash
# code only - the installed app and its data stay as they are
git checkout redesign/visual-refresh-20261101-r2      # or: git reset --hard 0001423
```

To go back on the device without losing anything, install the pre-r3 build over the
current one (`adb install -r`, same signature ⇒ data kept), built from the backup
tag:

```bash
git worktree add ../diettracker-pre-r3 backup/pre-redesign-r3-20261102-1244
# …or download the APK attached to the backup release
adb install -r DietTracker-1.0.0.0-universal.apk
```

Never uninstall the package (`adb uninstall` / "clear storage") to "start clean":
that deletes the SQLite database and the photographs.

## 6. Known gaps and deliberate deviations

1. **Image inspection quota** — see §3; the second half of the visual comparison is
   left to review.
2. **`Go to today`** is kept as a quiet accent link under the date row. The review
   mockups do not show it, but the brief requires the shortcut, so it appears only
   while the diary shows another day.
3. **`Export data` detail** says "Writes a backup file on this device" instead of the
   mockup's "Backup file or printable report": the phone app writes a `.dtbackup`
   archive only — there is no PDF report implementation on this platform, and
   labelling it as one would be false.
4. **`Photo details`** lists file name, size, added time and cloud state, because the
   app has that data; the mockup's single sentence carries no information.
5. **Prototype clipping** — the mockup's photo row overflows the card edge at 412 dp.
   The native card lets the text column shrink instead, so three thumbnails always
   fit without clipping.
6. **Templates** were left untouched (out of scope for this round).
7. The stray `nul` file in the repository root was **not** deleted (untracked, holds
   no project data); remove it manually if you want a clean tree.

