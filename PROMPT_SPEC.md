# DIET TRACKER — REACT NATIVE (ANDROID & iOS — EQUAL PRIORITY) — COMPLETE BUILD SPECIFICATION

> **Purpose of this document:** This is a self-contained specification/prompt to be handed to an AI coding agent or a development team to create the React Native version of the Windows Diet Tracker app (WinUI 3 / .NET 10). It must reach **full feature parity**, use the **exact same database schema and cloud dataset** as the Windows app so data is shared live between phone and PC through one Google account, and it **must follow the device's system dark/light theme automatically**. **Android and iOS carry exactly the same priority** — both are first-class targets built from the same codebase, shipped and verified in lockstep. Do not omit any numbered requirement; every item is derived from the existing Windows implementation.

---

## 1. PRODUCT OVERVIEW & GOALS

1.1. Diet Tracker is an offline-first meal planner: **five permanent meal cards per day** (Breakfast, Morning Snack, Lunch, Afternoon Snack, Dinner), tracking of what was actually eaten (DONE / MISSED / PENDING), photographs per meal, reusable templates, a month calendar, statistics, PDF/backup exports, and synchronization with the user's **own Google Drive** account.

1.2. Core data principle (must be preserved exactly): **"The cloud is the copy that survives; local SQLite is a working cache of exactly one signed-in account."** Edits are written locally first and never wait for the network. Connecting an account downloads its dataset at once. Signing out uploads pending changes first and then deletes every local record, photograph and template. Two accounts never see each other's records. Without an account the app fully works offline (Guest Mode), and records created before the first sign-in are **adopted** by that account.

1.3. The React Native app must read and write the **same Google Drive dataset** as the Windows app: same folder layout, same per-record JSON envelope, same schema versions, same local SQLite schema and same migration history. A user signed into the same Google account sees the same meals on Windows and on their phone (Android **or** iOS) simultaneously.

1.4. **Targets, equal priority: Android and iOS (phones and tablets).** Neither platform is "primary": every feature is implemented once for both, both get the same QA, the same release cadence and the same store-readiness work (Google Play **and** the Apple App Store). Platform-specific polish is required on both sides (§11). Desktop wrappers may come later — one codebase.

1.5. Language: **English only** (parity with the current Windows build; no language switch).

---

## 2. NON-GOALS / OUT OF SCOPE

2.1. No Microsoft/OneDrive provider (removed from the Windows app; `ProviderType` value 1 stays reserved in the schema forever).
2.2. No store publication tasks inside the code (but see §13 for Play Store **and** App Store readiness requirements).
2.3. No application-level encryption of cloud backups (provider-side encryption only; the privacy policy states this).
2.4. No automatic merging of conflicting edits — conflicts are always resolved by the user (§7.7).
2.5. No interface-language switch.

---

## 3. TECHNOLOGY STACK & PROJECT LAYOUT

3.1. **React Native (latest stable) + TypeScript (strict)**, created with the React Native community CLI (not the Expo managed workflow) so that native modules for SQLite, notifications and Google Sign-In are fully available on **both** platforms. *(Assumption stated explicitly: no RN code exists in the repo today; this stack is a recommendation — keep the layering of §3.4 regardless of the exact library choices.)*

3.2. Required native capability modules — every choice must work identically on **Android and iOS** (choose equivalents only if they provide the same guarantees on both):
   - **SQLite**: `react-native-quick-sqlite` (or `op-sqlite`) — must support transactions, `PRAGMA user_version`, `VACUUM INTO`, and bundled migration scripts, on both platforms.
   - **Navigation**: `@react-navigation/native` + bottom tabs + native stack (works on both).
   - **Google Sign-In**: `@react-native-google-signin/google-signin` (Android: Google Sign-In SDK; iOS: `GIDSignIn`) — same scopes on both (§7). OAuth 2.0 + PKCE in a browser remains a **desktop-only** concern.
   - **HTTP**: `fetch`/`axios` for Google Drive REST v3 calls.
   - **Secure token storage**: `react-native-keychain` (iOS Keychain / Android Keystore — parity with the DPAPI-protected file token store).
   - **Local notifications**: `@notifee/react-native` (both platforms; actions: Snooze, Mark as DONE, deep link — §10).
   - **Photos**: `react-native-image-picker` (camera + gallery on both), `react-native-image-resizer` (thumbnails).
   - **File system**: `react-native-fs` (photo store, backups, logs) — iOS and Android sandbox paths (§4.6).
   - **PDF**: a library that produces real A4 PDFs on **both** platforms (e.g. `react-native-html-to-pdf`) — §12.
   - **ZIP**: a JS ZIP library capable of writing/reading the `.dtbackup` archive on both platforms (§12.3).
   - **Theme**: built-in `Appearance` / `useColorScheme` on both platforms (§9) — no extra library.
   - **Connectivity**: `@react-native-community/netinfo` (both).
   - **Crypto**: SHA-256 via `react-native-quick-crypto` or a pure-JS sha256 (content hashes, photo dedupe; PKCE only if the desktop flow is ever reused).

3.3. **No analytics/telemetry SDKs.** Logging is a local rotating file only (§14).

3.4. **Layering (mirror the Windows architecture — dependency direction must stay acyclic):**
   ```
   src/
     domain/         (models, enums, business rules, validators, analytics — pure TS, no RN imports)
     data/           (SQLite connection, migrations, repositories, row mappers, photo store,
                      backup/restore, integrity checker)
     cloud/          (Google auth coordinator, Drive storage provider, payload serializer,
                      sync engine, conflict resolver, cloud data session)
     services/       (meal tracking service, profile service, reminders scheduler,
                      connectivity monitor, clock, logging, device id)
     ui/
       screens/      Onboarding, Dashboard, Calendar, Statistics, Templates, Settings
       components/   MealCard, MealCardEditor, PhotoGallery, BusyOverlay, StatusStrip, ...
       navigation/   AppNavigator, linking (deep links)
       theme/        colors, useSystemTheme hook, themed components
       viewmodels/   (hooks per screen, depend only on domain interfaces)
   ```
   The UI layer never touches SQLite, the file system or the network directly; it calls service interfaces only (parity with `IMealCardHost` / `MealTrackingService`).

---

## 4. THE SHARED DATABASE CONTRACT (CRITICAL — MUST BE BYTE-FOR-BYTE COMPATIBLE)

4.1. **Each device owns a local SQLite file** (`diettracker.db`) with the *identical schema and the identical migration history* as Windows. **Cross-device sharing happens through Google Drive** (§7) — not by shipping a DB file. `.dtbackup` archives (§12.3) are also byte-compatible across platforms.

4.2. **Storage conventions (do not change):**
   - Identifiers: **GUID strings** (lowercase `d` format: `xxxxxxxx-xxxx-…`), TEXT columns.
   - Calendar dates: `yyyy-MM-dd` TEXT.
   - Times: `HH:mm:ss` TEXT.
   - Instants: ISO-8601 UTC with offset (`2026-10-19T15:18:50.422+00:00`) TEXT.
   - Structured collections: JSON TEXT. **Never BLOBs for images.**
   - Booleans: INTEGER 0/1. Enums: INTEGER with their exact numeric values (§4.5).
   - Nothing is hard-deleted by normal operations; deletions travel as **tombstones**; the five categories and the daily slots are permanent.

