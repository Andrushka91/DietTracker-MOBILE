# r3 finishing pass — 2 November 2026

Incremental polish of the approved r3 design. **Presentation and input handling
only**: authentication, the SQLite schema, cloud formats, sync behaviour, stored
user data and the meal rules are untouched, and no release was built, merged or
published.

| | |
|---|---|
| Checkpoint (recoverable) | tag `checkpoint/r3-liked-20261102-polish` → `14df853` (the reviewed r3 state) |
| Refinement branch | `r3/polish` (branched from the checkpoint; **not merged**) |
| Base | `redesign/ui-r3-20261102` @ `14df853` |
| Emulator | `emulator-5554` (Medium_Phone_API_37, 411 dp @ 420 dpi), debug build via Metro |

## The installed build was older than the source (affects audit finding V1)

The APK installed before this pass was built at 15:26; the r3 commits landed at
15:38. The selected-day **square** in the audit's screenshot therefore came from
that older build, not from the current source: `CalendarScreen.styles.dayCircle`
already specifies 30 × 30 with `borderRadius: 15`, and it was introduced by commit
`f807a1a`, i.e. after the APK was built. No style was changed for V1; the shape
was re-checked by reading the style and by running the checkpoint source.

## Findings

### F1 — Photo-source cancellation (fixed)

`ChoiceDialog` (new, `src/ui/components/dialogs.tsx`) asks a question with three
real answers — **Camera**, **Gallery**, **Cancel**. `DashboardScreen` keeps the
question in its own `photoSource` state, so:

* backdrop, Android Back, Cancel and Close only dismiss (`onCancel`);
* only an explicit Camera/Gallery row calls `pickPhotos`, which keeps its
  `photoBusyRef` concurrency guard, the limit check and the unchanged storage /
  journal / sync callbacks;
* the dialog card swallows its own touches, so a tap on the text is not a
  backdrop tap.

Evidence: `before/photo-source.png` (Gallery | Camera, no Cancel; Back opened
`com.google.android.photopicker` — reproduced on the checkpoint source) vs
`after/photo-source.png`. On device: backdrop → still in `MainActivity`, no
picker; Back → same; Camera → camera app; Gallery → photo picker (both
deliberate, both cancelled without selecting anything).

### F2 — Template target validation (fixed)

`src/ui/dates.ts` classifies a typed date as blank / wrong shape / impossible day
(`2026-02-31`). `PromptDialog` keeps the form and the typed value open, shows the
reason under the field and **does not confirm**. Only a valid value reaches
`applyTemplate`; the "Today" chip only fills the field. The confirm label is
"Apply template" (not OK) and the merge/status/photo rules are unchanged.

Not applied to real meals during testing: only invalid values were confirmed, and
the two verified states were "dialog stays open with the error" (screenshot in
the session) and "Cancel/Back closes".

### F3 — Date context (fixed)

`dateHandoff()` adds a monotonic request id to the navigation parameters.
Tapping the diary date opens the Calendar on that day *and* month; the Calendar
re-applies a hand-off when the id changes, so asking for the same date again
after browsing to another month works, while an ordinary tab tap (no new
parameters) leaves the calendar where it was. Verified on device: 1 Nov → date
tap → November 2026 selected; browse to December; back to the diary; date tap →
November 2026 with 1 Nov selected; then December + plain Calendar tab → stayed on
December. `Open day` and the Statistics `View day` now send the same hand-off.

### F4 — Statistics loading (fixed)

One settled snapshot (`{ key, period, rows }`) per request. The heading comes
from the requested range, the body is drawn **only** from a snapshot whose key
matches the current mode/anchor/today; otherwise a loading panel is shown. A
`createLatestRequestRunner` (new, `src/ui/latestRequest.ts`) drops answers from
older requests, so an out-of-order response can no longer win. Domain
calculations (planned-slot completion vs recorded-outcome rate) are unchanged;
settled November totals on device still read 3 / 150 and 3 / 1825 for the year.

## Presentation findings

### P1/P2 — Statistics labels and bars, photo viewer

* Monthly week labels: the row label column grew to 106 pt, wraps to two lines,
  and each "day month" pair is joined with a non-breaking space, so a wrapped
  range keeps its dates whole (`2 Nov –` / `8 Nov`). Verified at 360 dp with a
  1.3 text scale.
* Day mode now prints the year (`Sun 1 Nov 2026`). Yearly fractions keep their
  own width and grow with the text (3 / 1825 and 0 / 155 are complete).
* Pending fills use a new quiet theme token (`barPending`, the review design's
  "line" tone) instead of the solid mid-grey: exact counts stay in the numbers
  and the status glyphs, while rows stop shouting. Checked in light and dark.
* Viewer: the stage is measured between the safe-area header and the compact
  controls/strip/hint instead of being capped at 56 % of the screen (≈ 378 →
  ≈ 595 dp on this device), with contain scaling, zoom bounds and paging
  unchanged. The system status icons are switched to light while the viewer is
  open and restored on close (verified by cropping the top of the screenshot).

