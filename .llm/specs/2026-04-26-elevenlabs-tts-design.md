# ElevenLabs TTS Reader Controls Design

**Date:** 2026-04-26

**Status:** Approved for implementation planning

## Goal

Add ElevenLabs text-to-speech to the React Native EPUB reader. The user should be able to configure an ElevenLabs API key and voice in the app, tap play from the reader, hear narration start at the first visible line, control playback from an always-visible bottom bar, and see the currently spoken word highlighted in the EPUB content.

This feature follows the Swift reference app at `/Users/felarof01/Workspaces/build/APPS/epub-reader/`, but adapts it to the existing React Native architecture built around `@epubjs-react-native/core`.

## Non-Goals

- No page-turn controls in the bottom bar.
- No page progress row in the bottom bar.
- No generated audio cache.
- No next-paragraph prefetch in the first version.
- No OpenAI TTS provider in this version.
- No transcript panel separate from the EPUB content.

## Current Context

The reader screen is implemented in `app/reader.tsx`. It currently renders:

- an EPUB WebView via `@epubjs-react-native/core`
- a header with display settings and chapter list actions
- an always-visible bottom `PageTurnBar`
- persisted reader display preferences through AsyncStorage

The existing bottom bar should be replaced with a compact TTS control bar. The reader package exposes the needed integration points: `injectJavascript`, `onWebViewMessage`, `onSelected`, `getCurrentLocation`, and annotation methods through `useReader()`.

The reference Swift app uses a paragraph-oriented TTS loop:

- parse readable EPUB text into paragraphs and words
- generate one paragraph with ElevenLabs `/with-timestamps`
- map character timings to words
- play audio with native audio APIs
- update the active word highlight as playback advances

The React Native version should use the same product behavior, but extract visible text from the existing EPUB WebView instead of pre-parsing the full EPUB up front.

## Selected Approach

Use WebView-extracted paragraph TTS.

On play, inject JavaScript into the EPUB WebView to find the first readable block visible near the top of the viewport. Return the paragraph text and word metadata to React Native. Generate only that paragraph with ElevenLabs, play it, and highlight the active word as audio time advances. When the paragraph finishes, request the next readable paragraph and repeat.

This approach best satisfies "start at the first line visible" and keeps scope smaller than building a full React Native EPUB parser.

## Reader Controls

Replace the existing bottom `PageTurnBar` with a single always-visible TTS bar.

Controls:

- rewind 10 seconds
- play / pause
- forward 10 seconds
- decrease speed
- current speed label
- increase speed

Allowed speeds:

- `1x`
- `1.5x`
- `2x`

The plus and minus buttons step through the allowed speeds. Skip controls are disabled until audio is loaded. The play button shows a loading state while speech is being generated.

The bar is theme-aware and uses the existing reader theme colors. It does not include page navigation chevrons or a page progress track.

## Settings

Add a Text-to-Speech section to the existing reader settings UI.

Settings fields:

- ElevenLabs API key input
- Load voices action
- voice picker
- selected voice display
- compact error text for failed voice loading

Persistence:

- API key: `expo-secure-store`
- selected voice id/name: AsyncStorage
- playback speed: AsyncStorage

The API key field should be secure by default, with a show/hide affordance if it fits the existing UI style.

## ElevenLabs Service

Add a focused service module for ElevenLabs calls.

`fetchVoices(apiKey)`:

- calls `GET https://api.elevenlabs.io/v1/voices`
- returns voices sorted by name
- surfaces authentication, quota, rate-limit, and generic API errors as readable messages

`generateSpeech({ apiKey, voiceId, text, previousText?, nextText? })`:

- calls `POST https://api.elevenlabs.io/v1/text-to-speech/:voice_id/with-timestamps`
- uses `model_id: "eleven_flash_v2_5"`
- requests `output_format=mp3_44100_128`
- sends voice settings equivalent to the reference app unless implementation testing shows a better default
- returns `audio_base64`, `alignment`, and `normalized_alignment`

Use `normalized_alignment` when present, otherwise fall back to `alignment`.

Docs checked:

- Expo Audio SDK 54: https://docs.expo.dev/versions/v54.0.0/sdk/audio/
- Expo SecureStore SDK 54: https://docs.expo.dev/versions/v54.0.0/sdk/securestore/
- ElevenLabs timestamped TTS: https://elevenlabs.io/docs/api-reference/text-to-speech/convert-with-timestamps

## Audio Playback

Add a small playback module or hook around `expo-audio`.

Responsibilities:

