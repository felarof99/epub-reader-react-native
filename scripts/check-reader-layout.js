const fs = require('node:fs');
const assert = require('node:assert/strict');

const reader = fs.readFileSync('app/reader.tsx', 'utf8');
const preferences = fs.readFileSync('src/reader/preferences.ts', 'utf8');
const preferenceStorage = fs.readFileSync('src/storage/readerPreferences.ts', 'utf8');

function extractJsxBlock(source, startToken) {
  const start = source.indexOf(startToken);
  assert(start >= 0, `Could not find JSX block start: ${startToken}`);
  const end = source.indexOf('/>', start + startToken.length);
  assert(end >= 0, `Could not find JSX block end after ${startToken}`);
  return source.slice(start, end + 2);
}

const readerBlock = extractJsxBlock(reader, '<Reader\n');
const ttsControlBarBlock = extractJsxBlock(reader, '<TtsControlBar');

assert(
  !reader.includes('useWindowDimensions'),
  'Reader should measure its actual pane instead of using full window dimensions.'
);

assert(
  !reader.includes('height - 100'),
  'Reader should not subtract an arbitrary height from the window.'
);

assert(
  readerBlock.includes('manager="continuous"') &&
    readerBlock.includes('flow="scrolled-doc"') &&
    readerBlock.includes('keepScrollOffsetOnLocationChange') &&
    !readerBlock.includes('flow="paginated"'),
  'Reader should use continuous vertical scrolling instead of page flipping.'
);

assert(
  reader.includes('ReaderSettingsModal') &&
    reader.includes('text-outline') &&
    reader.includes('nextReaderFontSize'),
  'Reader should expose text-size controls from the header settings modal.'
);

assert(
  ttsControlBarBlock.includes('onSeekBack') &&
    ttsControlBarBlock.includes('onSeekForward') &&
    ttsControlBarBlock.includes('onSpeedDown') &&
    ttsControlBarBlock.includes('onSpeedUp') &&
    reader.includes('ttsBar') &&
    !reader.includes('<PageTurnBar') &&
    !reader.includes('pageTurnProgressTrack') &&
    !reader.includes('createSpineSafePageTurnScript'),
  'Reader should include an always-visible TTS bar and should not include page controls or a page progress row.'
);

assert(
  preferences.includes("sepia") &&
    preferences.includes("dark") &&
    preferences.includes('fontSizePercent') &&
    preferences.includes('readerThemeForPreferences') &&
    preferences.includes('READER_FONT_SIZE_MAX') &&
    preferences.includes("'overflow-wrap'") &&
    preferences.includes("'max-width'"),
  'Reader preferences should define sepia/dark themes, bounded font sizes, initial font-size themes, and robust EPUB content constraints.'
);

assert(
  preferenceStorage.includes('AsyncStorage') &&
    preferenceStorage.includes('readerPreferences') &&
    reader.includes('readerPreferences.get()') &&
    reader.includes('readerPreferences.save(normalized)') &&
    reader.includes('readerThemeForPreferences(savedPreferences)') &&
    reader.includes('readerThemeForPreferences({ fontSize, themeId })'),
  'Reader should persist and automatically apply saved theme and text-size preferences.'
);