4.3. **Migration engine requirements:**
   - Versioned SQL files `0001_initial.sql` … `0012_remove_language.sql`, applied **in order, transactionally**, tracked with `PRAGMA user_version` (0 → 12).
   - Embedded as bundle assets; each migration logs its name.
   - **Before applying any migration, write a safety copy of the DB (`VACUUM INTO '<path>.pre-vN.bak'`)** and keep one generation.
   - A database created fresh by migration 0001 must be able to run 0002→0012 exactly like the Windows app (0004/0005/0012 are drop/scrub migrations whose "first migration stays applicable to brand new databases" behavior must be reproduced).
   - Never renumber, merge or reorder migrations — a DB file copied from Windows or from the other phone platform must open without repair.
   - Migration semantics to reproduce (summary of each): 0002 adds `SyncMetadata.ManifestRevision` + `LastFullUploadAt`; 0003 adds `AppPreferences.OnboardingCompleted`; 0004 drops `MealEntry.Notes` and scrubs `notes` keys from template JSON; 0005 drops `MealEntry.Ingredients`/`Quantities` and scrubs those keys from templates; 0006 re-adds `Ingredients TEXT NOT NULL DEFAULT ''`; 0007/0009 refresh default meal emoji icons only where the value is still an app-written default (never overwrite a user-chosen icon); 0008 converts `Status = 2 (Missed)` rows to `Status = 0, CompletedAt = NULL` (historic state cleanup — must run exactly once on upgrade, not on fresh installs that never had the old value… actually it applies to any row with Status = 2 at that point in history, so a fresh DB (which then runs it right afterwards) is unaffected because no rows exist yet); 0010 adds `AppPreferences.SyncFrequency INT DEFAULT 1`; 0011 forces `Use12HourClock = 0` when it was 1 **and** queues one pending `SyncOperation` for the active account so the corrected preference is uploaded; 0012 drops `AppPreferences.Language` and `UserProfile.Language`.

4.4. **Final schema (after migration 0012) — implement exactly:**

   - **`UserProfile`**: `Id PK`, `ProviderType INT DEFAULT 0 CHECK (ProviderType IN (0,1,2))`, `ProviderUserId TEXT DEFAULT ''`, `DisplayName TEXT DEFAULT ''`, `Email TEXT DEFAULT ''`, `TimeZone TEXT DEFAULT 'Europe/Bucharest'`, `IsActive INT DEFAULT 0`, `CreatedAt`, `UpdatedAt`, `SyncStatus INT DEFAULT 0`, `CloudRevision TEXT NULL`. Index `IX_UserProfile_Active(IsActive)`; **partial unique** `UX_UserProfile_Identity(ProviderType, ProviderUserId) WHERE ProviderUserId <> ''`. *(Language column was dropped by 0012 — do not recreate it.)*
   - **`MealCategory`**: `Id PK`, `FixedCategoryKey INT UNIQUE CHECK BETWEEN 1 AND 5`, `Name TEXT DEFAULT ''`, `Color TEXT DEFAULT '#FF107C10'`, `Icon TEXT DEFAULT ''`, `DefaultTime TEXT`, `DisplayOrder INT`.
   - **`MealEntry`**: `Id PK`, `LocalProfileId → UserProfile ON DELETE CASCADE`, `Date TEXT`, `MealCategoryId → MealCategory`, `MealCategoryKey INT CHECK BETWEEN 1 AND 5`, `Title TEXT DEFAULT ''`, `Ingredients TEXT DEFAULT ''` *(added back by 0006)*, `PlannedTime TEXT NULL`, `Status INT DEFAULT 0 CHECK IN (0,1,2)` + `CHECK (Status <> 1 OR CompletedAt IS NOT NULL)`, `CompletedAt TEXT NULL`, `CreatedAt`, `UpdatedAt`, `Revision INT DEFAULT 0`, `SyncStatus INT DEFAULT 0`, `CloudRevision TEXT NULL`, `ContentHash TEXT NULL`. **Unique** `UX_MealEntry_Slot(LocalProfileId, Date, MealCategoryKey)`; indexes on `(LocalProfileId, Date)`, `SyncStatus`, `Status`. *(Notes dropped by 0004; Quantities dropped by 0005.)*
   - **`MealPhoto`**: `Id PK`, `MealEntryId → MealEntry ON DELETE CASCADE`, `OriginalFileName`, `LocalFileId`, `ThumbnailId DEFAULT ''`, `CloudObjectId NULL`, `CloudRevision NULL`, `MimeType DEFAULT 'image/jpeg'`, `FileSize INT DEFAULT 0`, `ContentHash TEXT DEFAULT ''`, `CreatedAt`, `UpdatedAt`, `SyncStatus INT DEFAULT 0`. Indexes `IX_MealPhoto_Meal`, `IX_MealPhoto_Hash`, `IX_MealPhoto_SyncStatus`.
   - **`MealTemplate`**: `Id PK`, `LocalProfileId → UserProfile CASCADE`, `Name TEXT NOT NULL`, `IsFullDay INT DEFAULT 0`, `TemplateData TEXT DEFAULT '{}'`, `RecurrenceRules TEXT NULL`, `CreatedAt`, `UpdatedAt`, `SyncStatus INT DEFAULT 0`. Index on `LocalProfileId`.
   - **`ReminderSettings`**: `Id PK`, `LocalProfileId → UserProfile CASCADE`, `MealCategoryId`, `MealCategoryKey`, `Enabled INT DEFAULT 0`, `Time TEXT`, `Weekdays INT DEFAULT 127 CHECK BETWEEN 1 AND 127`, `SnoozeMinutes INT NULL`, `UpdatedAt`, `SyncStatus INT DEFAULT 0`. **Unique** `(LocalProfileId, MealCategoryKey)`.
   - **`ReminderFired`**: `Id PK`, `ReminderId → ReminderSettings CASCADE`, `Date TEXT`, `FiredAt TEXT`, `MealEntryId NULL`. **Unique** `(ReminderId, Date)` — the never-fire-twice ledger; must survive restarts.
   - **`AppPreferences`**: `LocalProfileId PK → UserProfile CASCADE`, `TimeZone TEXT DEFAULT ''`, `ShowSnackCards INT DEFAULT 1`, `StartWithWindows INT DEFAULT 0`, `MinimizeToTray INT DEFAULT 0`, `RemindersEnabled INT DEFAULT 1`, `Use12HourClock INT DEFAULT 0`, `SynchronizationEnabled INT DEFAULT 0`, `PreferredProvider INT DEFAULT 0`, `CloudUploadConsentGranted INT DEFAULT 0`, `UpdatedAt TEXT`, `SyncStatus INT DEFAULT 0`, `OnboardingCompleted INT DEFAULT 0` (0003), `SyncFrequency INT DEFAULT 1` (0010). *(Language dropped by 0012.)*
   - **`CloudAccount`**: `Id PK`, `ProviderType INT CHECK IN (1,2)`, `ProviderUserId DEFAULT ''`, `DisplayName`, `Email`, `RootFolderId NULL`, `LastAuthenticatedAt NULL`, `LastSynchronizedAt NULL`, `IsActive INT DEFAULT 0`, `SynchronizationEnabled INT DEFAULT 1`, `QuotaTotalBytes NULL`, `QuotaRemainingBytes NULL`. Unique `(ProviderType, ProviderUserId)`; **partial unique `UX_CloudAccount_Active(IsActive) WHERE IsActive = 1` (exactly one active account)**.
   - **`SyncOperation`** (durable outbox): `Id PK`, `CloudAccountId → CloudAccount CASCADE`, `EntityType INT`, `EntityId TEXT`, `OperationType INT`, `Status INT DEFAULT 0`, `EntityRevision INT DEFAULT 0`, `RetryCount INT DEFAULT 0`, `LastError NULL`, `NextAttemptAt NULL`, `CreatedAt`, `CompletedAt NULL`. Indexes on `(CloudAccountId, Status, CreatedAt)` and `(EntityType, EntityId)`.
   - **`SyncMetadata`**: `CloudAccountId PK → CloudAccount CASCADE`, `ProviderType`, `LastSyncCursor NULL`, `LastSyncTimestamp NULL`, `SchemaVersion INT DEFAULT 1`, `DeviceId TEXT DEFAULT ''`, `ManifestRevision TEXT NULL` (0002), `LastFullUploadAt TEXT NULL` (0002).
   - **`ConflictRecord`**: `Id PK`, `EntityType`, `EntityId`, `LocalPayload`, `RemotePayload`, `LocalModifiedAt`, `RemoteModifiedAt`, `RemoteRevision NULL`, `DeviceId NULL`, `DetectedAt`, `IsResolved INT DEFAULT 0`. Index `(IsResolved, DetectedAt)`.
   - **`DeletionTombstone`**: `Id PK`, `EntityType`, `EntityId`, `DeletedAt`, `SyncStatus INT DEFAULT 3`. **Unique `(EntityType, EntityId)`**.

