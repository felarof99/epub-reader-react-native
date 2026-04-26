const fs = require('node:fs');
const assert = require('node:assert/strict');

const reader = fs.readFileSync('app/reader.tsx', 'utf8');
const preferences = fs.readFileSync('src/reader/preferences.ts', 'utf8');
const preferenceStorage = fs.readFileSync('src/storage/readerPreferences.ts', 'utf8');

assert(
  !reader.includes('useWindowDimensions'),
  'Reader should measure its actual pane instead of using full window dimensions.'
);

assert(
  !reader.includes('height - 100'),
  'Reader should not subtract an arbitrary height from the window.'
);

assert(
  reader.includes('manager="continuous"') &&
    reader.includes('flow="scrolled-doc"') &&
    reader.includes('keepScrollOffsetOnLocationChange'),
  'Reader should use continuous vertical scrolling instead of page flipping.'
);

assert(
  reader.includes('ReaderSettingsModal') &&
    reader.includes('text-outline') &&
    reader.includes('nextReaderFontSize'),
  'Reader should expose text-size controls from the header settings modal.'
);

assert(
  reader.includes('<PageTurnBar') &&
    reader.includes('goPrevious') &&
    reader.includes('goNext') &&
    reader.includes('pageTurnBar'),
  'Reader should include an always-visible thin bottom page turn bar.'
);

assert(
  preferences.includes("sepia") &&
    preferences.includes("dark") &&
    preferences.includes('fontSizePercent') &&
    preferences.includes('READER_FONT_SIZE_MAX') &&
    preferences.includes("'overflow-wrap'") &&
    preferences.includes("'max-width'"),
  'Reader preferences should define sepia/dark themes, bounded font sizes, and robust EPUB content constraints.'
);

assert(
  preferenceStorage.includes('AsyncStorage') &&
    preferenceStorage.includes('readerPreferences') &&
    reader.includes('readerPreferences.get()') &&
    reader.includes('readerPreferences.save(normalized)'),
  'Reader should persist theme and text-size preferences.'
);
