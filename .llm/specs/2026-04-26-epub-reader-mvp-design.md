# EPUB Reader (React Native + Expo) — v1 Design

**Date:** 2026-04-26
**Status:** Draft for implementation
**Prior art:** Swift implementation at `/Users/felarof01/Workspaces/build/APPS/epub-reader/` (Readium-based iOS app with TTS).

## Goal

Build a reliable, cross-platform EPUB reader that the author will use as their personal long-term reading app. v1 ships the foundation: import EPUB files via the system document picker, list them in a library, and open them in a fully-featured reader that remembers the last reading position. Future versions add TTS, themes, and highlights — none of which are in v1, but the architecture must not preclude them.

## Non-goals (v1)

Out of scope, deliberate. Each is a clean follow-on spec; the v1 architecture does not paint us into a corner on any of them.

- TTS / audio playback (the long-term motivation, but separate v2 spec).
- Settings screen (theme, font size, font family).
- Highlights, annotations, bookmarks.
- Search within a book.
- Cross-device sync.
- Reading stats / streaks.
- Cover image extraction (rows show plain text only).
- EPUB metadata parsing for true title/author (v1 uses sanitized filename as title).
- Automated tests (manual verification only for v1; rendering correctness is the rendering library's responsibility).

## Stack

- **Framework:** Expo SDK (latest stable), TypeScript.
- **Routing:** `expo-router` (file-based; simpler than React Navigation for two screens).
- **EPUB engine:** `@epubjs-react-native/core` + `@epubjs-react-native/expo-file-system`. Wraps `epub.js` in a `WebView`. Chosen over `react-native-readium` because:
  - Larger user base → more bugs found and fixed → more reliable for personal long-term use.
  - Pure JS, runs in Expo Go → fast iteration loop.
  - All v1 features (display, swipe paging, TOC, location/CFI tracking) are first-class APIs.
  - WebView rendering is industry-standard for text-heavy novels (Apple Books, Kindle iOS, Google Play Books all use WebKit).
  - TTS is feasible later via the same pattern the Swift app uses (text extraction + WebView-side highlighting overlays).
- **Required peer deps:** `react-native-webview`, `react-native-gesture-handler`, `react-native-reanimated`.
- **Persistence:** `@react-native-async-storage/async-storage` (lightweight; no DB needed in v1).
- **File picker:** `expo-document-picker`.
- **Filesystem:** `expo-file-system` (used by both the picker copy and the EPUB engine adapter).
- **UUID generation:** `expo-crypto` (`randomUUID()`).
- **Dev workflow:** Expo Go for daily iteration. No `expo prebuild` required in v1 (no native deps that need it).

## Platforms

iOS and Android. No web target in v1.

## File structure

```
epub-reader-react-native/
├── app/                          # expo-router screens
│   ├── _layout.tsx               # ReaderProvider + GestureHandlerRootView; Stack screen config
│   ├── index.tsx                 # Library screen
│   └── reader.tsx                # Reader screen
├── src/
│   ├── books/
│   │   ├── library.ts            # AsyncStorage-backed catalog: list/add/remove/getById
│   │   └── import.ts             # picker → copy file into documentDirectory/books/ → catalog insert
│   └── storage/
│       └── lastLocation.ts       # AsyncStorage get/set last CFI per book
├── assets/                       # (no books/ subdir — books live on-device, not in the bundle)
├── app.json                      # Expo config
├── package.json
├── tsconfig.json
└── README.md
```

Each module has one job. Files are intentionally small.

## Data model

### Library entry

Stored as a JSON array under one AsyncStorage key (`library`):

```ts
type BookRecord = {
  id: string;          // uuid, generated at import time
  title: string;       // sanitized picker filename (no extension), v1 placeholder for EPUB metadata
  fileName: string;    // `${id}.epub` — uuid avoids collisions and special-character pain
  dateAdded: number;   // Date.now() at import
};
```

The on-device file path is derived at read time as `${FileSystem.documentDirectory}books/${fileName}` — never stored, so it survives app reinstall path differences (paths regenerate from the stable `id`).

### Last reading location

Per-book, stored under key `lastLocation:${bookId}`. Value is the `epub.js` CFI string (stable, version-agnostic locator).

## Components and flows

### 1. Root layout (`app/_layout.tsx`)

Wraps the tree in:
- `<GestureHandlerRootView style={{ flex: 1 }}>` — required by `react-native-gesture-handler`.
- `<ReaderProvider>` — required by `@epubjs-react-native/core`.
- `<Stack>` — expo-router stack with default header config.

### 2. Library screen (`app/index.tsx`)

- On focus, reads the library list from `library.list()` and the last-location subtitle for each book.
- Header right: a `+` icon button → calls `import.importBook()` → on success, refreshes the list.
- Empty state: book icon + "No books yet" + an "Import EPUB" button (same action as `+`).
- Non-empty: a `FlatList` of book rows. Each row shows title and a progress subtitle: "Last read: <chapter label> · <N>%" where `N` is the whole-book percentage from `epub.js`'s `location.end.percentage * 100` rounded to integer (or "Not started" if no saved location). Row is tappable → `router.push({ pathname: '/reader', params: { bookId } })`.
- Swipe-to-delete: each row is wrapped in a `Swipeable` from `react-native-gesture-handler`. The reveal exposes a red "Delete" button; tapping it deletes immediately (no confirmation dialog — the swipe + tap is itself the confirmation, matching iOS Mail UX). Delete steps:
  1. Removes the file at `${documentDirectory}books/${fileName}` via `FileSystem.deleteAsync`.
  2. Removes the entry from `library`.
  3. Removes the `lastLocation:${id}` AsyncStorage key.
  4. Refreshes the list.
- Header title: "Library".

### 3. Import module (`src/books/import.ts`)

Public API:
```ts
async function importBook(): Promise<BookRecord | null>;  // null if user cancelled the picker
```

Steps:
1. `DocumentPicker.getDocumentAsync({ type: 'application/epub+zip', copyToCacheDirectory: true })`.
2. If cancelled, return `null`.
3. Generate `id` via `expo-crypto`'s `randomUUID()`.
4. Ensure `${documentDirectory}books/` exists via `FileSystem.makeDirectoryAsync({ intermediates: true })`.
5. Copy from the picker's cache URI → `${documentDirectory}books/${id}.epub` via `FileSystem.copyAsync`.
6. Build `BookRecord` with `title = sanitize(picker.assets[0].name)` (strip `.epub` extension and any path separators).
7. Append to `library` via `library.add(record)`.
8. Return the record.

Errors during copy or persistence: re-throw with a clear message; the caller (Library screen) catches and shows an inline alert ("Couldn't import book").

### 4. Library module (`src/books/library.ts`)

Public API:
```ts
async function list(): Promise<BookRecord[]>;             // empty array if no key
async function add(record: BookRecord): Promise<void>;
async function remove(id: string): Promise<void>;
async function getById(id: string): Promise<BookRecord | undefined>;
```

Implementation: read the array from AsyncStorage on each call (small enough to not warrant a memory cache in v1). Sort by `dateAdded` desc on `list()`.

### 5. Reader screen (`app/reader.tsx`)

State machine:
1. Read `bookId` from route params.
2. `useEffect`: resolve `BookRecord` via `library.getById(bookId)` and the saved CFI via `lastLocation.get(bookId)`. Show `<ActivityIndicator>` while these run in parallel.
3. If the book record is missing → render "Book not found" + back button.
4. Otherwise render the reader:
   ```tsx
   <Reader
     src={`${FileSystem.documentDirectory}books/${book.fileName}`}
     fileSystem={useFileSystem}
     initialLocation={savedCfi}        // undefined on first open
     onLocationChange={handleLocationChange}
     onError={handleError}
   />
   ```
5. `handleLocationChange(loc)` — debounced ~1s with a `useRef<NodeJS.Timeout>` — calls `lastLocation.save(bookId, loc.cfi)`.
6. `handleError(message)` — sets error state; UI swaps to "Couldn't load book" + back button.

Header:
- Left: back button (`router.back()`).
- Center: current chapter title from `useReader().currentLocation?.tocItem?.label`, falling back to the book title.
- Right: "Chapters" button → opens TOC modal.

TOC modal:
- A `Modal` (no extra dep) listing `useReader().toc` entries.
- Tap entry → `useReader().goToLocation(item.href)` → close modal.

Orientation: portrait + landscape allowed. epub.js reflows automatically.

Background/foreground: no special handling. The debounced CFI write (≤1s old) is what we restore on next launch. The OS killing the app mid-read is acceptable — worst case we lose ≤1s of progress.

### 6. Last-location module (`src/storage/lastLocation.ts`)

Public API:
```ts
async function get(bookId: string): Promise<string | undefined>;
async function save(bookId: string, cfi: string): Promise<void>;
async function clear(bookId: string): Promise<void>;   // used by library.remove path
```

Errors are caught and logged via `console.warn`. Save/clear failures never block reading. Get failures resolve to `undefined` so the reader opens at the start.

## Error handling (the only failure modes that exist in v1)

Every realistic failure is one of these. Each surfaces a one-line inline message — no toasts, no telemetry, no retries.

1. **Picker copy / library write fails** → Library screen alerts "Couldn't import book". File is left in cache (Expo cleans it up).
2. **Book record missing on reader mount** (e.g., race with delete) → Reader shows "Book not found" + back button.
3. **EPUB file fails to load or parse** (`onError` from `<Reader>`) → Reader shows "Couldn't load book" + back button.
4. **AsyncStorage read/write throws** → swallow + `console.warn`. Worst case: position not restored or saved this session.

No global error boundary. No Sentry. The four points above cover every realistic v1 failure.

## Key decisions and why

- **`@epubjs-react-native/core` over `react-native-readium`:** community size and dev velocity matter more than native rendering for a personal app. WebView perf is a non-issue for novels.
- **expo-router over React Navigation:** two screens, file-based routing keeps the layout config to one file.
- **AsyncStorage over SQLite:** the entire v1 dataset is one library array + N small CFI strings. SQLite is overkill.
- **UUID-based filenames:** decouples on-disk paths from human filenames; no special-character bugs, no collisions on duplicate imports.
- **Title = sanitized filename, not parsed metadata:** v1 doesn't need a JSZip dependency or metadata parser. Real titles can come later.
- **Debounced CFI writes:** AsyncStorage is fast but every page swipe writing is wasteful and noisy. 1s debounce loses at most 1s of progress on crash.
- **Read saved CFI before mounting `<Reader>`:** guarantees no flash-of-page-1 on resume.

## Verification (manual, v1)

After implementation, verify on both iOS simulator and Android emulator:

1. App launches to empty Library state with "Import EPUB" button.
2. Tap "Import EPUB" → picker opens → select a `.epub` → row appears in list with sanitized title.
3. Tap row → reader opens at page 1 → swipe horizontally → pages advance.
4. Open Chapters → see TOC list → tap an entry → reader jumps to that chapter.
5. Force-quit the app while reading mid-book → relaunch → reopen the book → reader resumes at (or within ~1s of) the last viewed page.
6. Library row subtitle shows "Last read: <chapter> / <%>".
7. Swipe-to-delete a book → row disappears immediately. Restart the app → the deleted book does not reappear. (File-on-disk and AsyncStorage cleanup is verified by absence of the row across restarts.)
8. Import a second book → both appear, each tracks its own last-location independently.

## Future-proofing notes (non-binding)

- TTS will fit naturally as a screen-level feature in `app/reader.tsx`: extract paragraph text via `useReader().getCurrentLocation()` + WebView-side script messages; play via `expo-speech` (built-in) or stream from ElevenLabs/OpenAI; highlight current word via `Reader.addAnnotation` / decoration APIs. Same pattern as the Swift app's `TTSHighlightHelper`.
- Themes / font sizing: `Reader` accepts a `theme` prop and the `useReader().changeFontSize()` method.
- Multiple library views (collections, search, sort) layer on top of `library.ts` without changing its API shape.