4.5. **Enum numeric values (persisted — never change):**
   - `MealCategoryKey`: Breakfast=1, MorningSnack=2, Lunch=3, AfternoonSnack=4, Dinner=5.
   - `MealStatus`: Pending=0, Done=1, Missed=2.
   - `SyncStatus`: PendingUpload=0, Synced=1, PendingUpdate=2, PendingDelete=3, Failed=4, Conflict=5.
   - `ProviderType`: None=0, ~~Microsoft=1 (reserved, never reuse)~~, Google=2.
   - `EntityType`: UserProfile=0, MealEntry=1, MealPhoto=2, MealTemplate=3, ReminderSettings=4, AppPreferences=5, MealCategory=6.
   - `SyncOperationType`: Upsert=0, Delete=1.
   - `SyncOperationStatus`: Pending=0, InProgress=1, Completed=2, Failed=3, Abandoned=4.
   - `SyncFrequency`: Manual=0, Weekly=1 (**default**), Monthly=2.
   - `SyncState`: NotConfigured=0, Synced=1, Syncing=2, PendingChanges=3, Offline=4, AuthenticationRequired=5, Error=6, Paused=7.
   - `SyncTrigger`: Startup=0, PostSignIn=1, LocalChange=2, ConnectivityRestored=3, Periodic=4, Manual=5, PostRestore=6.

4.6. **Local data folders (private app sandbox on each platform — mirror the Windows layout):**
   ```
   <documents>/DietTracker/            (iOS: <sandbox>/Documents; Android: <filesDir>/DietTracker —
                                        move to app-private storage, NOT shared external storage)
       database/diettracker.db         (+ pre-migration safety copies)
       photos/<LocalFileId>            original bytes, never in SQLite
       photos/<ThumbnailId>            thumbnails (256 px, JPEG q80)
       backups/                        .dtbackup exports, safety copies
       logs/diettracker.log            1 MB cap, rotate once to diettracker.log.1
       secure/                         device id file (token store lives in Keychain/Keystore)
       appsettings.json                optional googleClientId / googleClientSecret
   ```

---

## 5. DOMAIN MODEL & BUSINESS RULES (PORT 1:1 — NO INVENTION)

5.1. **Five permanent slots.** `SlotCount = 5`, always all present, never deletable, order fixed: Breakfast, Morning Snack, Lunch, Afternoon Snack, Dinner. Main meals (larger cards): Breakfast, Lunch, Dinner. Snacks (compact cards): Morning Snack, Afternoon Snack. On load, **normalize/heal** the category set: merge persisted rows with defaults, dedupe by `FixedCategoryKey`, preserve user customizations; a DB that lost a row is repaired instead of showing fewer cards.

5.2. **Default categories** (name empty = use localized default; color `#AARRGGBB`; icon = food **emoji**; default planned time; display order):
   | Key | Color | Icon | Default time | Order |
   |---|---|---|---|---|
   | Breakfast | `#FF0F6CBD` | 🥐 (U+1F950 + VS16) | 07:30 | 0 |
   | Morning Snack | `#FF8764B8` | 🍪 (U+1F36A + VS16) | 10:30 | 1 |
   | Lunch | `#FF107C10` | 🍽 (U+1F37D + VS16) | 13:30 | 2 |
   | Afternoon Snack | `#FFCA5010` | 🍪 (U+1F36A + VS16) | 17:00 | 3 |
   | Dinner | `#FFB146C2` | 🍲 (U+1F372 + VS16) | 20:00 | 4 |
   An empty `Icon` column falls back to the slot default. An icon changed by the user is never overwritten by migrations.

5.3. **Slot creation:** exactly one `MealEntry` per (profile, date, category) — created lazily on first touch; placeholder slots carry `PlannedTime = null` and produce no cloud traffic/journal noise. Placeholder rows are never deleted.

5.4. **Completion lifecycle (user-driven only — the clock NEVER reclassifies):**
   - `MarkDone`: refused if date > today (`future-locked`); no-op if already Done (`already-done`); refused if title **and** description are both empty (`empty-content` → UI shows the "edit the meal first" dialog with OK / Edit buttons). On success: Status=Done, `CompletedAt = now`, `UpdatedAt`, `Revision++`. **Idempotent** — repeated calls preserve the original timestamp so statistics are never incremented twice.
   - `MarkMissed`: refused if date > today; no-op if already Missed (sticky — never cycles back to Pending). Clears `CompletedAt`.
   - Past and today are editable in both directions (a forgotten day can be corrected). Future days are locked in Pending for state buttons only — **content may still be planned ahead** on future dates.
   - `Pending` is never a transition target; it is the default state of the database and of an untouched day.
   - Time alone never reclassifies a meal: a skipped day keeps its Pending meals forever.

5.5. **Validation (exact limits & codes):**
   - Title: required on editor save; max **120** chars (`meal.title.required`, `meal.title.tooLong`).
   - Description (`Ingredients`): required on editor save; max **2000** chars (`meal.ingredients.required`, `meal.ingredients.tooLong`).
   - Category must be one of the five permanent keys and linked to a real category row and profile (`meal.category.invalid`, `meal.category.missing`, `meal.profile.missing`).
   - Consistency: Done ⇒ `CompletedAt` present (`meal.completedAt.missing`); not Done ⇒ `CompletedAt` null (`meal.completedAt.unexpected`).
   - Planned time input: `HH:mm`; invalid input blocks the save with `Meal_InvalidTime`; **empty input = category default time** (`PlannedTime = null`).
   - The **clear** action validates with `requireContent = false` (it deliberately writes the empty placeholder back).
   - Every validation failure maps to a localized message shown on the card's own error line.

5.6. **Photographs:**
   - Max **3** per meal (`photo.limit.reached`), max **10 MB** each (`photo.tooLarge`), non-zero size (`photo.empty`).
   - Accepted: JPEG / PNG / WEBP (`photo.format.unsupported`); **magic-byte signature sniffing** required (`photo.content.invalid`) — a renamed file must be rejected (JPEG `FF D8 FF`; PNG 8-byte PNG signature; WEBP `RIFF....WEBP`).
   - **Duplicate detection**: SHA-256 of bytes already attached to the *same meal* ⇒ refuse with `photo.duplicate` ("Photo was already uploaded").
   - Thumbnails: max dimension **256 px**, JPEG quality **80**, stored as files (never BLOBs).
   - Photos are attached only to meal entries that exist locally; downloads are repaired on later cycles (meal/photo ordering §7.6).
   - Additional codes for the resource map: `photo.source.missing`, `photo.format.unsupported`.

5.7. **Copy & template rules:**
   - Copying a meal/day to another date always produces **PENDING**, `CompletedAt = null`, no photos, `Revision = 0` — completion state and photographic evidence are deliberately never copied; the source entry is never mutated by a copy.
   - Templates capture only: `MealCategoryKey`, `Title`, `Ingredients`, `PlannedTime`. **Never status, never photos.**
   - Two template kinds: single-meal (`IsFullDay = 0`, `TemplateMealSlot`, `TemplateMeal`) and full-day (`IsFullDay = 1`, `TemplateDay` = array of up to 5 contents, ordered by key).
   - Applying a template materializes PENDING entries for the chosen date (merging with existing slots — only slots present in the template are produced, missing slots stay untouched).

5.8. **Analytics rules:** shares are computed over *decided* meals (Done + Missed); a period with zero decided items shows "–" (never "0 %"). Wording stays neutral (no punitive language — this is a data tracker, not a medical claims tool).

5.9. **Integrity checker** (exposed in Settings → "Check integrity", read-only): verifies (a) all five categories exist, (b) one slot per profile/date/category, (c) no orphaned photographs, (d) completion state consistency (`CompletedAt` ↔ Status), (e) row/index sanity. Reports `OK` or a count plus issue codes (`Settings_IntegrityOk` / `Settings_IntegrityIssues`).

---

