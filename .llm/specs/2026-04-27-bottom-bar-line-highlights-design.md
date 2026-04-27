# EPUB Reader - Bottom-Bar Line Highlights Design

**Date:** 2026-04-27
**Status:** Draft for implementation
**Supersedes for this feature:** `.llm/specs/2026-04-26-highlights-mvp-design.md`

## Goal

Add a simpler one-handed highlight mode to the EPUB reader. All controls live in the bottom bar. The user taps **Edit** to pause narration and enter highlight editing, moves through visible text with large arrow buttons, starts a pending highlight with a small round **Light** button, extends the range one visual line at a time with `>`, shrinks the range one word at a time with `<`, then taps **Stop** and chooses a color.

The highlighted text must render in the book and persist per book.

## Non-goals

- No header edit button.
- No right-side rail, checkboxes, sentence dots, or note UI.
- No native text-selection workflow for creating highlights.
- No highlights index, export, sync, undo stack, or edit-existing-highlight popover.
- No overlap splitting in the first version. If a new highlight overlaps an old one, both annotations may coexist visually.

## UX

### Read mode bottom bar

Read mode keeps the existing TTS controls and adds an **Edit** control in the bottom bar. Pressing **Edit**:

1. Pauses active narration.
2. Clears the active TTS word highlight.
3. Enters edit mode.

If narration was paused by entering edit mode, the app does not auto-resume when edit mode exits. The user can press play again.

### Edit mode bottom bar

Edit mode replaces the TTS speed, seek, and play/pause controls with highlight controls:

```text
Edit        <          Light          >
```

- **Edit** exits edit mode when pressed again.
- `<` and `>` are large touch targets.
- **Light / Stop** is a smaller round center button.
- **Light** starts a pending highlight from the currently selected word/line.
- **Stop** ends active range editing and opens color selection.

The selected starting point is shown in the book before a highlight starts. A subtle underline or soft tint is enough.

### Active highlighting

When the user presses **Light**, the app immediately shows a pending highlight using the default color, yellow. The center button changes to **Stop**.

While active:

- `>` extends the pending range by one visual line.
- `<` shrinks the pending range by one word.
- Holding either arrow repeats the action quickly until release.
- The pending range updates in the book after every step.

### Color selection

Pressing **Stop** freezes the pending range and shows a compact color picker above or within the bottom bar. Yellow is selected by default because it is the color shown while highlighting.

Available colors:

| key | hex | display |
| --- | --- | --- |
| `yellow` | `#ffd84d` | Yellow |
| `cyan` | `#4cc9d6` | Cyan |
| `green` | `#5fd991` | Green |
| `red` | `#ff7a7a` | Red |

Tapping a color saves the highlight with that color, clears pending state, and keeps the user in edit mode with the cursor moved to the line after the saved highlight. Pressing **Edit** while a pending or stopped range exists discards the unsaved range and returns to read mode.

## Data model

Store highlights per book in AsyncStorage under `highlights:${bookId}`.

```ts
type HighlightColor = 'yellow' | 'cyan' | 'green' | 'red';

type Highlight = {
  id: string;
  cfiRange: string;
  color: HighlightColor;
  createdAt: number;
  updatedAt: number;
};
```

The storage module should expose:

```ts
async function list(bookId: string): Promise<Highlight[]>;
async function add(bookId: string, input: { cfiRange: string; color: HighlightColor }): Promise<Highlight>;
async function remove(bookId: string, id: string): Promise<void>;
async function clearForBook(bookId: string): Promise<void>;
```

Storage failures are caught and logged with `console.warn`; reading should not be blocked by highlight persistence failures.

## Reader state

The reader screen owns the mode and selection state:

```ts
type HighlightMode = 'read' | 'idle' | 'active' | 'color';

type PendingHighlight = {
  startWordId: string;
  endWordId: string;
  cfiRange: string;
};
```

State meanings:

