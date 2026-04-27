import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  DEFAULT_READER_PREFERENCES,
  clampReaderFontSize,
  isReaderReadingMode,
  isReaderThemeId,
  type ReaderPreferences,
} from '../reader/preferences';

const READER_PREFERENCES_KEY = 'readerPreferences';

export async function get(): Promise<ReaderPreferences> {
  try {
    const raw = await AsyncStorage.getItem(READER_PREFERENCES_KEY);
    if (!raw) return DEFAULT_READER_PREFERENCES;

    const parsed = JSON.parse(raw) as Partial<ReaderPreferences>;

    return {
      fontSize: clampReaderFontSize(parsed.fontSize),
      readingMode: isReaderReadingMode(parsed.readingMode)
        ? parsed.readingMode
        : DEFAULT_READER_PREFERENCES.readingMode,
      themeId: isReaderThemeId(parsed.themeId) ? parsed.themeId : DEFAULT_READER_PREFERENCES.themeId,
    };
  } catch (error) {
    console.warn('readerPreferences.get failed', error);
    return DEFAULT_READER_PREFERENCES;
  }
}

export async function save(preferences: ReaderPreferences): Promise<void> {
  try {
    await AsyncStorage.setItem(
      READER_PREFERENCES_KEY,
      JSON.stringify({
        fontSize: clampReaderFontSize(preferences.fontSize),
        readingMode: isReaderReadingMode(preferences.readingMode)
          ? preferences.readingMode
          : DEFAULT_READER_PREFERENCES.readingMode,
        themeId: preferences.themeId,
      })
    );
  } catch (error) {
    console.warn('readerPreferences.save failed', error);
  }
}
