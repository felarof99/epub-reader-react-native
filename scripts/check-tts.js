const fs = require('node:fs');
const assert = require('node:assert/strict');

const reader = fs.readFileSync('app/reader.tsx', 'utf8');
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
    bridge.includes('data-tts-active-word'),
  'Reader bridge should extract visible paragraphs and mark active words in the WebView.'
);

assert(
  timing.includes('mapAlignmentToWordTimings') &&
    timing.includes('activeWordIdAtTime') &&
    timing.includes('TTS_SPEEDS'),
  'Timing helpers should map timestamps to words and enforce allowed speeds.'
);

assert(
  reader.includes('onWebViewMessage={handleTtsWebViewMessage}') &&
    reader.includes('createRequestVisibleParagraphScript') &&
    reader.includes('fetchVoices'),
  'Reader should wire WebView extraction, highlighting, voice loading, and speech generation.'
);

assertIncludes(
  ttsControlBarBlock,
  'requestVisibleParagraph();',
  'TTS play button should request the visible paragraph from the TTS control bar onPlayPause path.'
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
assertIncludes(
  playback,
  'player.replace(null)',
  'Playback cleanup should detach the player source with player.replace(null).'
);
assertIncludes(
  playback,
  'deleteTempFile(uri)',
  'Playback cleanup should delete temp audio files.'
);
for (const hookMember of ['loadAndPlay', 'seekBy', 'setSpeed', 'stop', 'pause', 'resume']) {
  assertIncludes(playbackReturnBlock, hookMember, `Playback hook should return ${hookMember}.`);
}

assertIncludes(bridgeRequestScriptBlock, 'const requestId =', 'Bridge request script should carry requestId.');
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
  "span.setAttribute('data-tts-word-id', word.id)",
  'Bridge should mark generated word spans with data-tts-word-id.'
);
assertIncludes(
  bridgeHighlightScriptBlock,
  "word.setAttribute('data-tts-active-word', 'true')",
  'Bridge highlight script should mark the active word.'
);