## 6. APPLICATION SHELL, NAVIGATION & CROSS-CUTTING UI

6.1. **Screens:** Onboarding (first launch only), then the main shell with **Dashboard, Calendar, Statistics, Templates** and **Settings** (fifth tab). English labels: `Nav_Dashboard/Calendar/Statistics/Templates/Settings`.

6.2. **Navigation layout (identical concept on Android and iOS):** bottom tab bar with 5 tabs (Dashboard 🏠, Calendar 📅, Statistics 📊, Templates 📋, Settings ⚙) — icons semantically equivalent to the Windows glyphs (home `E80F`, calendar `E787`, stats `E9D2`, templates `E8EF`, gear `E713`). On tablets/landscape, a left compact rail is acceptable. **Android hardware back** navigates to Dashboard before exiting; **iOS** relies on tab persistence (no exit gesture) — both platforms must never lose unsaved inline editor state on navigation away without confirmation of data loss rules in §8.3.

6.3. **Synchronization status strip** (top of shell, above content):
   - States & severities: `Syncing`/`PendingChanges`/`Paused` = informational; `Offline`/`AuthenticationRequired` = warning; `Error` = error; `Synced` = success showing "Last successful synchronization" timestamp (`Sync_LastSuccess`); `NotConfigured` = strip closed.
   - Success messages **auto-hide after 6 seconds**; warnings/errors stay until resolved; touching/hovering the strip pauses/restarts the countdown.
   - **Background cycles are silent** (startup, hourly scheduler, local-change debounce, connectivity, state refresh): they never flash the strip. Only `Manual` ("Synchronize now") triggers progress UI, the confirmation strip, and the result notification.

6.4. **Busy overlay** (modal scrim over the whole UI, input-swallowing): dark translucent background (`#C2000000`-equivalent), spinner, one sentence naming the stage, plus a hint line. Stage messages: waiting for browser, uploading your changes, downloading your account's data, loading account, synchronizing, signing out and deleting the local data, restoring, deleting cloud data. While a **sign-out or a synchronization** runs the app must **block navigation/back/close** (Android back disabled; iOS swipe-back and tab switches disabled) with a "wait" hint, protected by a **2-minute safety timeout** that releases the block so a dead provider cannot trap the user.

6.5. **Dialogs (parity list — each must exist with the same default-safe behavior):** Clear meal (Yes/No, **default No**, dismiss = No), Remove photo, Empty-content DONE (OK / **Edit** opens the editor), Mark-all-done partial (some meals skipped because empty), Save-as-template name prompt (default `yyyy-MM-dd`), Apply template date picker, Restore backup confirm, Sign-out (two variants: normal, and pending-changes with count + explicit "discard changes" path), Restore-from-cloud confirm, Restore preview (counts + date range), Calendar export chooser (4 scopes).

6.6. **Status messages:** each screen has a caption/status line (e.g. "Saved", "Template saved", "Backup created (n meals, n photos)", "All meals confirmed", save-all partial `saved/total`, integrity results). On Settings it floats over the bottom-right area so toggles never shift layout.

---

## 7. GOOGLE SIGN-IN, CLOUD STORAGE & SYNCHRONIZATION (THE SHARED DATA LAYER)

### 7.1 Authentication
7.1.1. **Scopes (minimal, exactly):** `openid`, `email`, `profile`, `https://www.googleapis.com/auth/drive.appdata`.
7.1.2. The user's Google account is chosen through the **native Google Sign-In SDK on both Android and iOS** (`@react-native-google-signin/google-signin`: `signIn()` with interactive consent; `signInSilently()` on start). This is the mobile equivalent of the desktop flow ("system browser, never an embedded web view"): verify id-token nonce/state, exchange/refresh per platform SDK rules. **Access tokens must be refreshed (or auto-refreshed by the SDK) with a ~5-minute pre-expiry margin**; on revoked/expired refresh token raise `AuthenticationRequired` and ask the user to re-authorize — **never delete local records because of an auth failure**.
7.1.3. Tokens are stored in the **Keychain (iOS) / Keystore (Android)** via `react-native-keychain` (DPAPI equivalent), never in plain AsyncStorage/SQLite; token reads must be available before UI decides signed-in state.
7.1.4. Client configuration: Android `google-services.json` / SHA-1 fingerprint and iOS `GoogleService-Info.plist` / URL scheme, plus optional runtime config equivalent to `appsettings.json` (`googleClientId`, `googleClientSecret`); **no secret in the repo**; a missing/misconfigured client fails fast with a clear localized message (`Auth_google_not_configured`), never a broken consent page.
7.1.5. Full localized error taxonomy must be reproduced (keys): `Auth_Cancelled`, `Auth_Unknown`, `Auth_auth_no_account`, `Auth_auth_interaction_required`, `Auth_auth_silent_failed`, `Auth_google_unauthorized`, `Auth_google_insufficient_permissions`, `Auth_google_refresh_rejected`, `Auth_google_state_mismatch`, `Auth_google_code_exchange_failed`, `Auth_google_identity_unavailable`, `Auth_google_network_error`, `Auth_google_access_denied`, `Auth_google_authorization_cancelled`, `Auth_google_invalid_token_response`, `Auth_google_refresh_failed`, `Auth_google_refresh_token_missing`, plus sync failures `Auth_sync_offline`, `Auth_sync_authentication_required`, `Auth_sync_quota_exceeded`, `Auth_sync_restore_failed`, `Auth_sync_failed`. (The loopback-specific codes are desktop-only but must remain harmless no-ops if received from a shared payload.)
7.1.6. **Silent session restoration** on every app start; sign-in is interactive only when silent restore fails.

### 7.2 Cloud layout (must match Windows byte-for-byte)
```
<Drive appDataFolder (hidden, app-private)>/
    manifest.json                      dataset description (schemaVersion, device, counts)
    entities/MealEntry/<guid>.json      one document per record (envelope + payload)
    entities/MealPhoto/<guid>.json      photograph metadata
    entities/MealTemplate/<guid>.json
    entities/ReminderSettings/<guid>.json
    entities/AppPreferences/<profileGuid>.json
    entities/MealCategory/<guid>.json
    entities/UserProfile/<guid>.json
    photos/<photoGuid>.bin             photograph bytes (never inside SQLite)
```
- Envelope header fields (parsed without full deserialize): `entityId`, `entityType` (number **or** name — accept both), `schemaVersion`, `revision`, `updatedAt`, `deviceId`, `isDeleted`, `contentHash`. `CloudSchema.CurrentVersion = 1`, `MinimumSupportedVersion = 1`; documents with a *higher* schema are skipped; lower than minimum skipped; corrupt JSON is ignored (never crashes).
- The app **never** sees the user's other Drive files (only `drive.appdata` scope).
- Google specifics: addressing = flat file names in `appDataFolder` mapped to these logical paths; concurrency token = file `version`; change tracking = **modified-time watermark** (the changes feed cannot be scoped to appDataFolder — objects may be examined twice; all applies are idempotent, so only extra traffic results); large uploads multipart/resumable as needed; quota via `about?fields=storageQuota` shown as remaining cloud space in Settings.
- Logical-path helpers must match: entity docs `entities/{EntityType}/{guid}.json`, photo meta `entities/MealPhoto/{guid}.json`, photo bytes `photos/{guid}.bin`, manifest `manifest.json`; `IsManaged(path)` recognizes only these prefixes.

