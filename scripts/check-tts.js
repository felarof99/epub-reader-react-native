const fs = require('node:fs');
const assert = require('node:assert/strict');

const library = fs.readFileSync('app/index.tsx', 'utf8');
const reader = fs.readFileSync('app/reader.tsx', 'utf8');
const settingsScreen = fs.readFileSync('app/settings.tsx', 'utf8');
const elevenLabs = fs.readFileSync('src/tts/elevenLabs.ts', 'utf8');
const playback = fs.readFileSync('src/tts/useTtsPlayback.ts', 'utf8');
const bridge = fs.readFileSync('src/tts/readerBridge.ts', 'utf8');
const settings = fs.readFileSync('src/tts/settings.ts', 'utf8');
const timing = fs.readFileSync('src/tts/timing.ts', 'utf8');
const types = fs.readFileSync('src/tts/types.ts', 'utf8');

function extractBlock(source, startToken, endToken) {
  const start = source.indexOf(startToken);
  assert(start >= 0, `Could not find block start: ${startToken}`);
  const end = source.indexOf(endToken, start + startToken.length);
  assert(end >= 0, `Could not find block end after ${startToken}: ${endToken}`);
  return source.slice(start, end + endToken.length);
}

function extractJsxBlock(source, startToken) {
  const start = source.indexOf(startToken);
  assert(start >= 0, `Could not find JSX block start: ${startToken}`);
  const end = source.indexOf('/>', start + startToken.length);
  assert(end >= 0, `Could not find JSX block end after ${startToken}`);
  return source.slice(start, end + 2);
}

function assertIncludes(haystack, needle, message) {
  assert(haystack.includes(needle), message);
}

function assertMatches(haystack, pattern, message) {
  assert(pattern.test(haystack), message);
}

function assertOrder(haystack, needles, message) {
  let previousIndex = -1;
  for (const needle of needles) {
    const index = haystack.indexOf(needle);
    assert(index >= 0, `${message} Missing: ${needle}`);
    assert(index > previousIndex, `${message} Out of order: ${needle}`);
    previousIndex = index;
  }
}

const ttsControlBarBlock = extractJsxBlock(reader, '<TtsControlBar');
const playParagraphBlock = extractBlock(reader, 'const playParagraph = useCallback', 'const handleTtsWebViewMessage = useCallback');
const webViewMessageBlock = extractBlock(reader, 'const handleTtsWebViewMessage = useCallback', 'useEffect(() => {');
const highlightEffectBlock = extractBlock(reader, 'const activeWordId = activeWordIdAtTime', 'requestNextParagraph(currentParagraph.paragraphId);');
const loadAndPlayBlock = extractBlock(playback, 'const loadAndPlay = useCallback', 'const pause = useCallback');
const stopBlock = extractBlock(playback, 'const stop = useCallback', 'const seekBy = useCallback');
const playbackReturnBlock = extractBlock(playback, 'return {', '\n  };');
const bridgeRequestScriptBlock = extractBlock(bridge, 'function createParagraphRequestScript', '\n  `;\n}');
const bridgeHighlightScriptBlock = extractBlock(bridge, 'export function createHighlightWordScript', 'export function createClearHighlightScript');

assert(
  elevenLabs.includes('/with-timestamps') &&
    elevenLabs.includes('eleven_flash_v2_5') &&
    elevenLabs.includes('mp3_44100_128'),
  'ElevenLabs client should use timestamped speech with the configured model and output format.'
);

assert(
  types.includes('normalized_alignment') &&
    reader.includes('speech.normalized_alignment ?? speech.alignment'),
  'TTS integration should support normalized alignment timestamps and prefer them when available.'
);

assert(
  settings.includes('expo-secure-store') &&
    settings.includes('elevenLabsApiKey') &&
    settings.includes('AsyncStorage') &&
    settings.includes('ttsSettings'),
  'TTS settings should store API key securely and non-secret settings in AsyncStorage.'
);

assert(
  playback.includes('expo-audio') && playback.includes('seekTo'),
  'TTS playback should use expo-audio and support seeking.'
);

assert(
  bridge.includes('getBoundingClientRect') &&
    bridge.includes('data-tts-word-id') &&
    bridge.includes('data-tts-active-word') &&
    bridge.includes('wordRangesForElement') &&
    bridge.includes("typeof rendition === 'undefined'") &&
    !bridge.includes('window.rendition') &&
    !bridge.includes('innerHTML ='),
  'Reader bridge should extract visible paragraph words from EPUB.js rendition and mark active words without replacing paragraph HTML.'
);