### P3 — Calendar empty agenda rows

The row leads with the meal category ("Afternoon snack") in full ink, with
"No meal recorded" underneath in muted text. Planned times, photo counts and the
status pill are unchanged.

### P4 — Editor field labels

Persistent captions above the three fields: **Meal name**, **Notes**, **Planned
time** (also their accessibility labels). Drafts, validation, contextual
`Save all`, single-tap Save and Cancel are unchanged; Cancel on an existing meal
closed the editor and left "Persist"/"Value" exactly as they were.

### P5 — Settings copy and photo detail

Photo storage now reads `0.73 MB on this device` with `3 photos` as the trailing
value, both from the repository and refreshed on focus and on data change. The
expanded schedule text is state-aware: signed-out, offline and connected each get
their own wording, and every variant describes a sync **attempt** rather than
guaranteed delivery. The preference stays editable while signed out because the
copy explains its future effect.

### P6 — Template contents preview

`Preview contents` expands to a read-only list built from the stored template:
category, title (description when there is no title, "No meal name" when both are
empty) and planned time ("No time" when absent). It makes the real content of a
full-day template visible before anything is written — including that a saved day
may carry four empty slots.

### P7 — Today shortcut and density

The separate `Go to today` row is gone; the shortcut now sits in the date row as
a quiet accent `Today` (44 pt target, label "Go to today" for screen readers)
while another day is open. The header is ~30 dp shorter, the date stays centred
between the arrows, and the shortcut is still one tap. Verified at 360 dp and
411 dp, 1.0 and 1.3 text scales.

### V1 — Calendar selected-day shape

No change (see the note at the top): the source already draws a circle; the
audit's square came from the older installed build.

## Checks

| Check | Result |
|---|---|
| `tsc --noEmit` | clean |
| `eslint` on the touched files | **0 errors**, warnings only from the existing rule families (`no-void`, `react-native/no-inline-styles`) |
| `jest` | **19 suites / 128 tests pass** (16 pre-existing untouched, 3 new) |

New focused coverage:

* `__tests__/dialogs.test.tsx` — the photo question offers three answers; the
  backdrop, Cancel and Android Back only dismiss and never start a picker; a card
  tap is not a backdrop tap; the date prompt keeps an invalid value on screen
  without confirming, Today only fills the field, Cancel never applies.
* `__tests__/dateHandoff.test.ts` — blank / malformed / impossible dates, leap
  years, a repeated hand-off for the same date carrying a new id, and invalid
  navigation parameters being ignored.
* `__tests__/latestRequest.test.ts` — a slow earlier answer can never overwrite a
  newer one; a rejected load applies nothing; `invalidate` drops a pending answer.

`__tests__/r3Formatting.test.ts` was updated for the deliberate non-breaking
space in `formatShortDayMonth` (the comment explains why).

## On the emulator

Driven through `adb` on the debug build (the dev-client "Tools" bubble is visible
in some captures and overlaps the next-day arrow; that is the debug overlay, not
the app). Verified:

* light theme, 411 dp and 360 dp, 1.0 and 1.3 text;
* dark theme for Statistics (labels, bars, counts);
* photo question: backdrop/Cancel/Back dismissal, Camera and Gallery launching
  their pickers only when chosen (nothing selected, nothing written);
* template date prompt: an invalid day rejected with the form intact; Back closes;
* date hand-off including the repeated same-date case and plain tab navigation;
* calendar agenda hierarchy for empty slots;
* viewer height, status-bar contrast and close-restores-bar;
* editor labels and Cancel without a write;
* Settings photo count + size and the guest schedule copy.

Captures: `before/` (the checkpoint source, run through Metro) and `after/`.
`before/calendar.png`, `before/settings-top.png` and `before/statistics-week.png`
were taken from the previously installed r3 build before the debug build was
installed (the same source apart from the V1 circle).

## Not verified / remaining gaps

* **Signed-in, offline and authenticated states** (sync, uploads, restores) were
  not exercised; the new Settings variants are wired to `app.signedIn` and
  `SyncState.Offline`, but only the guest variant was seen on screen.
* **Soft keyboard clearance** could not be judged: this AVD runs with a hardware
  keyboard, so no IME opened when a field was focused. No keyboard change was made.
* **Pinch/zoom** gestures were not re-tested (the responder code is unchanged; the
  stage height it uses is now measured).
* **iOS, tablets and landscape** were not run.
* A **release APK** was not rebuilt; verification used the debug build with Metro,
  so this pass makes no claim about a production artefact.
* The F4 loading panel exists and is covered through the ordering runner, but the
  transitional frame was too short to capture on device.
* The template preview prints `No meal name` / `No time` for empty slots: that is
  the template's real content (a saved day keeps all five slots).

## Rollback

```bash
git checkout redesign/ui-r3-20261102        # the reviewed state
git checkout checkpoint/r3-liked-20261102-polish
```

Nothing is merged and no release or tag was published from `r3/polish`.



