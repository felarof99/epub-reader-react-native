import { Reader, useReader } from '@epubjs-react-native/core';
import type { Location, Section } from '@epubjs-react-native/core';
import { useFileSystem } from '@epubjs-react-native/expo-file-system';
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
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import * as library from '../src/books/library';
import type { BookRecord } from '../src/books/library';
import { bookFileUri } from '../src/books/import';
import * as lastLocation from '../src/storage/lastLocation';

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
  const { width, height } = useWindowDimensions();
  const [tocVisible, setTocVisible] = useState(false);
  const [chapterLabel, setChapterLabel] = useState<string>(book.title);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
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

  return (
    <View style={styles.container}>
      <Stack.Screen
        options={{
          title: chapterLabel,
          headerTitleStyle: { fontSize: 15 },
          headerRight: () => (
            <TouchableOpacity
              onPress={() => setTocVisible(true)}
              style={styles.headerButton}
              accessibilityLabel="Chapters"
            >
              <Ionicons name="list" size={24} color="#111" />
            </TouchableOpacity>
          ),
        }}
      />
      <Reader
        src={fileUri}
        fileSystem={useFileSystem}
        width={width}
        height={height - 100}
        initialLocation={initialCfi}
        onLocationChange={handleLocationChange}
        onDisplayError={(message: string) => onError(message || 'Unknown error')}
        renderLoadingFileComponent={() => (
          <View style={styles.center}>
            <ActivityIndicator />
          </View>
        )}
        renderOpeningBookComponent={() => (
          <View style={styles.center}>
            <ActivityIndicator />
          </View>
        )}
      />
      <TocModal visible={tocVisible} onClose={() => setTocVisible(false)} />
    </View>
  );
}

type TocItem = {
  label: string;
  href: string;
  subitems?: TocItem[];
};

function TocModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { toc, goToLocation } = useReader();
  const items = flattenToc((toc as TocItem[] | undefined) ?? []);

  return (
    <Modal animationType="slide" presentationStyle="pageSheet" visible={visible} onRequestClose={onClose}>
      <SafeAreaView style={styles.modalContainer} edges={['top', 'bottom']}>
        <View style={styles.modalHeader}>
          <Text style={styles.modalTitle}>Chapters</Text>
          <TouchableOpacity onPress={onClose} style={styles.headerButton} accessibilityLabel="Close">
            <Ionicons name="close" size={24} color="#111" />
          </TouchableOpacity>
        </View>
        {items.length === 0 ? (
          <View style={styles.center}>
            <Text style={styles.modalEmpty}>No chapters available</Text>
          </View>
        ) : (
          <FlatList
            data={items}
            keyExtractor={(item, index) => `${item.href}-${index}`}
            renderItem={({ item }) => (
              <Pressable
                style={({ pressed }) => [
                  styles.tocRow,
                  { paddingLeft: 20 + item.depth * 16 },
                  pressed && styles.tocRowPressed,
                ]}
                onPress={() => {
                  goToLocation(item.href);
                  onClose();
                }}
              >
                <Text style={styles.tocLabel} numberOfLines={2}>
                  {item.label}
                </Text>
              </Pressable>
            )}
            ItemSeparatorComponent={() => <View style={styles.tocSeparator} />}
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
  tocRow: { paddingVertical: 14, paddingRight: 20, backgroundColor: '#fff' },
  tocRowPressed: { backgroundColor: '#f3f3f3' },
  tocLabel: { fontSize: 15, color: '#222' },
  tocSeparator: { height: StyleSheet.hairlineWidth, backgroundColor: '#eee', marginLeft: 20 },
});