assert(
  timing.includes('mapAlignmentToWordTimings') &&
    timing.includes('activeWordIdAtTime') &&
    timing.includes('TTS_SPEED_STEP') &&
    timing.includes('normalizeSpeedStep'),
  'Timing helpers should map timestamps to words and normalize speed in bounded 0.1x steps.'
);

assert(
  reader.includes('onWebViewMessage={handleTtsWebViewMessage}') &&
    reader.includes('createRequestVisibleParagraphScript') &&
    reader.includes('createRequestSelectedParagraphScript') &&
    reader.includes('generateSpeech') &&
    !reader.includes('fetchVoices') &&
    !reader.includes('placeholder="ElevenLabs API key"'),
  'Reader should wire WebView extraction, highlighting, and speech generation without rendering global voice setup.'
);

assert(
  library.includes("router.push('/settings')") &&
    library.includes('settings-outline') &&
    settingsScreen.includes('fetchVoices(trimmedApiKey)') &&
    settingsScreen.includes('ttsSettings.saveSelectedVoice') &&
    settingsScreen.includes('SAMPLE_PREVIEW_TEXT') &&
    settingsScreen.includes('generateSpeech({') &&
    settingsScreen.includes('loadAndPlay({ audioBase64: speech.audio_base64, speed: settings.speed })') &&
    settingsScreen.includes('Preview ${voice.name}'),
  'Library settings should own ElevenLabs API key, voice loading, voice selection, and per-voice preview playback.'
);

assertIncludes(
  ttsControlBarBlock,
  'requestVisibleParagraph();',
  'TTS play button should request the visible paragraph from the TTS control bar onPlayPause path.'
);
assert(
  ttsControlBarBlock.includes('onSpeedDown={() => handleSpeedChange(previousTtsSpeed(ttsPrefs.speed))}') &&
    ttsControlBarBlock.includes('onSpeedUp={() => handleSpeedChange(nextTtsSpeed(ttsPrefs.speed))}') &&
    reader.includes('Current narration speed') &&
    !reader.includes('TTS_SPEEDS.map') &&
    !reader.includes('onSpeedSelect'),
  'TTS control bar should show current speed as text and adjust speed only with plus/minus buttons.'
);
assert(
  reader.includes("import * as Clipboard from 'expo-clipboard';") &&
    reader.includes('const ttsMenuItems = useMemo') &&
    reader.includes("label: 'Read aloud from here'") &&
    reader.includes("label: 'Copy'") &&
    reader.includes('Clipboard.setStringAsync(text)') &&
    reader.includes('menuItems={ttsMenuItems}') &&
    reader.includes('Read aloud from here') &&
    !reader.includes('selectedReadAloudCfi') &&
    !reader.includes('selectedTtsPopup') &&
    reader.includes("pendingRequestRef.current = 'selected'") &&
    reader.includes('createRequestSelectedParagraphScript(requestId, trimmedCfiRange)') &&
    !reader.includes('HighlightSelectionProvider') &&
    !reader.includes('useHighlightReaderBridge') &&
    !reader.includes('noteControls'),
  'Reader should expose only Read aloud from here and Copy in the native selected-text menu without the reverted highlight rail/note UI.'
);
assert(
  !reader.includes("label: 'Read aloud'") &&
    !reader.includes("setTtsError('Could not find selected text.');") &&
    reader.includes('const trimmedCfiRange = cfiRange.trim();'),
  'Reader should use the exact Read aloud from here label and allow empty menu CFI values for live-selection fallback.'
);