- write generated base64 MP3 to a temporary playback file
- load the temp file into an audio player
- play, pause, resume, and seek
- expose current time, duration, loading status, and playing status
- apply selected playback speed
- clean up temporary playback files when replaced or when the reader unmounts

Background playback is not required in this version. If it works naturally in a development build, that is fine, but the feature should not depend on background audio configuration.

No audio cache is kept beyond the current runtime clip. Replaying a previously generated paragraph can call ElevenLabs again.

## Visible Paragraph Extraction

Create injected JavaScript helpers in a dedicated reader bridge module.

On play, the bridge should:

1. Inspect the currently rendered EPUB document.
2. Find readable block elements visible in the viewport, preferring `p`, headings, `li`, and `blockquote`.
3. Choose the first readable block whose bounding rect intersects the visible viewport near the top.
4. Normalize its text.
5. Split it into word records with character offsets.
6. Return enough metadata to identify and highlight each word later.

The extraction should skip empty nodes and non-reader content such as `script`, `style`, `nav`, and `aside`.

If visible extraction fails, the bottom bar shows a compact error such as "Could not find readable text here."

## Word Highlighting

The visible result should be an active word highlight inside the EPUB content.

Mapping:

- Use ElevenLabs character timestamps.
- Map timestamps to extracted word offsets.
- As audio time advances, compute the active word.
- Inject a DOM update or reader annotation update for that word.

Preferred implementation:

- Use WebView DOM helpers to mark the active word in the visible EPUB document because the extraction already has direct access to the rendered text nodes.

Fallback implementation:

- Use `@epubjs-react-native/core` annotation APIs if direct DOM marking is unreliable for an EPUB.

Only one active TTS word highlight should be visible at a time. The highlight should be removed when playback stops, when the book changes, or when the reader unmounts.

## Paragraph Advancement

When a paragraph finishes:

1. Clear the active word highlight.
2. Ask the WebView for the next readable paragraph after the current paragraph.
3. Generate that paragraph only when needed.
4. Start playback when generation succeeds.

No prefetch is performed. This means there may be a short generation gap between paragraphs, which is acceptable for this version because it avoids spending credits on text the user may not hear.

## Error Handling

The feature handles these failures explicitly:

- Missing API key: prompt the user to add it in settings.
- Missing selected voice: prompt the user to load and select a voice.
- Voice loading failure: show compact settings error text.
- ElevenLabs authentication failure: show a readable auth error.
- ElevenLabs quota/rate-limit failure: show a readable provider error.
- Paragraph extraction failure: show a compact reader bar error.
- Audio write/load/playback failure: stop playback and show a compact reader bar error.

Errors should not crash the reader or clear the user's reading position.

## Component Boundaries

Recommended files:

- `src/tts/elevenLabs.ts`
- `src/tts/settings.ts`
- `src/tts/useTtsPlayback.ts`
- `src/tts/readerBridge.ts`
- `src/tts/types.ts`

`app/reader.tsx` remains the coordinator:

- loads reader settings
- renders settings UI
- renders the bottom TTS bar
- passes WebView messages into the TTS controller
- stops playback on unmount

Keep `app/reader.tsx` from owning provider-specific request logic or low-level audio file handling.

## Testing And Verification

Automated checks:

- `npm run typecheck`
- update and run `npm run check:reader`
- add focused tests for ElevenLabs response parsing and error message mapping if the current test setup supports it
- add pure-function tests for timestamp-to-word mapping if a test runner is added or already available

Manual iOS simulator checks:

1. Open a book and confirm the bottom bar has no page controls and no page progress row.
2. Open reader settings, enter API key, load voices, and select a voice.
3. Scroll to the middle of a page and tap play.
4. Confirm narration starts from the first visible readable line.
5. Confirm the active word is highlighted in the EPUB content.
6. Pause and resume.
7. Skip backward and forward 10 seconds.
8. Step speed through `1x`, `1.5x`, and `2x`.
9. Let a paragraph finish and confirm the next paragraph generates and plays.
10. Leave the reader and confirm playback stops and highlight is cleared.

## Open Implementation Notes

- `expo-audio` and `expo-secure-store` need to be added to dependencies.
- Generated MP3 temp files can use the existing Expo FileSystem legacy API already used in the app, or the SDK 54 `File` API if simpler for binary/base64 writes.
- The reader bridge should be developed with manual EPUB samples because DOM structure varies by book.
- The first implementation should prioritize reliable paragraph extraction and highlighting over perfect seamless playback.