- `read`: normal TTS bottom bar.
- `idle`: edit mode, cursor visible, no active pending highlight.
- `active`: pending range visible in default yellow, arrows mutate range.
- `color`: range frozen, color picker visible, tapping a color saves.

Entering `idle` pauses playback if needed. Leaving edit mode clears any temporary highlight and pending state.

## WebView bridge

Add a highlight-specific bridge in `src/highlights/readerBridge.ts`. Keep it separate from `src/tts/readerBridge.ts` so TTS word highlighting and saved book highlights do not share message types or temporary DOM attributes.

React Native to WebView scripts:

- `createPrepareHighlightCursorScript(requestId)` - finds the first visible readable text and returns word/line metadata.
- `createMoveHighlightCursorScript(direction)` - moves the idle cursor one visual line backward or forward.
- `createStartPendingHighlightScript()` - starts a pending highlight at the cursor.
- `createExtendPendingHighlightScript()` - extends the pending range by one visual line.
- `createShrinkPendingHighlightScript()` - shrinks the pending range by one word.
- `createClearPendingHighlightScript()` - clears temporary cursor/range styling.
- `createReplayHighlightAnchorsScript()` - restores cursor/pending DOM cleanup hooks after a WebView render, without adding saved highlight color.

WebView to React Native messages:

- `{ type: 'highlightCursorReady', requestId, cfiRange }`
- `{ type: 'highlightPendingChanged', cfiRange }`
- `{ type: 'highlightError', requestId, message }`

The bridge computes visual lines from word rectangles. Words with the same rounded `top` coordinate belong to the same visual line. This matches the requested behavior: extension follows what the user sees on the screen, not sentence or paragraph boundaries.

## Rendering

Use inline WebView styling for temporary cursor and pending range:

- Cursor: subtle underline or soft background on the selected word.
- Pending/default highlight: yellow background at roughly 40 percent opacity.
- Saved highlight: chosen color at roughly 40 percent opacity.

Saved highlights render through `useReader().addAnnotation('highlight', cfiRange, {}, styles)`, where `styles` uses the selected fill color at roughly 40 percent opacity. On reader load, replay every stored highlight through `addAnnotation`. If `addAnnotation` throws, log the error and keep the stored highlight so the next reader render can retry.

## Repeat arrows

The large `<` and `>` buttons should repeat while pressed.

Implementation target:

- Trigger once immediately on press.
- Start repeating after about 250 ms.
- Repeat every 70-100 ms while held.
- Stop on press release, cancellation, or unmount.

In idle mode, arrows move the cursor by visual line. In active mode, `>` extends by visual line and `<` shrinks by word.

## Library deletion

When a book is removed, call `highlights.clearForBook(bookId)` in the existing library deletion path so re-importing starts clean.

## Edge cases

- If no readable visible text is found, stay in edit mode and show a compact bottom-bar error.
- If the user scrolls while editing, clear pending state and re-prepare the cursor at the first visible text.
- If font size or theme changes, clear pending state and replay saved highlights after the reader re-renders.
- If the pending range shrinks to one word, further `<` presses keep it at one word.
- If `>` reaches the end of the current readable content, keep the range unchanged.
- If the user exits edit mode during color selection, discard the unsaved highlight.
- If saving fails, keep the pending range visible and show a compact error.

## Tests and checks

Add or update script checks to assert:

- The bottom bar has an edit mode and read mode.
- Entering edit mode pauses playback.
- Edit mode removes TTS speed/play controls from the bottom bar.
- Edit mode renders large arrow controls and a round **Light / Stop** center control.
- Active highlight mode uses a default yellow pending highlight.
- `>` extends by visual line and `<` shrinks by word in the bridge script.
- Library deletion clears stored highlights.

Manual QA:

1. Open a book and start TTS.
2. Press **Edit** and confirm playback pauses.
3. Move the cursor with arrows.
4. Press **Light**, extend several visual lines with `>`, shrink several words with `<`.
5. Press **Stop**, choose a color, and confirm the highlight remains in the book.
6. Exit and reopen the book, then confirm the highlight is restored.
