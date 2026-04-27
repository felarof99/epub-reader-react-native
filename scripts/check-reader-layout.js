const fs = require('node:fs');
const assert = require('node:assert/strict');

const reader = fs.readFileSync('app/reader.tsx', 'utf8');
const preferences = fs.readFileSync('src/reader/preferences.ts', 'utf8');
const preferenceStorage = fs.readFileSync('src/storage/readerPreferences.ts', 'utf8');
const settingsScreen = fs.readFileSync('app/settings.tsx', 'utf8');
const removedHighlightFiles = [
  'src/highlights/SelectionContext.tsx',
  'src/highlights/highlights.ts',
  'src/highlights/injected/railScript.ts',
  'src/highlights/webviewBridge.ts',
];

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
  readerBlock.includes('manager={activeLayout.manager}') &&
    readerBlock.includes('flow={activeLayout.flow}') &&
    readerBlock.includes('keepScrollOffsetOnLocationChange={activeLayout.keepScrollOffsetOnLocationChange}') &&
    readerBlock.includes('enableSelection') &&
    readerBlock.includes('menuItems={ttsMenuItems}') &&
    reader.includes('readerLayoutForPreferences({ readingMode })') &&
    preferences.includes("flow: 'scrolled-doc'") &&
    preferences.includes("flow: 'paginated'") &&
    preferences.includes("manager: 'continuous'") &&
    preferences.includes("manager: 'default'"),
  'Reader should use the saved reading mode to choose continuous scroll or paginated EPUB layout.'
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
    reader.includes('Current narration speed') &&
    !reader.includes('ttsSpeedOption') &&
    reader.includes('ttsBar') &&
    !reader.includes('<PageTurnBar') &&
    !reader.includes('pageTurnProgressTrack') &&
    !reader.includes('createSpineSafePageTurnScript'),
  'Reader should include an always-visible TTS bar and should not include page controls or a page progress row.'
);

assert(
  removedHighlightFiles.every((file) => !fs.existsSync(file)) &&
    !reader.includes('HighlightSelectionProvider') &&
    !reader.includes('useHighlightReaderBridge') &&
    !reader.includes('noteControls') &&
    !reader.includes('setNoteMode(!noteMode)'),
  'Highlight rail/note mode files and reader wiring should remain removed.'
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
    preferenceStorage.includes('isReaderReadingMode(parsed.readingMode)') &&
    preferenceStorage.includes('isReaderReadingMode(preferences.readingMode)') &&
    settingsScreen.includes('READING_MODE_OPTIONS') &&
    settingsScreen.includes('Continuous scroll') &&
    settingsScreen.includes('Page by page') &&
    settingsScreen.includes('readerPreferences.save(next)') &&
    reader.includes('readerPreferences.get()') &&
    reader.includes('readerPreferences.save(normalized)') &&
    reader.includes('readerThemeForPreferences(savedPreferences)') &&
    reader.includes('readerThemeForPreferences({ fontSize, themeId })'),
  'Reader should persist and automatically apply saved theme and text-size preferences.'
);