### 7.3 Offline-first engine (exact behavior)
1. User action → **transactional local SQLite write** first → journal a `SyncOperation` (outbox) → UI updates immediately.
2. Debounced background push after **3 s** (rapid edits coalesce into one cycle; never blocks the caller).
3. Uploads leave the device as soon as they are saved when: an account is connected, uploads enabled, device online.
4. **Triggers**: after sign-in, at startup, after local changes (debounced 3 s), on connectivity restored, on manual "Synchronize now", periodically (hourly scheduler knock), after restore.
5. The **schedule in Settings** (Weekly default / Monthly / Manual) only paces *pulling changes made elsewhere*; it never delays an already-journaled upload. "Manual" ("only with the button below") keeps **every automatic cycle** off — only the explicit button runs a cycle — while the journal still keeps every change safe in the meantime.
6. **Failure handling**: a failing provider can never corrupt or block local data — the cycle is caught, state becomes `Error`, operations stay in the outbox with **exponential backoff 5 s → 15 s → 45 s … capped at 30 minutes**, `RetryCount`/`LastError`/`NextAttemptAt` recorded.
7. Auth failures from background work surface as `AuthenticationRequired` — **no interactive prompt from background**.
8. **Echo suppression**: pull skips documents whose `deviceId` equals this installation — *but only while the local record still exists*; after a purge the same document must be applied; `RebuildFromCloudAsync` applies **every** document regardless (interrupted rebuilds are repaired by the next cycle).
9. Uploads are **idempotent** (content hashes + revisions); deletions travel as **tombstones**; a meal slot deleted on another device is **cleared, not removed** (the five cards are permanent).
10. Concurrency: concurrent cycle requests coalesce through their trigger; exactly one cycle runs at a time.

### 7.4 Cloud-only account lifecycle (must be identical to Windows)
| Moment | Behavior |
|---|---|
| Start-up, account connected | keep cache |
| Start-up, **no** account | delete surviving cache — *unless* the journal still holds never-uploaded changes or the install was never connected (those records are the only copy and survive until a sign-in can upload them) |
| Before sign-in | upload everything still pending; a change that cannot be uploaded **refuses the sign-in** (cache untouched — a cancelled sign-in costs nothing); records the cloud has never seen are **adopted** (uploaded), not deleted |
| After sign-in | **purge** cache (records, photos, journal, cursor, conflicts, tombstones) then `RebuildFromCloudAsync` downloads the whole dataset at once — screens show that account only |
| Sign-out | upload pending → remove credentials (Keychain/Keystore) → delete local cache (meals, photos, templates, journal, cursor, conflicts, tombstones). If changes cannot be uploaded (offline/uploads off) the sign-out is **refused** (`Account_SignOutPending*` dialog with count; user may explicitly **discard** — `Account_SignOutDiscarded`) |
| Crash safety | a cache that survives a crash without a connected account is removed at the next start (rules above) |

One account at a time (partial unique index), accounts matched by `ProviderType + ProviderUserId`, **never by e-mail address**.

### 7.5 Status reporting
Derive state from the stored account at start-up (`RefreshStateAsync`) so screens don't depend on a cycle having run; persist and restore the "last successful synchronization" timestamp so it survives a restart. `Synced` is reported **only after provider confirmation**. Signed-in with uploads off = `Paused`; before first cycle = `PendingChanges`; no account = `NotConfigured`.

