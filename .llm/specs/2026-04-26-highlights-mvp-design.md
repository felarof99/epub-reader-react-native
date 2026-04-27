# EPUB Reader — Highlights & Notes MVP Design

**Date:** 2026-04-26
**Status:** Draft for implementation
**Builds on:** `.llm/specs/2026-04-26-epub-reader-mvp-design.md` (the v1 reader)
**Mockups:**
- `.llm/mockups/2026-04-26-granularity.png` — sentence vs paragraph vs visual-line trade-offs.
- `.llm/mockups/2026-04-26-drag-flow.png` — full vision including drag-to-extend (Steps 2 of the flow are **v2**; v1 ships only tap-anchor / multi-tap / color picker / note sheet).

## Goal

Add a one-handed, phone-friendly highlighting system to the existing EPUB reader. The author reads on a phone with their thumb, and native long-press text selection is awkward — so we replace it with a **right-rail of round checkboxes**, one per sentence, that the user taps to build a multi-sentence selection. A persistent bottom bar (built separately) picks one of four colors (cyan / green / yellow / red) and optionally attaches a text note. Highlights are CFI-anchored and persist locally per book.

## Non-goals (v1)

Each is a clean follow-on, deliberately deferred. The architecture in this spec does not preclude any of them.

- **Drag-to-extend selection** (tap-anchor + finger drag down to grow the range). Reserved for v2 polish — tap-only ships first.
- **Edit popover for an individual highlight.** All editing flows through the bottom bar selection model.
- **Highlights index / global notes view.** Data model supports it; UI is a separate spec.
- **Markdown export.** Per-book CFI + color + note data is captured; the export UI is a v2 spec.
- **Cross-device sync of highlights.**
- **Undo / history of highlights.**
- **Color customization.** Four fixed colors in v1.
- **Smart (NLP) sentence detection.** A regex split is the v1 floor; refinement is a follow-up tuning task, not a release blocker.
- **Bottom-bar visual design.** The user is building the bar; this spec defines only the API contract it consumes.

## Stack additions

No new dependencies. Uses what the reader already ships with:

- `@epubjs-react-native/core` — `useReader().injectJavascript`, `rendition.annotations.add(...)`, `rendition.on('rendered', ...)` for the rail and highlight rendering.
- `react-native-webview` — message bridge between injected DOM and React Native.
- `@react-native-async-storage/async-storage` — highlight persistence per book.
- `expo-crypto` — `randomUUID()` for highlight IDs.

## Data model

### Highlight record

Stored as a JSON array under `highlights:${bookId}`:

```ts
type HighlightColor = 'cyan' | 'green' | 'yellow' | 'red';

type Highlight = {
  id: string;            // uuid (expo-crypto.randomUUID)
  cfiRange: string;      // epub.js CFI range, e.g. "epubcfi(/6/4!/4/2/1:0,/4/2/1:142)"
  color: HighlightColor;
  note?: string;         // optional plain-text annotation
  createdAt: number;
  updatedAt: number;
};
```

CFI ranges are character-anchored, so highlights remain correct across font-size changes, theme switches, chapter reloads, and app restarts.

### Color palette (fixed)

| key      | hex       | display name |
|----------|-----------|--------------|
| `cyan`   | `#4cc9d6` | Cyan         |
| `green`  | `#5fd991` | Green        |
| `yellow` | `#ffd84d` | Yellow       |
| `red`    | `#ff7a7a` | Red          |

Highlights render at `fillOpacity: 0.40` so the underlying text stays readable.

## Components and flows

### 1. Highlights module (`src/highlights/highlights.ts`)

Mirrors the existing `library.ts` shape.

```ts
async function list(bookId: string): Promise<Highlight[]>;
async function add(
  bookId: string,
  input: { cfiRange: string; color: HighlightColor; note?: string },
): Promise<Highlight>;                                         // assigns id + timestamps
async function update(
  bookId: string,
  id: string,
  patch: Partial<Pick<Highlight, 'color' | 'note'>>,
): Promise<void>;
async function remove(bookId: string, id: string): Promise<void>;
async function clearForBook(bookId: string): Promise<void>;    // called from library.remove path
```

Implementation: read/write the array per call. No memory cache (per-book scope is small). All errors caught + `console.warn`; failures never block reading.

