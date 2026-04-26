import { Reader, useReader } from '@epubjs-react-native/core';
import type { Location, Section } from '@epubjs-react-native/core';
import { Ionicons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import * as library from '../src/books/library';
import type { BookRecord } from '../src/books/library';
import { bookFileUri } from '../src/books/import';
import {
  DEFAULT_READER_PREFERENCES,
  READER_FONT_SIZE_MAX,
  READER_FONT_SIZE_MIN,
  READER_THEMES,
  clampReaderFontSize,
  fontSizePercent,
  nextReaderFontSize,
  type ReaderPreferences,
  type ReaderThemeId,
} from '../src/reader/preferences';
import { useLegacyFileSystem } from '../src/reader/useLegacyFileSystem';
import * as lastLocation from '../src/storage/lastLocation';
import * as readerPreferences from '../src/storage/readerPreferences';

type LoadState =
  | { status: 'loading' }
  | { status: 'missing' }
  | { status: 'ready'; book: BookRecord; fileUri: string; initialCfi?: string }
  | { status: 'error'; message: string };

export default function ReaderScreen() {
  const params = useLocalSearchParams<{ bookId: string }>();
  const bookId = params.bookId;
  const router = useRouter();
  const [state, setState] = useState<LoadState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!bookId) {
        if (!cancelled) setState({ status: 'missing' });
        return;
      }
      const [book, savedCfi] = await Promise.all([
        library.getById(bookId),
        lastLocation.get(bookId),
      ]);
      if (cancelled) return;
      if (!book) {
        setState({ status: 'missing' });
        return;
      }
      setState({
        status: 'ready',
        book,
        fileUri: bookFileUri(book),
        initialCfi: savedCfi,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [bookId]);

  if (state.status === 'loading') {
    return (
      <SafeAreaView style={styles.container}>
        <Stack.Screen options={{ title: '' }} />
        <View style={styles.center}>
          <ActivityIndicator />
        </View>
      </SafeAreaView>
    );
  }

  if (state.status === 'missing') {
    return (
      <SafeAreaView style={styles.container}>
        <Stack.Screen options={{ title: '' }} />
        <View style={styles.center}>
          <Text style={styles.errorTitle}>Book not found</Text>
          <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
            <Text style={styles.backText}>Back to library</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  if (state.status === 'error') {
    return (
      <SafeAreaView style={styles.container}>
        <Stack.Screen options={{ title: '' }} />
        <View style={styles.center}>
          <Text style={styles.errorTitle}>Couldn’t load book</Text>
          <Text style={styles.errorMessage}>{state.message}</Text>
          <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
            <Text style={styles.backText}>Back to library</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <ReaderView
      book={state.book}
      fileUri={state.fileUri}
      initialCfi={state.initialCfi}
      onError={(message) => setState({ status: 'error', message })}
    />
  );
}

type ReaderViewProps = {
  book: BookRecord;
  fileUri: string;
  initialCfi?: string;
  onError: (message: string) => void;
};

function ReaderView({ book, fileUri, initialCfi, onError }: ReaderViewProps) {
  const router = useRouter();
  const [tocVisible, setTocVisible] = useState(false);
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [chapterLabel, setChapterLabel] = useState<string>(book.title);
  const [preferences, setPreferences] = useState<ReaderPreferences | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialThemeRef = useRef(READER_THEMES[DEFAULT_READER_PREFERENCES.themeId].theme);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    readerPreferences.get().then((savedPreferences) => {
      if (cancelled) return;
      setPreferences(savedPreferences);
      initialThemeRef.current = READER_THEMES[savedPreferences.themeId].theme;
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const updatePreferences = useCallback((next: Partial<ReaderPreferences>) => {
    setPreferences((current) => {
      const updated = {
        ...(current ?? DEFAULT_READER_PREFERENCES),
        ...next,
      };

      const normalized = {
        fontSize: clampReaderFontSize(updated.fontSize),
        themeId: updated.themeId,
      };

      readerPreferences.save(normalized);
      return normalized;
    });
  }, []);

  const handleLocationChange = useCallback(
    (
      _totalLocations: number,
      currentLocation: Location,
      progress: number,
      currentSection: Section | null
    ) => {
      const cfi = currentLocation?.start?.cfi ?? currentLocation?.end?.cfi;
      const label = currentSection?.label?.trim() || book.title;
      setChapterLabel(label);

      if (!cfi) return;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        lastLocation.save(book.id, cfi);
        if (typeof progress === 'number') {
          lastLocation.saveProgress(book.id, label, progress);
        }
      }, 1000);
    },
    [book.id, book.title]
  );

  const activePreferences = preferences ?? DEFAULT_READER_PREFERENCES;
  const activeTheme = READER_THEMES[activePreferences.themeId];

  if (!preferences) {
    return (
      <View style={styles.container}>
        <Stack.Screen
          options={{
            title: book.title,
            headerTitleStyle: { fontSize: 15 },
          }}
        />
        <View style={styles.center}>
          <ActivityIndicator />
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: activeTheme.colors.background }]}>
      <Stack.Screen
        options={{
          title: chapterLabel,
          headerStyle: { backgroundColor: activeTheme.colors.background },
          headerTintColor: activeTheme.colors.text,
          headerTitleStyle: { color: activeTheme.colors.text, fontSize: 15 },
          headerRight: () => (
            <View style={styles.headerActions}>
              <TouchableOpacity
                onPress={() => setSettingsVisible(true)}
                style={styles.headerButton}
                accessibilityLabel="Reader settings"
              >
                <Ionicons name="text-outline" size={23} color={activeTheme.colors.text} />
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setTocVisible(true)}
                style={styles.headerButton}
                accessibilityLabel="Chapters"
              >
                <Ionicons name="list" size={24} color={activeTheme.colors.text} />
              </TouchableOpacity>
            </View>
          ),
        }}
      />
      <View style={[styles.readerArea, { backgroundColor: activeTheme.colors.background }]}>
        <Reader
          src={fileUri}
          fileSystem={useLegacyFileSystem}
          width="100%"
          height="100%"
          initialLocation={initialCfi}
          defaultTheme={initialThemeRef.current}
          manager="continuous"
          flow="scrolled-doc"
          keepScrollOffsetOnLocationChange
          onLocationChange={handleLocationChange}
          onDisplayError={(message: string) => onError(message || 'Unknown error')}
          renderLoadingFileComponent={() => (
            <View style={[styles.center, { backgroundColor: activeTheme.colors.background }]}>
              <ActivityIndicator />
            </View>
          )}
          renderOpeningBookComponent={() => (
            <View style={[styles.center, { backgroundColor: activeTheme.colors.background }]}>
              <ActivityIndicator />
            </View>
          )}
        />
      </View>
      <ReaderPreferenceApplier
        fontSize={activePreferences.fontSize}
        themeId={activePreferences.themeId}
      />
      <ReaderSettingsModal
        visible={settingsVisible}
        fontSize={activePreferences.fontSize}
        themeId={activePreferences.themeId}
        onClose={() => setSettingsVisible(false)}
        onFontSizeChange={(fontSize) => updatePreferences({ fontSize })}
        onThemeChange={(themeId) => updatePreferences({ themeId })}
      />
      <TocModal
        visible={tocVisible}
        themeId={activePreferences.themeId}
        onClose={() => setTocVisible(false)}
      />
    </View>
  );
}

function ReaderPreferenceApplier({
  fontSize,
  themeId,
}: {
  fontSize: number;
  themeId: ReaderThemeId;
}) {
  const { changeFontSize, changeTheme, isLoading, isRendering } = useReader();
  const appliedKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (isLoading || isRendering) return;

    const appliedKey = `${themeId}:${fontSize}`;
    if (appliedKeyRef.current === appliedKey) return;

    changeTheme(READER_THEMES[themeId].theme);
    changeFontSize(fontSizePercent(fontSize));
    appliedKeyRef.current = appliedKey;
  }, [changeFontSize, changeTheme, fontSize, isLoading, isRendering, themeId]);

  return null;
}

