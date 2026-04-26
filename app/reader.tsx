import { Reader, useReader } from '@epubjs-react-native/core';
import type { Location, Section, Theme } from '@epubjs-react-native/core';
import { Ionicons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import * as library from '../src/books/library';
import type { BookRecord } from '../src/books/library';
import { bookFileUri } from '../src/books/import';
import {
  HighlightSelectionProvider,
  useHighlightReaderBridge,
  useHighlightSelection,
} from '../src/highlights/SelectionContext';
import * as highlightStore from '../src/highlights/highlights';
import { HIGHLIGHT_PALETTE, type Highlight, type HighlightColor } from '../src/highlights/highlights';
import {
  DEFAULT_READER_PREFERENCES,
  READER_FONT_SIZE_MAX,
  READER_FONT_SIZE_MIN,
  READER_THEMES,
  clampReaderFontSize,
  fontSizePercent,
  nextReaderFontSize,
  readerThemeForPreferences,
  type ReaderPreferences,
  type ReaderThemeId,
} from '../src/reader/preferences';
import { useLegacyFileSystem } from '../src/reader/useLegacyFileSystem';
import * as lastLocation from '../src/storage/lastLocation';
import * as readerPreferences from '../src/storage/readerPreferences';
import { generateSpeech } from '../src/tts/elevenLabs';
import {
  createClearHighlightScript,
  createHighlightWordScript,
  createRequestNextParagraphScript,
  createRequestSelectedParagraphScript,
  createRequestVisibleParagraphScript,
} from '../src/tts/readerBridge';
import * as ttsSettings from '../src/tts/settings';
import {
  activeWordIdAtTime,
  formatTtsSpeed,
  mapAlignmentToWordTimings,
  nextTtsSpeed,
  previousTtsSpeed,
} from '../src/tts/timing';
import {
  TTS_SPEEDS,
  type TtsBridgeMessage,
  type TtsParagraph,
  type TtsSettings,
  type TtsSpeed,
  type WordTiming,
} from '../src/tts/types';
import { useTtsPlayback } from '../src/tts/useTtsPlayback';

type LoadState =
  | { status: 'loading' }
  | { status: 'missing' }
  | { status: 'ready'; book: BookRecord; fileUri: string; initialCfi?: string; highlights: Highlight[] }
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
      const [book, savedCfi, savedHighlights] = await Promise.all([
        library.getById(bookId),
        lastLocation.get(bookId),
        highlightStore.list(bookId),
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
        highlights: savedHighlights,
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
      initialHighlights={state.highlights}
      onError={(message) => setState({ status: 'error', message })}
    />
  );
}

type ReaderViewProps = {
  book: BookRecord;
  fileUri: string;
  initialCfi?: string;
  initialHighlights: Highlight[];
  onError: (message: string) => void;
};

function ReaderView({ book, fileUri, initialCfi, initialHighlights, onError }: ReaderViewProps) {
  const router = useRouter();
  const [tocVisible, setTocVisible] = useState(false);
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [chapterLabel, setChapterLabel] = useState<string>(book.title);
  const [preferences, setPreferences] = useState<ReaderPreferences | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [ttsPrefs, setTtsPrefs] = useState<TtsSettings>({ speed: 1 });
  const [ttsError, setTtsError] = useState<string | null>(null);
  const [ttsLoading, setTtsLoading] = useState(false);
  const [currentParagraph, setCurrentParagraph] = useState<TtsParagraph | null>(null);
  const [wordTimings, setWordTimings] = useState<WordTiming[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestIdRef = useRef(0);
  const pendingRequestRef = useRef<'visible' | 'next' | 'selected' | null>(null);
  const latestRequestIdRef = useRef<string | null>(null);
  const generationTokenRef = useRef(0);
  const exhaustedAutoplayParagraphIdRef = useRef<string | null>(null);
  const lastHighlightedWordRef = useRef<{ paragraphId: string; wordId: string } | null>(null);
  const userPausedTtsRef = useRef(false);
  const initialThemeRef = useRef(readerThemeForPreferences(DEFAULT_READER_PREFERENCES));
  const playback = useTtsPlayback();
  const { injectJavascript } = useReader();
  const { loadAndPlay, pause, seekBy, setSpeed, stop } = playback;

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    readerPreferences.get().then((savedPreferences) => {
      if (cancelled) return;
      initialThemeRef.current = readerThemeForPreferences(savedPreferences);
      setPreferences(savedPreferences);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    Promise.all([ttsSettings.getApiKey(), ttsSettings.getSettings()])
      .then(([savedApiKey, savedSettings]) => {
        if (cancelled) return;
        setApiKey(savedApiKey);
        setTtsPrefs(savedSettings);
      })
      .catch((error) => {
        console.warn('TTS settings load failed', error);
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

  const nextRequestId = useCallback(() => {
    requestIdRef.current += 1;
    return `tts-${requestIdRef.current}`;
  }, []);

  const clearTtsHighlight = useCallback(() => {
    if (!lastHighlightedWordRef.current) return;
    lastHighlightedWordRef.current = null;
    injectJavascript(createClearHighlightScript());
  }, [injectJavascript]);

  const requestVisibleParagraph = useCallback(() => {
    const requestId = nextRequestId();
    pendingRequestRef.current = 'visible';
    latestRequestIdRef.current = requestId;
    exhaustedAutoplayParagraphIdRef.current = null;
    userPausedTtsRef.current = false;
    setTtsLoading(true);
    setTtsError(null);
    injectJavascript(createRequestVisibleParagraphScript(requestId));
  }, [injectJavascript, nextRequestId]);

  const requestNextParagraph = useCallback((paragraphId: string) => {
    const requestId = nextRequestId();
    pendingRequestRef.current = 'next';
    latestRequestIdRef.current = requestId;
    userPausedTtsRef.current = false;
    setTtsLoading(true);
    setTtsError(null);
    injectJavascript(createRequestNextParagraphScript(requestId, paragraphId));
  }, [injectJavascript, nextRequestId]);

  const requestSelectedParagraph = useCallback((cfiRange: string) => {
    const trimmedCfiRange = cfiRange.trim();
    const requestId = nextRequestId();
    pendingRequestRef.current = 'selected';
    latestRequestIdRef.current = requestId;
    exhaustedAutoplayParagraphIdRef.current = null;
    userPausedTtsRef.current = false;
    setTtsLoading(true);
    setTtsError(null);
    clearTtsHighlight();
    injectJavascript(createRequestSelectedParagraphScript(requestId, trimmedCfiRange));
  }, [clearTtsHighlight, injectJavascript, nextRequestId]);

  const handleSpeedChange = useCallback(async (speed: TtsSpeed) => {
    setTtsPrefs((current) => ({ ...current, speed }));
    setSpeed(speed);
    try {
      await ttsSettings.saveSpeed(speed);
    } catch (error) {
      setTtsError(error instanceof Error ? error.message : 'Could not save narration speed.');
    }
  }, [setSpeed]);

  const handleSeekBy = useCallback((seconds: number) => {
    void seekBy(seconds).catch((error) => {
      setTtsError(error instanceof Error ? error.message : 'Could not seek narration.');
    });
  }, [seekBy]);

  const playParagraph = useCallback(async (paragraph: TtsParagraph) => {
    const generationToken = generationTokenRef.current + 1;
    generationTokenRef.current = generationToken;
    const trimmedApiKey = apiKey.trim();

    if (!trimmedApiKey) {
      setTtsError('Enter your ElevenLabs API key in settings first.');
      pendingRequestRef.current = null;
      latestRequestIdRef.current = null;
      setTtsLoading(false);
      clearTtsHighlight();
      void stop();
      return;
    }
    if (!ttsPrefs.selectedVoice?.voiceId) {
      setTtsError('Load and select an ElevenLabs voice first.');
      pendingRequestRef.current = null;
      latestRequestIdRef.current = null;
      setTtsLoading(false);
      clearTtsHighlight();
      void stop();
      return;
    }

    setTtsLoading(true);
    setTtsError(null);

    try {
      const speech = await generateSpeech({
        apiKey: trimmedApiKey,
        voiceId: ttsPrefs.selectedVoice.voiceId,
        text: paragraph.text,
      });
      const alignment = speech.normalized_alignment ?? speech.alignment;
      const timings = mapAlignmentToWordTimings(alignment, paragraph.words);
      if (generationTokenRef.current !== generationToken) return;

      setCurrentParagraph(paragraph);
      setWordTimings(timings);
      exhaustedAutoplayParagraphIdRef.current = null;
      userPausedTtsRef.current = false;
      await loadAndPlay({ audioBase64: speech.audio_base64, speed: ttsPrefs.speed });
    } catch (error) {
      if (generationTokenRef.current === generationToken) {
        setTtsError(error instanceof Error ? error.message : 'Could not start text-to-speech.');
        clearTtsHighlight();
      }
    } finally {
      if (generationTokenRef.current === generationToken) {
        setTtsLoading(false);
      }
    }
  }, [apiKey, clearTtsHighlight, loadAndPlay, stop, ttsPrefs.selectedVoice?.voiceId, ttsPrefs.speed]);

  const handleTtsWebViewMessage = useCallback((message: TtsBridgeMessage) => {
    if (message.requestId !== latestRequestIdRef.current) return;

    if (message.type === 'ttsParagraph') {
      pendingRequestRef.current = null;
      latestRequestIdRef.current = null;
      void playParagraph(message.paragraph);
      return;
    }

    if (message.type === 'ttsNextParagraphMissing') {
      pendingRequestRef.current = null;
      latestRequestIdRef.current = null;
      exhaustedAutoplayParagraphIdRef.current = currentParagraph?.paragraphId ?? null;
      setTtsLoading(false);
      clearTtsHighlight();
      return;
    }

    if (message.type === 'ttsParagraphError') {
      pendingRequestRef.current = null;
      latestRequestIdRef.current = null;
      setTtsError(message.message);
      setTtsLoading(false);
      clearTtsHighlight();
    }
  }, [clearTtsHighlight, currentParagraph?.paragraphId, playParagraph]);

  useEffect(() => {
    if (!playback.isPlaying || ttsLoading || !currentParagraph) {
      clearTtsHighlight();
      return;
    }

    const activeWordId = activeWordIdAtTime(wordTimings, playback.currentTime);
    if (!activeWordId) {
      clearTtsHighlight();
      return;
    }

    const lastHighlightedWord = lastHighlightedWordRef.current;
    if (
      lastHighlightedWord?.paragraphId === currentParagraph.paragraphId &&
      lastHighlightedWord.wordId === activeWordId
    ) {
      return;
    }

    lastHighlightedWordRef.current = { paragraphId: currentParagraph.paragraphId, wordId: activeWordId };
    injectJavascript(createHighlightWordScript(currentParagraph.paragraphId, activeWordId));
  }, [clearTtsHighlight, currentParagraph, injectJavascript, playback.currentTime, playback.isPlaying, ttsLoading, wordTimings]);

  useEffect(() => {
    if (!currentParagraph || playback.isPlaying || ttsLoading || pendingRequestRef.current) return;
    if (userPausedTtsRef.current) return;
    if (exhaustedAutoplayParagraphIdRef.current === currentParagraph.paragraphId) return;
    if (playback.duration > 0 && playback.currentTime >= playback.duration - 0.15) {
      requestNextParagraph(currentParagraph.paragraphId);
    }
  }, [currentParagraph, playback.currentTime, playback.duration, playback.isPlaying, requestNextParagraph, ttsLoading]);

  useEffect(() => {
    return () => {
      void stop().catch((error) => {
        console.warn('TTS reader cleanup failed', error);
      });
      clearTtsHighlight();
    };
  }, [clearTtsHighlight, stop]);

  const activePreferences = preferences ?? DEFAULT_READER_PREFERENCES;
  const activeTheme = READER_THEMES[activePreferences.themeId];
  const pauseTtsForNoteMode = useCallback(() => {
    if (!playback.isPlaying) return;
    userPausedTtsRef.current = true;
    pause();
  }, [pause, playback.isPlaying]);

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
      <HighlightSelectionProvider
        bookId={book.id}
        initialHighlights={initialHighlights}
        onRequestPauseAudio={pauseTtsForNoteMode}
      >
        <ReaderContent
          fileUri={fileUri}
          initialCfi={initialCfi}
          defaultTheme={initialThemeRef.current}
          themeId={activePreferences.themeId}
          onLocationChange={handleLocationChange}
          onReadAloudFromSelection={requestSelectedParagraph}
          onWebViewMessage={handleTtsWebViewMessage}
          onError={onError}
        />
        <TtsControlBar
          themeId={activePreferences.themeId}
          loading={ttsLoading}
          playing={playback.isPlaying}
          loaded={playback.isLoaded}
          speed={ttsPrefs.speed}
          error={ttsError}
          onPlayPause={() => {
            if (playback.isPlaying) {
              userPausedTtsRef.current = true;
              playback.pause();
            } else if (playback.isLoaded && currentParagraph) {
              userPausedTtsRef.current = false;
              playback.resume();
            } else {
              requestVisibleParagraph();
            }
          }}
          onSeekBack={() => handleSeekBy(-10)}
          onSeekForward={() => handleSeekBy(10)}
          onSpeedDown={() => handleSpeedChange(previousTtsSpeed(ttsPrefs.speed))}
          onSpeedSelect={handleSpeedChange}
          onSpeedUp={() => handleSpeedChange(nextTtsSpeed(ttsPrefs.speed))}
        />
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
      </HighlightSelectionProvider>
    </View>
  );
}

function ReaderContent({
  fileUri,
  initialCfi,
  defaultTheme,
  themeId,
  onLocationChange,
  onReadAloudFromSelection,
  onWebViewMessage,
  onError,
}: {
  fileUri: string;
  initialCfi?: string;
  defaultTheme: Theme;
  themeId: ReaderThemeId;
  onLocationChange: (
    totalLocations: number,
    currentLocation: Location,
    progress: number,
    currentSection: Section | null
  ) => void;
  onReadAloudFromSelection: (cfiRange: string) => void;
  onWebViewMessage: (message: TtsBridgeMessage) => void;
  onError: (message: string) => void;
}) {
  const activeTheme = READER_THEMES[themeId];
  const { injectedJavascript, handleWebViewMessage: handleHighlightWebViewMessage } = useHighlightReaderBridge();
  const handleWebViewMessage = useCallback(
    (message: unknown) => {
      handleHighlightWebViewMessage(message);
      onWebViewMessage(message as TtsBridgeMessage);
    },
    [handleHighlightWebViewMessage, onWebViewMessage]
  );
  const ttsMenuItems = useMemo(
    () => [
      {
        key: 'read-aloud',
        label: 'Read aloud',
        action: (cfiRange: string) => {
          onReadAloudFromSelection(cfiRange);
          return false;
        },
      },
    ],
    [onReadAloudFromSelection]
  );

  return (
    <>
      <View style={[styles.readerArea, { backgroundColor: activeTheme.colors.background }]}>
        <Reader
          src={fileUri}
          fileSystem={useLegacyFileSystem}
          width="100%"
          height="100%"
          initialLocation={initialCfi}
          defaultTheme={defaultTheme}
          manager="continuous"
          flow="scrolled-doc"
          keepScrollOffsetOnLocationChange
          injectedJavascript={injectedJavascript}
          menuItems={ttsMenuItems}
          onWebViewMessage={handleWebViewMessage}
          onLocationChange={onLocationChange}
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
    </>
  );
}

function TtsControlBar({
  themeId,
  loading,
  playing,
  loaded,
  speed,
  error,
  onPlayPause,
  onSeekBack,
  onSeekForward,
  onSpeedDown,
  onSpeedSelect,
  onSpeedUp,
}: {
  themeId: ReaderThemeId;
  loading: boolean;
  playing: boolean;
  loaded: boolean;
  speed: TtsSpeed;
  error: string | null;
  onPlayPause: () => void;
  onSeekBack: () => void;
  onSeekForward: () => void;
  onSpeedDown: () => void;
  onSpeedSelect: (speed: TtsSpeed) => void;
  onSpeedUp: () => void;
}) {
  const {
    noteMode,
    setNoteMode,
    hasSelection,
    selectedCount,
    lastPickedColor,
    saveNote,
    erase,
    clearSelection,
  } = useHighlightSelection();
  const activeTheme = READER_THEMES[themeId];
  const [draftColor, setDraftColor] = useState<HighlightColor>(lastPickedColor);
  const [noteDraft, setNoteDraft] = useState('');

  useEffect(() => {
    setDraftColor(lastPickedColor);
  }, [lastPickedColor]);

  useEffect(() => {
    if (hasSelection) return;
    setNoteDraft('');
  }, [hasSelection]);

  const saveDraft = useCallback(async () => {
    await saveNote(noteDraft, draftColor);
    setNoteDraft('');
  }, [draftColor, noteDraft, saveNote]);

  return (
    <View style={[styles.ttsBar, { backgroundColor: activeTheme.colors.background, borderTopColor: activeTheme.colors.border }]}>
      <View style={styles.ttsSpeedControls}>
        <Pressable accessibilityLabel="Decrease narration speed" hitSlop={8} onPress={onSpeedDown} style={styles.ttsSmallButton}>
          <Ionicons name="remove" size={18} color={activeTheme.colors.text} />
        </Pressable>
        {TTS_SPEEDS.map((speedOption) => {
          const selected = speedOption === speed;
          return (
            <Pressable
              key={speedOption}
              accessibilityLabel={`Set narration speed to ${formatTtsSpeed(speedOption)}`}
              hitSlop={6}
              onPress={() => onSpeedSelect(speedOption)}
              style={[
                styles.ttsSpeedOption,
                {
                  borderColor: selected ? activeTheme.colors.control : activeTheme.colors.border,
                  backgroundColor: selected ? activeTheme.colors.control : activeTheme.colors.background,
                },
              ]}
            >
              <Text style={[styles.ttsSpeedLabel, { color: selected ? activeTheme.colors.controlText : activeTheme.colors.text }]}>
                {formatTtsSpeed(speedOption)}
              </Text>
            </Pressable>
          );
        })}
        <Pressable
          accessibilityLabel="Increase narration speed"
          hitSlop={8}
          onPress={onSpeedUp}
          style={styles.ttsSmallButton}
        >
          <Ionicons name="add" size={18} color={activeTheme.colors.text} />
        </Pressable>
      </View>
      <View style={styles.ttsControlsRow}>
        <Pressable
          accessibilityLabel="Rewind 10 seconds"
          disabled={!loaded}
          hitSlop={8}
          onPress={onSeekBack}
          style={[styles.ttsButton, !loaded && styles.disabledControl]}
        >
          <Ionicons name="play-back" size={22} color={activeTheme.colors.text} />
        </Pressable>
        <Pressable
          accessibilityLabel={playing ? 'Pause narration' : 'Play narration'}
          disabled={loading}
          hitSlop={8}
          onPress={onPlayPause}
          style={[styles.ttsPlayButton, { backgroundColor: activeTheme.colors.control }]}
        >
          {loading ? (
            <ActivityIndicator color={activeTheme.colors.controlText} />
          ) : (
            <Ionicons name={playing ? 'pause' : 'play'} size={24} color={activeTheme.colors.controlText} />
          )}
        </Pressable>
        <Pressable
          accessibilityLabel="Forward 10 seconds"
          disabled={!loaded}
          hitSlop={8}
          onPress={onSeekForward}
          style={[styles.ttsButton, !loaded && styles.disabledControl]}
        >
          <Ionicons name="play-forward" size={22} color={activeTheme.colors.text} />
        </Pressable>
        <Pressable
          accessibilityLabel={noteMode ? 'Exit note mode' : 'Enter note mode'}
          hitSlop={8}
          onPress={() => setNoteMode(!noteMode)}
          style={[
            styles.ttsButton,
            noteMode && { backgroundColor: activeTheme.colors.pressed },
          ]}
        >
          <Ionicons name={noteMode ? 'create' : 'create-outline'} size={21} color={activeTheme.colors.text} />
        </Pressable>
      </View>

      {noteMode ? (
        <View style={styles.noteControls}>
          <View style={styles.swatchRow}>
            {(Object.keys(HIGHLIGHT_PALETTE) as HighlightColor[]).map((color) => {
              const selected = color === draftColor;
              return (
                <Pressable
                  key={color}
                  accessibilityLabel={`${HIGHLIGHT_PALETTE[color].label} highlight`}
                  disabled={!hasSelection}
                  hitSlop={6}
                  onPress={() => setDraftColor(color)}
                  style={[
                    styles.swatchButton,
                    {
                      borderColor: selected ? activeTheme.colors.text : activeTheme.colors.border,
                      opacity: hasSelection ? 1 : 0.35,
                    },
                  ]}
                >
                  <View
                    style={[
                      styles.swatch,
                      { backgroundColor: HIGHLIGHT_PALETTE[color].hex },
                    ]}
                  />
                </Pressable>
              );
            })}
          </View>

          <TextInput
            accessibilityLabel="Highlight note"
            editable={hasSelection}
            placeholder={hasSelection ? `${selectedCount} selected` : 'Select dots'}
            placeholderTextColor={activeTheme.colors.mutedText}
            value={noteDraft}
            onChangeText={setNoteDraft}
            numberOfLines={1}
            style={[
              styles.noteInput,
              {
                borderColor: activeTheme.colors.border,
                color: activeTheme.colors.text,
                backgroundColor: activeTheme.colors.background,
              },
              !hasSelection && styles.disabledControl,
            ]}
          />

          <Pressable
            accessibilityLabel="Erase highlight"
            disabled={!hasSelection}
            hitSlop={6}
            onPress={erase}
            style={({ pressed }) => [
              styles.noteActionButton,
              pressed && hasSelection && { backgroundColor: activeTheme.colors.pressed },
              !hasSelection && styles.disabledControl,
            ]}
          >
            <Ionicons name="trash-outline" size={16} color={activeTheme.colors.text} />
          </Pressable>

          <Pressable
            accessibilityLabel="Cancel selection"
            disabled={!hasSelection}
            hitSlop={6}
            onPress={clearSelection}
            style={({ pressed }) => [
              styles.noteActionButton,
              pressed && hasSelection && { backgroundColor: activeTheme.colors.pressed },
              !hasSelection && styles.disabledControl,
            ]}
          >
            <Ionicons name="close" size={17} color={activeTheme.colors.text} />
          </Pressable>

          <Pressable
            accessibilityLabel="Save note"
            disabled={!hasSelection}
            hitSlop={6}
            onPress={saveDraft}
            style={({ pressed }) => [
              styles.noteActionButton,
              { backgroundColor: hasSelection ? activeTheme.colors.pressed : 'transparent' },
              pressed && hasSelection && { backgroundColor: activeTheme.colors.pressed },
              !hasSelection && styles.disabledControl,
            ]}
          >
            <Ionicons name="checkmark" size={17} color={activeTheme.colors.text} />
          </Pressable>
        </View>
      ) : null}
      {error ? (
        <Text style={[styles.ttsError, { color: activeTheme.colors.mutedText }]} numberOfLines={2}>
          {error}
        </Text>
      ) : null}
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

    changeTheme(readerThemeForPreferences({ fontSize, themeId }));
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
  ttsBar: {
    minHeight: 94,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
    paddingVertical: 7,
    gap: 4,
  },
  ttsControlsRow: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  ttsSpeedControls: {
    minHeight: 34,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  ttsButton: {
    width: 42,
    height: 42,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  noteControls: {
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingBottom: 6,
  },
  swatchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  swatchButton: {
    width: 25,
    height: 28,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  swatch: {
    width: 15,
    height: 15,
    borderRadius: 8,
  },
  noteInput: {
    flex: 1,
    height: 30,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    paddingHorizontal: 8,
    fontSize: 13,
    fontWeight: '500',
  },
  noteActionButton: {
    width: 30,
    height: 30,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ttsSmallButton: {
    width: 32,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ttsPlayButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ttsSpeedOption: {
    minWidth: 48,
    height: 30,
    borderRadius: 15,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  ttsSpeedLabel: {
    minWidth: 34,
    textAlign: 'center',
    fontSize: 14,
    fontWeight: '700',
  },
  ttsError: {
    textAlign: 'center',
    fontSize: 12,
  },
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