### 7.6 Restore / recovery
- `PreviewRestoreAsync`: counts + date range without downloading (`Account_RestorePreview`, `Account_PreviewIntro`, `Account_NoCloudData`).
- `RestoreAsync`: **merges** (never deletes) — a failed restore is harmless; photos restored after their meal exists locally (a second cycle completes the restore if both arrived in the same pass).
- `RebuildFromCloudAsync`: used by the cloud-only lifecycle (empty cache, applies all documents including this installation's own uploads).
- `PushAllAsync`: queues every local record (first sign-in adoption, post-provider-switch).
- Local `.dtbackup` works with **no** account.

### 7.7 Conflicts (conservative, user-decided)
- Detect via content hashes + provider revision/version + `updatedAt`; store **both** payloads in `ConflictRecord` (never auto-merge).
- Resolution UI: keep local / keep remote / **keep both** (the local version is stored as a template named *"Conflict copy"* so nothing is lost).
- Unresolvable (no usable revision token) ⇒ both versions preserved, user asked which to keep.
- Open conflicts are listed/resolved via `IX_ConflictRecord_Open`; resolving marks `IsResolved = 1`.

### 7.8 Sign-in/out + sync UX copy (parity strings)
`Account_SignedIn`, `Account_SignedOut`, `Account_GuestInfo`, `Account_NoEmail`, `Account_Quota`, `Account_SyncResult`, `Account_CloudSaveHint`, `Account_ConsentText`, `Account_ConsentRequired`, `Account_PrivacySummary`, `Account_ProviderNone/Google`, `Account_GuestDescription`, `Account_CloudDataLoaded/Pending`, `Account_SignInPendingChanges`, `Account_SignOutTitle/Message/PendingTitle/PendingMessage/PendingDetail/PendingKept/Discarded`, `Sync_*` (§6.3), `Busy_*` (§6.4), `Account_Preview/Restore/RestoreTitle/RestoreMessage/RestoreDone`.

---

## 8. SCREEN-BY-SCREEN FEATURE SPECIFICATION

### 8.1 Onboarding (first launch only — `OnboardingCompleted` flag)
- Title + description; card "Choose how to keep your data": **Sign in with Google** and **Continue without an account** (guest description caption).
- Consent toggle: *"I agree to upload my meal data and photographs to the account I choose"* — sign-in without consent is refused with `Account_ConsentRequired`.
- Guest path: `SynchronizationEnabled = false`, complete immediately.
- Google path: set consent + `SynchronizationEnabled = true` → busy overlay phases: *uploading local changes → waiting for browser/native consent → downloading account data*; sign-in failure shows a localized reason **and still finishes onboarding** (offline must never block first use).
- UI spinner while busy; status message line for errors.

### 8.2 Dashboard
- **Header card:** date label; buttons **Previous / Today / Next**; progress bar of completion percentage; three colored counters with square chips: **Done `#FF107C10`, Missed `#FFA4262C`, Pending `#FF8A8886`** (counts + labels Done/Missed/Pending).
- **Day actions row:** *Mark all DONE* (green check, enabled iff ≥1 card can be confirmed; skips empty meals and afterwards shows the "some meals were skipped — edit them first" dialog once), *Mark all MISSED* (red cross, enabled iff ≥1 card can be marked; on future days ⇒ disabled), **Save as template** (day template, name prompt default `yyyy-MM-dd`), **Save all** (saves every open inline editor; enabled iff ≥1 editor open; per-card validation — invalid cards keep their editor open with their own error line while valid ones are written; status reports `saved/total`; one progress refresh + one sync request for the batch), and a status caption.
- **Five meal cards** in a responsive layout that keeps meal order at any screen size: **two cards per row (Breakfast+MorningSnack, Lunch+AfternoonSnack), Dinner spans both columns** on wide screens; on narrow phones cards stack 1- or 2-column as space allows **while preserving order**; cards in a row are **equal height**, nothing scrolls inside a card (long text trimmed: title max 2 lines, description max 3 lines).
- Loading indicator (indeterminate) only while loading; never leaves an empty gap.
- `ShowSnackCards` preference exists in data (synced); the current Windows UI always shows all five — keep the column and sync behavior; exposing a toggle is optional (§17.5).

### 8.3 Meal card anatomy (identical in read and edit mode)
- **Header:** icon (emoji at ~36 pt, per-slot fallback), category name (fixed, never editable/deletable), effective planned time caption (`HH:mm`), **status pill** (icon + text: Pending gray / Done green / Missed red, white text).
- **Read mode:** title (semibold, 2 lines), description (3 lines), closable warning banner for card errors, then bottom row: **photo gallery** (left) and action bar + completion timestamp caption (right).
- **Action bar order:** 📷 Add photo → ✏ Edit → 🗑 Clear (red, disabled when the card is already empty: `CanClear` = has title/description/time/state/photos) → ✕ Mark MISSED (disabled on future days / already missed) → ✓ Mark DONE (disabled on future days / already done / empty content). All icon buttons carry accessibility labels ("Add photo", "Edit", "Clear meal", "Mark as MISSED", "Mark as DONE").
- **Inline editor** (no navigation): fields Title, Description, Planned time (`HH:mm`, invalid ⇒ error, empty ⇒ category default), Save / Cancel. Save validates through the domain validator and shows failures on the card's error line; Cancel reloads **only this card** from persistence — other cards (including other open editors) keep unsaved state. The action-bar row is replaced while editing; the card never grows beyond its min height.
- **Clear** wipes text, planned time, state and photos behind a Yes/No dialog (default No).
- **DONE on an empty card** opens the "edit first" dialog (OK / Edit → opens the editor).
- Editing a DONE meal never clears its completion automatically.

### 8.4 Photographs
- Grey framed gallery inside the card: header counts them (`Photo_GalleryHeader`), tap a tile opens full size (in-app viewer, both platforms), each tile has its own **X** to remove (confirmation dialog `Photo_RemoveTitle/Message`).
- Add: multi-pick up to the remaining slots (`3 − current`); each file goes through validation (§5.6); errors shown on the card (`Photo_LimitReached`, `photo.*` codes).
- Duplicates by SHA-256 per meal refused with "Photo was already uploaded".
- Originals + thumbnails as files; thumbnails generated locally (256 px, JPEG q80); gallery tiles use thumbnails, full-size viewer uses originals; calendar mini-cards use the first photo's thumbnail.
- Photos restore only after their meal exists locally; a second cycle completes a same-pass arrival (documented limitation — keep it).

### 8.5 Calendar
- Microsoft-calendar-style month view: month/year header, **Today / ‹ prev / › next / Open day** buttons, selected-day summary line, **7-column weekday header (Monday first)**, grid of day cells.
- **Day cell colors:** gray = untouched/pending; **green = every meal of the day was eaten**; **red = at least one meal missed**; border repeats the background tint; **today** keeps accent fill around the day number; pressing a cell selects it (accent selection color).
- Cell content: day number (top-left), **photo marker + completion percentage** (top-right), then **mini cards** for recorded meals (max 5, two per row): first photo thumbnail + title + second line (description, or the slot status when no description), framed in the slot's state color. Mini cards are inert: tap selects the day, double-tap (or "Open day") opens it.
- Meals never recorded stay pending and produce **no figure** in the percentage.
- **Legend row:** green / red / gray squares with labels (`Calendar_LegendGreen/Red/Pending`).
- "Open day" navigates to the Dashboard on that date.
- Theme-dependent values (day text, secondary text, tints) must be **re-resolved when the system theme changes while the screen is visible** — no stale colors in already-rendered cells.
- Month label like "October 2026"; day summary caption (`Calendar_DaySummary`); weekday names `Calendar_Weekdays` (Monday first).

### 8.6 Statistics ("Progress and statistics")
- Period navigation: **Previous week / This week / Next week** + period label.
- Three period cards (**Today**, **This week**, **This month**), each with: summary line (done days / missed days counts) and three **vertical state slices** — count and percentage at top, a bar that rises from the bottom to the state's share, state name + color chip at the bottom; slices wrap responsively (min item width ~84).
- Three trend charts in a row: **weekly** (one bar per day of the visible week), **monthly** (one bar per week of the month, labeled with its day range), **yearly** (one bar per month of the visible year, labeled with month name). Bar = accent fill rising to the percentage; label + percentage printed **as text** (never tooltips); days with no decided meals print "–".
- Neutral disclaimer caption (`Statistics_Disclaimer`).
- Week starts Monday (same as the calendar).

### 8.7 Templates
- List sorted by `UpdatedAt` desc; each row: name, kind label (**Meal** / **Day**), summary (meal title/description, or `n meals` for a day), updated timestamp, **Apply to date** button (date picker; default today) → status "Applied for {date}" (`Template_Applied`).
- Empty state text (`Template_Empty`); notice caption: *"Templates never contain completion state or photographs."*
- Templates are created from the Dashboard (**Save as template** for the whole day → `Template_Saved`; the service also supports single-meal templates — expose "Save meal as template" if parity with `SaveTemplateAsync` is desired; at minimum the day path must exist).
- Applying merges into the target date as PENDING entries.
- (No rename/delete UI on Windows — do not add destructive template management without a matching Windows change.)

### 8.8 Settings (two-column card grid on tablet → stacked cards on phone; same order & contents)
1. **Guest InfoBar** (visible only when signed out): "You are using Diet Tracker without an account" + privacy summary.
2. **Account card:** framed ~120×120 avatar tile (Google profile photo, else glyph), provider + remaining cloud space line (`Account_Quota`), **e-mail headline** (selectable text), **Sign in with Google** (accent) *or* **Sign out** button, then the two captions: what a signed-in account stores (`Account_CloudSaveHint`) and the consent text (`Account_ConsentText`). *No upload switch — signing in is the consent.*
3. **General card:** auto-save hint ("Every change is saved immediately; the page has no Save button") + toggles: **Start with Windows** *(Windows-only — on mobile replace with "Start at boot" (Android) / hide (iOS), see §11; keep the column)*, **Minimize to the notification area** *(Windows-only — hide on mobile; keep the column)*, **Use the 12-hour clock** (default **off** = 24-hour; affects card times, PDF report time format, statistics, everywhere). Every control **writes immediately** (no Save button) and the page shows a floating confirmation (`Settings_Saved` / `Settings_SaveFailed`).
4. **Synchronization card:** framed sync glyph, state text + "last successful sync" line, **Automatic synchronization** combo (Weekly / Monthly / Only with the button below), hint caption (uploads are immediate; the schedule only paces change checks), action row: **Synchronize now** (enabled when signed in), **Export calendar** (always enabled — local), **What is in the cloud?** (preview, signed-in only), **Restore from the cloud** (signed-in only).
5. **Privacy and backup card:** framed lock glyph, privacy hints (`Settings_PrivacyHint`, `Settings_PrivacyLocalHint`), **storage usage** line (`Settings_StorageUsage`), **database path line (selectable)**, actions: **Export data** (writes `.dtbackup` *or* `.pdf` depending on chosen extension — §12), **Restore backup** (`.dtbackup` + confirm; merges), **Check integrity** (read-only). *Destructive buttons (delete photos/local data/cloud data, disable sync) are intentionally NOT offered — they exist only inside the sign-out flow.*
6. **About card** (full width): about/version text (`Settings_About`, `Settings_AboutText`).
7. **Floating status line** (bottom-right): last action result — settings saved, backup created (counts), PDF created (counts), restore done (counts), integrity OK/issues, calendar PDF created (month or count), export failed.

### 8.9 Busy/progress & long operations
Covered in §6.4 — must include: sign-in phases, sign-out phases, sync, restore, restore preview, "Synchronize now" confirmation, and the **blocked back/close** behavior with the 2-minute safety release.

---

## 9. 🌓 DARK / LIGHT THEME — FOLLOW THE DEVICE'S SYSTEM SETTING (TOP PRIORITY)

9.1. **There is no in-app theme switch** (parity with Windows: the app follows the system appearance setting). The app must render **light** when the phone/tablet is in light mode and **dark** when it is in dark mode — **identically on Android and iOS**.

9.2. **Live switching:** use React Native's `Appearance` API / `useColorScheme()`, and subscribe to `Appearance.addChangeListener` — when the user toggles the system theme (Android quick-settings tile / iOS Control Center or Settings, including while the app is foregrounded, and also when returning from background after the OS theme changed), **the entire UI repaints immediately without restart** on both platforms.

9.3. Implement a single theme source of truth:
   - `theme/tokens.ts`: semantic tokens (`background`, `surface`, `cardBackground`, `cardBorder`, `textPrimary`, `textSecondary`, `accent`, `doneColor #107C10`, `missedColor #A4262C`, `pendingColor #8A8886`, `galleryFill`, `galleryBorder`, `barTrack`, `error`, `warning`, `info`, `busyScrim`), each with a **light and a dark value** derived from the platform (Material 3 / dynamic color on Android where available; iOS system semantic colors `systemBackground`/`secondarySystemBackground`/`label`/`secondaryLabel`; otherwise fixed pairs modeled on the Windows theme resources: `CardBackgroundFillColorDefault`, `CardStrokeColorDefault`, `TextFillColorSecondary`, `ControlStrongStrokeColorDefault`, `ControlFillColorSecondary`, `SubtleFillColorSecondary`, `AccentFillColorDefault`).
   - `useTheme()` hook + `<ThemeProvider>`; **every** screen and component must be built from tokens — no hard-coded `#FFFFFF`/`#000000` anywhere except the fixed state colors above (which must be legible on both themes).

9.4. **Theme-aware extras (parity details that are easy to miss):**
   - **Android:** status bar and navigation bar colors follow the theme (light content on dark, dark content on light); edge-to-edge with correct contrast; launcher/shortcuts stay system-managed.
   - **iOS:** status bar style (dark-content/light-content) follows the theme; modal sheets, large-title navigation bars and the home indicator area are themed.
   - Busy overlay scrim stays dark-translucent in both themes; overlay text stays white.
   - Calendar day cells: background tints, borders, day-number color and secondary text are resolved **per theme and re-resolved on theme change while visible** (translucent tints must never become unreadable — use the same defensive tint values as Windows).
   - Status strip severities (info/warning/error/success), dialogs/bottom sheets, tab bar, inputs, switches, progress bars, photo gallery frame, PDF previews — all themed.
   - Emoji/icons stay legible in both themes; cards switch from border-based (light) to surface-based (dark) separation.
   - System font scaling (Android font scale / iOS Dynamic Type) must not break equal-height card rows — allow the day grid to scroll vertically if needed (documented deviation from the fixed-height desktop window).
   - No setting, cache, persisted preference or build flag may override the system choice; killing and reopening the app must re-evaluate the current system mode.

9.5. **Acceptance for theming (blocking):** toggle the device's dark mode while every screen is open → all listed surfaces flip within one frame, no white flashes, no unreadable text, no stale colors in previously rendered calendar cells; toggle back → identical correctness; repeat on **both Android and iOS**, in foreground and after returning from background.

---

## 10. NOTIFICATIONS & REMINDERS (ANDROID AND iOS)

10.1. **Schema/services parity:** `ReminderSettings` (one per slot, time, weekday bitmask Sunday=bit0, all days=127, snooze minutes default 10) + `ReminderFired` ledger must be implemented and synced (`EntityType.ReminderSettings = 4`).

10.2. **Scheduler semantics (from Windows):** reminders are raised while the app is alive on Windows; on mobile use **scheduled local notifications that fire even when the app is closed** (notifee trigger notifications on Android; UNNotificationRequest via notifee on iOS) — this *improves* on Windows limitation #6 while keeping identical data semantics. Reminders older than **3 hours** are deliberately skipped (no stale notifications after long downtime); the `ReminderFired (ReminderId, Date)` unique ledger guarantees a reminder never fires twice for the same slot/date across restarts; `RemindersEnabled = false` suppresses all reminders; `Weekdays` mask gates the day; timezone changes must re-evaluate scheduled times.

10.3. **Notification actions (parity, both platforms):** each reminder notification carries the meal deep link plus action buttons **"Mark as DONE"** (calls the completion rules — future-locked/empty-content still apply) and **"Snooze"** (default 10 min via `SnoozeAsync`); tapping the body opens the app directly on that meal's Dashboard (`mealEntryId` argument parsing; malformed arguments must never crash). On Android 13+ request `POST_NOTIFICATIONS` at first meaningful use; on iOS request notification permission (alert/sound/badge, provisional not required) — degrade gracefully if denied (Settings must show that reminders are blocked).

10.4. **Reminder creation UI decision (document explicitly):** on Windows no UI currently creates reminders (the switch was removed because nothing creates them). Choose one and record it:
   - **(a) Parity mode** — services/schema/sync exist, no creation UI.
   - **(b) Full mode (recommended on mobile)** — a "Reminders" section in Settings (per-slot time, enabled, weekdays, snooze) writing `ReminderSettings`, scheduled through §10.2 on **both** mobile platforms. If chosen, the identical feature must later be added to Windows — **do not fork the data model.**

10.5. **Sync result notifications:** after a *manual* sync that moved data (uploaded + downloaded > 0), show a local notification "Synchronization complete" with counts (parity with the Windows tray balloon) — silent for background cycles.

10.6. Channel/category hygiene: Android channels (Reminders / Sync) with correct importance; iOS notification categories with the two action buttons; small-icon assets on Android, proper aps payload on iOS; deep links registered in `Linking` on both platforms.

---

## 11. PLATFORM ADAPTATIONS (WINDOWS → ANDROID & iOS — EQUAL TREATMENT)

| Windows feature | Android | iOS |
|---|---|---|
| Start with Windows (startup task) | Optional boot autostart (`RECEIVE_BOOT_COMPLETED`) **off by default**, exposed as "Start at boot" | Hide (iOS has no user-facing autostart; keep column for parity) |
| Minimize to notification area / tray + restore/exit | Hide (no tray) | Hide (no tray) |
| Single instance mutex (second launch activates existing window) | `launchMode="singleTask"` + single DB lock | Standard single scene; no second process on the same DB |
| Window fixed to dashboard height, no vertical scroll | **Deviation:** screens scroll vertically; cards keep equal height within a row | Same deviation |
| Title bar theme painting | Status bar + nav bar colors (§9) | Status bar style (§9) |
| System browser + loopback PKCE | Native Google Sign-In SDK (§7.1) | Native Google Sign-In SDK (§7.1) |
| DPAPI token file | Android Keystore via keychain lib | iOS Keychain |
| Toast actions (snooze/done/deep link) | notifee actions + channels | notifee actions + categories |
| File pickers (open/save) | SAF / share sheet / MediaStore download | `UIDocumentPickerViewController` / share sheet / Files app |
| Shell "open with" for full-size photo | In-app full-screen viewer (+ share) | In-app full-screen viewer (+ share) |
| Path `%LOCALAPPDATA%\DietTracker` | App-private files dir (§4.6) | App sandbox Documents (§4.6) |
| Registry theme read | `Appearance` API (§9) | `Appearance` API (§9) |

11.1. **Permissions:**
   - **Android:** `INTERNET`, `POST_NOTIFICATIONS`, `READ_MEDIA_IMAGES` (or photo picker), `CAMERA` (only if camera capture offered), optional boot receiver; runtime requests in context.
   - **iOS:** photo library & camera usage descriptions, notification permission prompt, URL scheme for Google Sign-In; graceful degradation everywhere.
11.2. **Build matrix:** Android (min SDK 26 / target latest; arm64 + x86_64 emulator) and iOS (min iOS 15+; device + simulator) — **both built and tested in CI for every release**. App name **Diet Tracker**, version `1.0.0` from a single source of truth. Store assets (icon, screenshots, listing copy) prepared for **both** Google Play and the App Store.

---

## 12. EXPORT / BACKUP / REPORTS

12.1. **Export data** — one button, the chosen extension decides the content:
   - `.dtbackup` → portable archive (§12.3).
   - `.pdf` → **printable meal report**: A4 pages, one page per part of the history, a day heading per date, one row per meal with time / slot / state / title / description, a summary of done/missed/pending, `Page x of y` footer; respects the 12-hour/24-hour preference and localized slot/state names; written from scratch, touches nothing in the DB.
   - Suggested file name `diettracker-yyyyMMdd`; failure shows `Settings_ExportFailed`.
12.2. **Export calendar** — one popup with four scopes: **Current month / Whole year / Single date / Date range** (inclusive, order-insensitive — a backwards range is swapped); writes **one A4 calendar page per month** in the calendar screen's layout (weekday row Monday-first, day summary, legend, mini-card labels, today marker). Suggested names: `diettracker-calendar-YYYY-MM`, `-YYYY`, or `-YYYY-MM_YYYY-MM`.
12.3. **`.dtbackup` format (cross-platform):** ZIP containing `backup.json` (manifest: `schemaVersion`, `createdAt`, non-identifying `deviceId`, arrays `meals`, `templates`, `reminders`, `photos` — the **same versioned record format as the cloud payload**) plus the photo files. **Restore merges** (never destructive), shows a confirmation first, and reports counts. A backup made on Windows must restore on Android **and** iOS and vice-versa; a manifest with a *newer* schema than understood is refused clearly; photos whose bytes are missing must not corrupt meals.
12.4. **Storage facts line:** DB path (selectable), storage usage text (`Settings_StorageUsage`).
12.5. **Safety copies:** before migrations and before any account-transition purge, write a safety copy of the DB (keep one generation), as Windows does with `VACUUM INTO`.

---

## 13. OFFLINE, CONNECTIVITY, RESILIENCE & STORE READINESS

13.1. Every feature must work with **no network and no account** (Guest Mode is first-class; `ProviderType.None`).
13.2. Connectivity monitor: on transition to online → request a sync (`ConnectivityRestored`); offline state surfaced in the status strip; queued outbox work resumes automatically.
13.3. Long-running cloud work cancellable only at safe points; sign-out/sync block app exit up to 2 minutes (§6.4).
13.4. Malformed cloud documents, corrupt DB rows, missing photo files, failed PDF writes, denied permissions — all must degrade to user-readable messages; **a failing cloud provider must never crash the app or block local editing**.
13.5. App restart mid-operation must be safe: outbox survives, journal survives, interrupted rebuilds repair themselves next cycle, reminder ledger prevents duplicate notifications.
13.6. **Store readiness for BOTH platforms:** Play Store + App Store privacy declarations (data types: photos, email, app activity — all user-owned, synced only to the user's own Google account), privacy policy URL (§14.3), account deletion path (sign-out + delete local data satisfies both stores' "delete account" rules — document it), screenshots/listings for both stores, correct icons/splash in both light and dark, no private API use (iOS), target API level current (Android).
13.7. Background execution: sync runs opportunistically (foreground + on launch + on connectivity); do not promise background sync that the OS may kill — the status strip and manual button remain the source of truth.

---

## 14. LOGGING, DIAGNOSTICS & PRIVACY

14.1. Local rotating file log `logs/diettracker.log` (1 MB cap, one rotation to `.1`), short-lived file handles so the file is readable while running; levels `TRC/DBG/INF/WRN/ERR/CRT`; messages **never contain credentials, tokens or personal data**; INFO+ to file, DEBUG+ to console in dev builds. Logs must be retrievable for support (share sheet export of the log file — read-only, non-destructive).
14.2. No telemetry, no third-party analytics, no crash uploading without explicit opt-in (default off).
14.3. Privacy parity: data lives in the user's own Google account; `drive.appdata` only; no end-to-end-encryption claims; storage/backup explanations shown verbatim (`Settings_PrivacyHint`, `Settings_PrivacyLocalHint`); ship the equivalent privacy policy statement (based on `docs/privacy/privacy-policy.md`).

---

## 15. PERFORMANCE TARGETS (parity with measured Windows numbers — verify on BOTH platforms)

15.1. Cold start to usable dashboard (DB ready): **< 1.0 s** on a mid-range Android phone and on a supported iPhone (Windows: 0.39–0.62 s).
15.2. UI never blocks on network; local writes < 50 ms typical; calendar/statistics load for a month < 200 ms.
15.3. Memory footprint sane (< ~200 MB RSS); photos streamed/thumbnailized — never load all originals; list scroll at 60 fps on both platforms.
15.4. Sync debounce: 3 s; backoff: 5/15/45/…/1800 s; battery-friendly (no polling loops — watermark checks only on scheduled cycles).
15.5. App size reasonable on both stores (baseline RN + modules only; no bundled duplicate assets).

---

## 16. TESTING & ACCEPTANCE CRITERIA (BLOCKING — RUN ON ANDROID AND iOS)

16.1. **Domain unit tests (port the Windows suites' intent):** completion rules (future-locked, idempotent done, sticky missed, empty-content), five-slot permanence/normalization, validators (limits & codes), photo rules (limit/size/signature/dedupe), copy/template rules (pending only, no photos), analytics percentages (incl. "–" case), sync frequency rules, weekday bitmask.
16.2. **Database tests:** fresh install reaches `user_version = 12`; upgrading a v1 database applies 0002–0012 with data preserved; safety copy created; unique slot index enforced; partial unique active-account index enforced; a DB exported from Windows opens unchanged on both mobile platforms.
16.3. **Sync integration tests (against an in-memory/fake Drive provider that mimics revisions, versions and the modified-time watermark):** offline edit → journal → online push; echo suppression; tombstone clears a slot (does not delete the card); conflict both-preserved + keep-both "Conflict copy" template; sign-in adoption; sign-out refusal when pending + explicit discard; rebuild applies own documents; restore merge; backoff progression; idempotent re-run of every cycle.
16.4. **Cross-platform contract tests:** payload serializer round-trip with fixtures generated by the Windows app; `.dtbackup` produced on Windows restores on Android and iOS, and backups made on either mobile platform restore on Windows; a cloud dataset written by one platform is read correctly by the others (fixture-based).
16.5. **UI/parity checklist (manual, every screen, BOTH platforms):** all §8 features present; all dialogs with correct defaults; all §8.8 settings write instantly and confirm; status strip §6.3 timing rules; busy overlay blocks input; back/close blocking rules (§6.4).
16.6. **Theme test (§9.5)** — blocking, both platforms.
16.7. **Accessibility:** content descriptions on all icon-only buttons (parity with `AutomationProperties.Name`: "Add photo", "Edit", "Clear meal", "Mark as MISSED", "Mark as DONE", "Previous month", "Next month", "Mark all meals as DONE/MISSED"), font-scaling-safe layouts, contrast in both themes, VoiceOver (iOS) and TalkBack (Android) pass on every screen.
16.8. **E2E happy path (both platforms):** first launch → onboarding (guest) → edit 5 meals → mark done/missed (verify future day locked) → add photo (verify limit + duplicate errors) → save day template → apply on another date → calendar coloring → statistics shares → export backup + PDF → integrity OK → sign in with Google (consent) → data uploads → a second device/emulator with the same account sees the same data → sign out refuses offline with pending changes.

---

## 17. ASSUMPTIONS, DEVIATIONS & OPEN DECISIONS (MUST BE HONORED EXPLICITLY)

17.1. **Assumption:** "same DB" = *same schema + same cloud dataset* (each device keeps its own SQLite file; Google Drive is the shared copy). Direct file sharing between phone and PC is only via `.dtbackup`.
17.2. **Deviation (allowed):** phone screens scroll vertically (desktop keeps a fixed, scrollbar-free window).
17.3. **Decision needed:** reminders UI on mobile (parity mode vs full mode — §10.4). Default to full mode **only** if the identical feature will be added to Windows.
17.4. **Decision needed:** show/hide Windows-only settings toggles (Start with Windows → "Start at boot" on Android / hidden on iOS; Minimize to tray → hidden on both) — DB columns stay either way.
17.5. **Optional parity extras** (only if implemented, implement on Windows too): snack-cards visibility toggle (`ShowSnackCards`), single-meal "Save as template" button on the card.
17.6. English only; neutral, non-punitive wording; no medical claims.
17.7. Do **not** renumber enums, migrations, category keys, or change colors `#107C10` / `#A4262C` / `#8A8886`, limits (5 cards, 3 photos, 10 MB, 120/2000 chars, 256 px/80 q, 6 s status, 3 s debounce, 3 h reminder staleness, 2 min close block) — these are the cross-platform contract.
17.8. **Equal-priority rule:** any feature shipped on Android must ship on iOS in the same release (and vice versa); platform-specific deviations must be listed in this section when they are introduced — never silently.

---

### Why this spec is trustworthy
Every requirement above was extracted directly from the repository: `README.md` / `RELEASE_NOTES.md` / `docs/*`, all six `Views/*.xaml` + `MainWindow*.xaml`, all ViewModels, `MealSlotRules`, `CompletionRules`, `PhotoRules`, `MealCopyRules`, `MealEntryValidator`, `PhotoValidator`, all 12 SQL migrations, the repository/enum/model files, `CloudPayloadSerializer` / `CloudObjectPaths`, `SyncEngine*` / `CloudDataSession` / `ConflictResolver` / `BackupService`, `GoogleAuthenticationProvider`/`GooglePkceFlow`, `ReminderScheduler`/`WindowsNotificationService`, and the 242-string `Resources.resw`.