assertMatches(
  webViewMessageBlock,
  /if\s*\(\s*message\.type\s*===\s*['"]ttsParagraph['"]\s*\)[\s\S]*playParagraph\(message\.paragraph\)/,
  'WebView ttsParagraph messages should call playParagraph(message.paragraph).'
);

assertOrder(
  playParagraphBlock,
  ['generateSpeech({', 'const alignment = speech.normalized_alignment ?? speech.alignment', 'loadAndPlay({'],
  'Speech generation should generate speech, map alignment, then load audio.'
);
assertMatches(
  playParagraphBlock,
  /loadAndPlay\(\{\s*audioBase64:\s*speech\.audio_base64,\s*speed:\s*ttsPrefs\.speed\s*\}\)/,
  'Speech playback should pass generated audio_base64 and current TTS speed to loadAndPlay.'
);

assertOrder(
  highlightEffectBlock,
  ['activeWordIdAtTime(wordTimings, playback.currentTime)', 'lastHighlightedWordRef.current', 'createHighlightWordScript(currentParagraph.paragraphId, activeWordId)'],
  'Highlight effect should calculate the active word, de-dupe repeated highlights, then inject highlight script.'
);

assertIncludes(
  playback,
  'export function useTtsPlayback()',
  'Playback hook should export useTtsPlayback as a named function.'
);
assertOrder(
  loadAndPlayBlock,
  ['writeAsStringAsync', 'player.replace(uri)', 'player.setPlaybackRate(speed)', 'player.play()'],
  'loadAndPlay should write the temp base64 file before replacing the player source, setting speed, and playing.'
);
assertIncludes(
  loadAndPlayBlock,
  'FileSystem.EncodingType.Base64',
  'loadAndPlay should write MP3 data using base64 encoding.'
);
assertIncludes(
  stopBlock,
  'unloadAndCleanupCurrentFile()',
  'stop should delegate to cleanup that detaches and deletes the current temp file.'
);
assert(
  !playback.includes('player.replace(null)') &&
    !playback.includes('replacePlayerSource(null)') &&
    playback.includes('if (!source) return;'),
  'Playback cleanup should not call player.replace(null), which fails in Expo Audio on iOS reload.'
);
assertIncludes(
  playback,
  'deleteTempFile(uri)',
  'Playback cleanup should delete temp audio files.'
);
assertIncludes(
  playback,
  'const mountedRef = useRef(true)',
  'Playback should track hook mount state so late TTS generation cannot command a released native player.'
);
assertIncludes(
  loadAndPlayBlock,
  '!mountedRef.current',
  'loadAndPlay should discard generated clips if the reader unmounted before audio playback starts.'
);
for (const hookMember of ['loadAndPlay', 'seekBy', 'setSpeed', 'stop', 'pause', 'resume']) {
  assertIncludes(playbackReturnBlock, hookMember, `Playback hook should return ${hookMember}.`);
}

assertIncludes(
  reader,
  'void stop().catch',
  'Reader unmount cleanup should catch async TTS stop errors instead of leaving unhandled promise rejections.'
);

assertIncludes(bridgeRequestScriptBlock, 'const requestId =', 'Bridge request script should carry requestId.');
assertIncludes(
  bridge,
  'export function createRequestSelectedParagraphScript',
  'Bridge should export a selected-paragraph request script factory.'
);
assert(
  bridgeRequestScriptBlock.includes("const selectedCfiRange = kind === 'selected'") &&
    bridgeRequestScriptBlock.includes('content.range(selectedCfiRange)') &&
    bridgeRequestScriptBlock.includes('content.window.getSelection()') &&
    bridgeRequestScriptBlock.includes('content.cfiFromRange(selectionRange)') &&
    bridgeRequestScriptBlock.includes('firstWordIndexAtOrAfterSelection') &&
    bridgeRequestScriptBlock.includes('wordRanges.slice(selectedStartIndex)'),
  'Bridge selected mode should locate either the selected CFI range or live EPUB selection and slice paragraph words from the selected word.'
);
assertIncludes(
  bridgeRequestScriptBlock,
  "const blockSelector = 'p,h1,h2,h3,h4,h5,h6,li,blockquote,div,section,article,main,td,th,dd,dt';",
  'Bridge should treat common EPUB wrapper elements as readable text blocks.'
);
assertIncludes(
  bridgeRequestScriptBlock,
  "window.ReactNativeWebView.postMessage(JSON.stringify(payload))",
  'Bridge should post serialized payloads to React Native.'
);
assertIncludes(
  bridgeRequestScriptBlock,
  "type: '${BRIDGE_EVENT_TYPES.paragraph}'",
  'Bridge should send the configured ttsParagraph event type.'
);
assertMatches(
  bridgeRequestScriptBlock,
  /paragraph:\s*\{\s*paragraphId:\s*selected\.paragraphId,\s*text:\s*selected\.text,\s*words:\s*selected\.words\s*\}/,
  'Bridge ttsParagraph payload should include paragraphId, text, and words.'
);
assertIncludes(
  bridgeRequestScriptBlock,
  "type: '${BRIDGE_EVENT_TYPES.missingNext}'",
  'Bridge should send ttsNextParagraphMissing when there is no next paragraph.'
);
assertIncludes(
  bridgeRequestScriptBlock,
  "type: '${BRIDGE_EVENT_TYPES.error}'",
  'Bridge should send ttsParagraphError when extraction fails.'
);
assertIncludes(
  bridgeRequestScriptBlock,
  "span.setAttribute('data-tts-word-id', rangeRecord.wordId)",
  'Bridge should mark generated word spans with data-tts-word-id.'
);
assertIncludes(
  bridgeHighlightScriptBlock,
  "word.setAttribute('data-tts-active-word', 'true')",
  'Bridge highlight script should mark the active word.'
);