### 2. Selection context (`src/highlights/SelectionContext.tsx`)

The API the bottom bar consumes. Lives in React Native, provided at the reader screen level.

```ts
type SelectionAPI = {
  selectedCount: number;                                 // 0 when empty
  hasSelection: boolean;                                 // selectedCount > 0
  applyColor: (color: HighlightColor) => Promise<void>;  // colors → save → clear pending
  saveNote: (text: string) => Promise<void>;             // last-picked color (default yellow) + note
  erase: () => Promise<void>;                            // remove overlapping highlights, clear pending
  clearSelection: () => void;                            // deselect pending; no storage change
};

const SelectionContext = createContext<SelectionAPI>(/* … */);
export const useHighlightSelection = () => useContext(SelectionContext);
```

The bottom bar reads this context to decide enabled state and to wire button taps:

```tsx
const { hasSelection, applyColor, saveNote, erase } = useHighlightSelection();
// disable swatches when !hasSelection
// onPress={() => applyColor('yellow')}
```

The bar **never touches the WebView, never sees CFIs, never imports the highlights module.** Clean separation.

### 3. WebView bridge (`src/highlights/webviewBridge.ts`)

Helpers for the message protocol between the injected DOM and React Native.

Messages from WebView to RN:
- `{ type: 'selection-changed', sentenceIds: string[], cfiRanges: string[] }` — fired on every tap.
- `{ type: 'rail-ready', sectionHref: string, sentenceCount: number }` — fired after the rail is injected for a chapter (debug/observability).
- `{ type: 'log', level, message }` — passthrough for in-WebView errors.

Messages from RN to WebView:
- `{ type: 'apply-highlight', id, cfiRange, color }` — color the rail checkboxes; epub.js handles the text decoration via `rendition.annotations.add` from the RN side.
- `{ type: 'remove-highlight', id, cfiRange }` — clear the colored fill on the affected checkboxes.
- `{ type: 'clear-pending' }` — visually deselect after a save or cancel.

### 4. Injected rail (`src/highlights/injected/rail.js` + `rail.css`)

Runs on every `rendition.on('rendered', section => …)` callback. The reader's `manager="continuous"` + `flow="scrolled-doc"` means multiple sections can co-exist in the DOM; the script handles each independently and idempotently (re-running on the same section is a no-op via a `data-rail-injected` flag).

**Sentence wrapping.** Walk the rendered chapter DOM. For each text-bearing block element (`p`, `li`, `blockquote`, `h1-6`), split its text on `[.!?]+\s` and end-of-paragraph; wrap each chunk in `<span class="hl-sent" data-sid="<sid>">`. The `sid` is `${sectionHref}#${zero-padded-index}` — globally unique. Imperfect splits (`Mr.`, `e.g.`) are accepted at v1.

**CFI per sentence.** For each `.hl-sent`, build a DOM Range covering its text and call `contents.cfiFromRange(range)` to get a stable CFI. Cache on the element: `dataset.cfi`.

**Rail rendering.** A 28px-wide right-margin column (`position: absolute; right: 0; top: 0; height: 100%; pointer-events: none;` on the column, `pointer-events: auto;` on each checkbox). For each `.hl-sent`, create a 14px circular `<button class="hl-cbox" data-sid="…">` and align its top to `.hl-sent.getBoundingClientRect().top` of its first line.

**Reflow.** A `ResizeObserver` on the chapter root re-aligns checkbox tops when font-size or viewport changes. Annotations from epub.js re-render automatically; the rail just needs y-realignment.