function ReaderSettingsModal({
  visible,
  fontSize,
  themeId,
  onClose,
  onFontSizeChange,
  onThemeChange,
}: {
  visible: boolean;
  fontSize: number;
  themeId: ReaderThemeId;
  onClose: () => void;
  onFontSizeChange: (fontSize: number) => void;
  onThemeChange: (themeId: ReaderThemeId) => void;
}) {
  const activeTheme = READER_THEMES[themeId];
  const canDecrease = fontSize > READER_FONT_SIZE_MIN;
  const canIncrease = fontSize < READER_FONT_SIZE_MAX;

  return (
    <Modal animationType="slide" presentationStyle="pageSheet" visible={visible} onRequestClose={onClose}>
      <SafeAreaView style={[styles.modalContainer, { backgroundColor: activeTheme.colors.background }]} edges={['top', 'bottom']}>
        <View style={[styles.modalHeader, { borderBottomColor: activeTheme.colors.border }]}>
          <Text style={[styles.modalTitle, { color: activeTheme.colors.text }]}>Reader</Text>
          <TouchableOpacity onPress={onClose} style={styles.headerButton} accessibilityLabel="Close">
            <Ionicons name="close" size={24} color={activeTheme.colors.text} />
          </TouchableOpacity>
        </View>

        <View style={styles.settingsContent}>
          <View style={styles.settingsSection}>
            <Text style={[styles.settingLabel, { color: activeTheme.colors.mutedText }]}>Text size</Text>
            <View style={[styles.stepper, { borderColor: activeTheme.colors.border }]}>
              <TouchableOpacity
                disabled={!canDecrease}
                onPress={() => onFontSizeChange(nextReaderFontSize(fontSize, 'decrease'))}
                style={[styles.stepperButton, !canDecrease && styles.disabledControl]}
                accessibilityLabel="Decrease text size"
              >
                <Ionicons name="remove" size={22} color={activeTheme.colors.text} />
              </TouchableOpacity>
              <Text style={[styles.stepperValue, { color: activeTheme.colors.text }]}>
                {fontSizePercent(fontSize)}
              </Text>
              <TouchableOpacity
                disabled={!canIncrease}
                onPress={() => onFontSizeChange(nextReaderFontSize(fontSize, 'increase'))}
                style={[styles.stepperButton, !canIncrease && styles.disabledControl]}
                accessibilityLabel="Increase text size"
              >
                <Ionicons name="add" size={22} color={activeTheme.colors.text} />
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.settingsSection}>
            <Text style={[styles.settingLabel, { color: activeTheme.colors.mutedText }]}>Theme</Text>
            <View style={styles.themeList}>
              {(Object.keys(READER_THEMES) as ReaderThemeId[]).map((optionId) => {
                const option = READER_THEMES[optionId];
                const selected = optionId === themeId;

                return (
                  <Pressable
                    key={optionId}
                    onPress={() => onThemeChange(optionId)}
                    style={({ pressed }) => [
                      styles.themeRow,
                      {
                        borderColor: selected ? activeTheme.colors.control : activeTheme.colors.border,
                        backgroundColor: pressed ? activeTheme.colors.pressed : activeTheme.colors.background,
                      },
                    ]}
                    accessibilityRole="button"
                  >
                    <View
                      style={[
                        styles.themeSwatch,
                        {
                          backgroundColor: option.colors.swatch,
                          borderColor: option.colors.border,
                        },
                      ]}
                    />
                    <Text style={[styles.themeLabel, { color: activeTheme.colors.text }]}>
                      {option.label}
                    </Text>
                    {selected ? (
                      <Ionicons name="checkmark" size={21} color={activeTheme.colors.text} />
                    ) : null}
                  </Pressable>
                );
              })}
            </View>
          </View>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

type TocItem = {
  label: string;
  href: string;
  subitems?: TocItem[];
};

function TocModal({
  visible,
  themeId,
  onClose,
}: {
  visible: boolean;
  themeId: ReaderThemeId;
  onClose: () => void;
}) {
  const { toc, goToLocation } = useReader();
  const items = flattenToc((toc as TocItem[] | undefined) ?? []);
  const activeTheme = READER_THEMES[themeId];

  return (
    <Modal animationType="slide" presentationStyle="pageSheet" visible={visible} onRequestClose={onClose}>
      <SafeAreaView style={[styles.modalContainer, { backgroundColor: activeTheme.colors.background }]} edges={['top', 'bottom']}>
        <View style={[styles.modalHeader, { borderBottomColor: activeTheme.colors.border }]}>
          <Text style={[styles.modalTitle, { color: activeTheme.colors.text }]}>Chapters</Text>
          <TouchableOpacity onPress={onClose} style={styles.headerButton} accessibilityLabel="Close">
            <Ionicons name="close" size={24} color={activeTheme.colors.text} />
          </TouchableOpacity>
        </View>
        {items.length === 0 ? (
          <View style={styles.center}>
            <Text style={[styles.modalEmpty, { color: activeTheme.colors.mutedText }]}>
              No chapters available
            </Text>
          </View>
        ) : (
          <FlatList
            style={{ backgroundColor: activeTheme.colors.background }}
            data={items}
            keyExtractor={(item, index) => `${item.href}-${index}`}
            renderItem={({ item }) => (
              <Pressable
                style={({ pressed }) => [
                  styles.tocRow,
                  {
                    backgroundColor: pressed ? activeTheme.colors.pressed : activeTheme.colors.background,
                    paddingLeft: 20 + item.depth * 16,
                  },
                ]}
                onPress={() => {
                  goToLocation(item.href);
                  onClose();
                }}
              >
                <Text style={[styles.tocLabel, { color: activeTheme.colors.text }]} numberOfLines={2}>
                  {item.label}
                </Text>
              </Pressable>
            )}
            ItemSeparatorComponent={() => (
              <View style={[styles.tocSeparator, { backgroundColor: activeTheme.colors.border }]} />
            )}
          />
        )}
      </SafeAreaView>
    </Modal>
  );
}

function flattenToc(items: TocItem[], depth = 0): Array<TocItem & { depth: number }> {
  const result: Array<TocItem & { depth: number }> = [];
  for (const item of items) {
    result.push({ ...item, depth });
    if (item.subitems && item.subitems.length > 0) {
      result.push(...flattenToc(item.subitems, depth + 1));
    }
  }
  return result;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  readerArea: { flex: 1 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  headerButton: { paddingHorizontal: 8, paddingVertical: 4 },
  errorTitle: { fontSize: 18, fontWeight: '600', color: '#222' },
  errorMessage: { fontSize: 14, color: '#777', textAlign: 'center' },
  backButton: {
    marginTop: 8,
    backgroundColor: '#111',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 999,
  },
  backText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  modalContainer: { flex: 1, backgroundColor: '#fff' },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e5e5e5',
  },
  modalTitle: { fontSize: 18, fontWeight: '700', color: '#111' },
  modalEmpty: { fontSize: 14, color: '#888' },
  settingsContent: { paddingHorizontal: 20, paddingTop: 24, gap: 28 },
  settingsSection: { gap: 12 },
  settingLabel: { fontSize: 13, fontWeight: '700', letterSpacing: 0, textTransform: 'uppercase' },
  stepper: {
    alignSelf: 'flex-start',
    minWidth: 184,
    height: 48,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    overflow: 'hidden',
  },
  stepperButton: {
    width: 52,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperValue: {
    minWidth: 72,
    textAlign: 'center',
    fontSize: 17,
    fontWeight: '700',
  },
  disabledControl: { opacity: 0.35 },
  themeList: { gap: 10 },
  themeRow: {
    minHeight: 52,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  themeSwatch: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  themeLabel: { flex: 1, fontSize: 16, fontWeight: '600' },
  tocRow: { paddingVertical: 14, paddingRight: 20, backgroundColor: '#fff' },
  tocLabel: { fontSize: 15, color: '#222' },
  tocSeparator: { height: StyleSheet.hairlineWidth, backgroundColor: '#eee', marginLeft: 20 },
});