**Tap behavior.**
- Empty checkbox → toggle to `pending` (gray fill, `class="pending"`).
- Pending checkbox → toggle off pending.
- Already-highlighted checkbox → adds to pending while keeping its color fill (border becomes dashed gray to show it's both highlighted and selected).
- Each tap re-emits `selection-changed` with the current set of pending sentence IDs and their CFI ranges, **grouped into contiguous runs**. Tapping sentences 3, 4, 5, 9, 10 emits two ranges (3–5 and 9–10), not one. This way each contiguous run becomes its own highlight when a color is applied.

**Visual states (one checkbox can be in any of):**
- **Empty / unselected** — hollow gray border.
- **Pending** — solid gray fill.
- **Highlighted (color X)** — solid color fill at 100% opacity (rail) / 40% (text decoration).
- **Highlighted + pending** — color fill with a dashed gray border ring.

### 5. Reader screen wiring (`app/reader.tsx`)

Existing flow already loads `book` + `savedCfi` in parallel on mount. Add a third parallel load:

```ts
const [book, savedCfi, allHighlights] = await Promise.all([
  library.getById(bookId),
  lastLocation.get(bookId),
  highlights.list(bookId),
]);
```

Pass `allHighlights` into the `<ReaderView>` subtree. The reader provides `<SelectionProvider book={book} initialHighlights={allHighlights}>` around the children.

Inside the provider:

- **Inject `rail.css`** via the `<Reader>` `injectedCSS` prop (or via `rendition.themes.register` with a CSS rule for `.hl-sent`/`.hl-cbox`).
- **Inject `rail.js`** by calling `useReader().injectJavascript(...)` inside a `useEffect` that runs once per `rendered` section. The injected script is idempotent.
- **Replay highlights** for each rendered section: filter `allHighlights` to those whose CFI prefix matches the section, call `rendition.annotations.add('highlight', cfiRange, {}, undefined, undefined, { fill: hex, fillOpacity: 0.40 })` for each.
- **Listen to WebView messages** via the existing message channel; route to provider state:
  - `selection-changed` → set `pendingSentenceIds` + derived CFI range.
  - `rail-ready`, `log` → console only.

Selection-context internal state (not exposed via `SelectionAPI`):
- `pendingSentenceIds: Set<string>` — current pending tap selection.
- `pendingCfiRanges: string[]` — derived from the WebView's `selection-changed`, one entry per contiguous run.
- `lastPickedColor: HighlightColor` — initialized to `'yellow'`, updated on every successful `applyColor` call. Used as the default color for `saveNote` so notes attached without an explicit color pick still get a visible highlight.

Selection-context method bodies:

- **`applyColor(color)`**: for each `cfiRange` in `pendingCfiRanges`:
  1. Find any existing highlights whose CFI overlaps `cfiRange`; for each: split into non-overlapping head/tail records (keep tails as new records via `highlights.add`), remove the original via `highlights.remove`, and remove its annotation from epub.js.
  2. `highlights.add(bookId, { cfiRange, color })` → save the new record.
  3. `rendition.annotations.add('highlight', cfiRange, …, { fill, fillOpacity: 0.40 })`.
  4. Post `apply-highlight` to the WebView so checkboxes recolor.
  Then update `lastPickedColor = color`, post `clear-pending`, set `pendingSentenceIds = new Set()`, `pendingCfiRanges = []`.
- **`saveNote(text)`**: same loop as `applyColor(lastPickedColor)` but each new record carries `note: text`.
- **`erase()`**: same overlap-split logic per range, but does not insert a replacement; ends in clear-pending.
- **`clearSelection()`**: post `clear-pending`; clear pending state. No storage change.

### 6. Library deletion path (`src/books/library.ts`)

Existing `remove(id)` flow already deletes the file + library entry + `lastLocation`. Add one line:

```ts
await highlights.clearForBook(id);
```

Same pattern as the existing `lastLocation.clear` call.

## Overlap & erase semantics

When a new highlight (or erase) intersects an existing one, the existing one is **split**:

```
Existing:  [A══════════════ green ══════════════B]
New:                  [C═════ yellow ═════D]
Result:    [A══ green ══C][C═ yellow ═D][D══ green ══B]
```

For erase, the middle is dropped; head + tail remain.

This is a deliberate design choice (vs. "refuse overlapping highlights"). It matches Kindle / iBooks behavior and avoids dead-end interactions.

## Error handling

Inherits the v1 reader's policy. Every realistic failure mode:

1. **AsyncStorage read/write throws** → swallow + `console.warn`. In-memory state stays correct; worst case is the action doesn't survive the next launch.
2. **`contents.cfiFromRange` returns null/throws** (rare; pathological DOM) → skip that sentence's checkbox. Log via the `log` message channel.
3. **`rendition.annotations.add` throws** → log; the highlight is still saved (CFI is valid). Next chapter render will re-attempt the decoration.
4. **WebView ↔ RN message lost** (theoretical) → next tap re-emits `selection-changed`; selection re-syncs naturally.

No global error boundary. No telemetry.

## Edge cases

- **Font size / theme change** — epub.js re-renders; `rendered` listener re-runs sentence wrapping and rail rebuild. Annotations re-apply automatically. Pending selection clears (in-memory state); accepted, since changing font mid-selection is rare.
- **Chapter navigation (TOC, swipe)** — each section's `rendered` event re-injects the rail and replays section-scoped highlights.
- **Continuous flow with multiple sections in DOM** — script keys all state by `data-sid` and is idempotent per section via `data-rail-injected`.
- **Scroll during selection** — pending state is in-memory and survives scroll. Checkboxes stay gray on scroll-back.
- **Book deletion** — `library.remove` calls `highlights.clearForBook(id)`; re-imports start clean.
- **Reader unmount mid-action** — pending is in-memory only; lost on unmount with no corruption (saves are atomic per highlight).
- **Highlight that spans a chapter boundary** — v1 does not support cross-section highlights. The injected rail naturally prevents this since selection is per-rendered-section. If a later version adds drag-to-extend, this becomes a real edge case.

## File structure

**New files:**

```
src/highlights/
├── highlights.ts              # AsyncStorage CRUD: list/add/update/remove/clearForBook
├── SelectionContext.tsx       # React Context + Provider exposing the SelectionAPI
├── webviewBridge.ts           # Message helpers: types, postToWebView, parseFromWebView
├── overlap.ts                 # Pure functions: overlapping highlights, range split
└── injected/
    ├── rail.js                # Sentence wrapping, rail DOM, tap handlers, message posting
    └── rail.css               # Checkbox + pending styles, injected into iframe
```

**Changed files:**

- `app/reader.tsx` — wraps `<Reader>` subtree in `<SelectionProvider>`; passes `injectedJavaScript` (rail script) and `injectedCSS` (rail styles); loads existing highlights on mount and replays them; routes WebView messages into the selection context.
- `src/books/library.ts` — `remove(id)` calls `highlights.clearForBook(id)`.

**Unchanged:**

- `app/index.tsx`, `app/_layout.tsx`, `src/books/import.ts`, `src/storage/lastLocation.ts`, `src/storage/readerPreferences.ts`, `src/reader/preferences.ts`, `src/reader/useLegacyFileSystem.ts`.

## Manual verification (iOS + Android)

After implementation, verify on both simulators:

1. Open a book → right rail of small gray circles appears next to each sentence.
2. Tap one → it fills gray (pending). Bottom-bar swatches go from disabled to enabled (the user's bar consumes `hasSelection`).
3. Tap a yellow swatch → that sentence highlights yellow, rail circle fills yellow, pending clears, bar swatches disable.
4. Select 3 sentences across a paragraph break → tap green → all three highlight green.
5. Re-select a green-highlighted sentence + 2 unhighlighted → tap red → all three become red (overwrite-with-split confirmed).
6. Select a highlighted sentence → erase → highlight removed, sentence reverts to plain.
7. Change font size mid-read → highlights remain on the same text spans, rail re-aligns.
8. Navigate to next chapter and back → highlights still visible.
9. Force-quit the app → reopen the book → highlights restored at launch.
10. Delete the book from the library → re-import the same EPUB → no orphan highlights from the deleted instance.

## Future-proofing notes (non-binding)

- **Drag-to-extend selection (v2):** add a `touchstart`/`touchmove` handler on the rail in `rail.js`. `elementFromPoint` finds the checkbox under the finger; mark all sentences between anchor and current as pending. Auto-scroll near the viewport edges. No data-model change.
- **Markdown export:** for each `Highlight`, look up the sentence text via the cached CFI → DOM range → `range.toString()` (during reader open). Format as `> {text}\n\n*Note:* {note}`. Per-book export from a long-press in the library.
- **Global notes view:** new screen that calls `highlights.list(bookId)` for every library entry, flattens, and presents a virtualized list with color-filter chips. No backend.
- **Cross-section highlights:** would require representing highlights as arrays of CFI ranges (one per section) instead of a single range string. Migration is straightforward (single-range becomes a 1-array).
- **Color customization:** `HighlightColor` becomes `string` and `COLORS` becomes a runtime-editable map persisted to AsyncStorage.
