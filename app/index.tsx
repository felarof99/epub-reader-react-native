import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter, Stack } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Swipeable, GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaView } from 'react-native-safe-area-context';

import * as library from '../src/books/library';
import type { BookRecord } from '../src/books/library';
import { deleteBookFile, importBook } from '../src/books/import';
import * as lastLocation from '../src/storage/lastLocation';

type Row = {
  record: BookRecord;
  progress?: { label: string; percentage: number };
};

export default function LibraryScreen() {
  const router = useRouter();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [importing, setImporting] = useState(false);

  const refresh = useCallback(async () => {
    const records = await library.list();
    const enriched: Row[] = await Promise.all(
      records.map(async (record) => ({
        record,
        progress: await lastLocation.getProgress(record.id),
      }))
    );
    setRows(enriched);
  }, []);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh])
  );

  const handleImport = useCallback(async () => {
    if (importing) return;
    setImporting(true);
    try {
      const record = await importBook();
      if (record) {
        await refresh();
      }
    } catch (error) {
      console.warn('importBook failed', error);
      Alert.alert('Couldn’t import book', 'Please try a different EPUB file.');
    } finally {
      setImporting(false);
    }
  }, [importing, refresh]);

  const handleDelete = useCallback(
    async (record: BookRecord) => {
      await deleteBookFile(record);
      await library.remove(record.id);
      await lastLocation.clear(record.id);
      await lastLocation.clearProgress(record.id);
      await refresh();
    },
    [refresh]
  );

  const openBook = useCallback(
    (id: string) => {
      router.push({ pathname: '/reader', params: { bookId: id } });
    },
    [router]
  );

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <Stack.Screen
        options={{
          title: 'Library',
          headerRight: () => (
            <TouchableOpacity
              onPress={handleImport}
              disabled={importing}
              style={styles.headerButton}
              accessibilityLabel="Import EPUB"
            >
              {importing ? (
                <ActivityIndicator size="small" />
              ) : (
                <Ionicons name="add" size={26} color="#111" />
              )}
            </TouchableOpacity>
          ),
        }}
      />
      {rows === null ? (
        <View style={styles.center}>
          <ActivityIndicator />
        </View>
      ) : rows.length === 0 ? (
        <EmptyState onImport={handleImport} importing={importing} />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(row) => row.record.id}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => (
            <BookRow row={item} onPress={() => openBook(item.record.id)} onDelete={handleDelete} />
          )}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
        />
      )}
    </SafeAreaView>
  );
}

function BookRow({
  row,
  onPress,
  onDelete,
}: {
  row: Row;
  onPress: () => void;
  onDelete: (record: BookRecord) => void;
}) {
  const subtitle = row.progress
    ? `Last read: ${row.progress.label} · ${Math.round(row.progress.percentage * 100)}%`
    : 'Not started';

  return (
    <GestureHandlerRootView>
      <Swipeable
        renderRightActions={() => (
          <Pressable
            style={styles.deleteAction}
            onPress={() => {
              Alert.alert('Delete book', `Remove “${row.record.title}” from your library?`, [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Delete', style: 'destructive', onPress: () => onDelete(row.record) },
              ]);
            }}
          >
            <Ionicons name="trash" size={20} color="#fff" />
            <Text style={styles.deleteText}>Delete</Text>
          </Pressable>
        )}
      >
        <Pressable onPress={onPress} style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}>
          <Text style={styles.rowTitle} numberOfLines={2}>
            {row.record.title}
          </Text>
          <Text style={styles.rowSubtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        </Pressable>
      </Swipeable>
    </GestureHandlerRootView>
  );
}

function EmptyState({ onImport, importing }: { onImport: () => void; importing: boolean }) {
  return (
    <View style={styles.center}>
      <Ionicons name="book-outline" size={64} color="#999" />
      <Text style={styles.emptyTitle}>No books yet</Text>
      <Text style={styles.emptySubtitle}>Import an EPUB to start reading.</Text>
      <TouchableOpacity style={styles.emptyButton} onPress={onImport} disabled={importing}>
        {importing ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.emptyButtonText}>Import EPUB</Text>
        )}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  headerButton: { paddingHorizontal: 8, paddingVertical: 4 },
  listContent: { paddingVertical: 4 },
  row: { paddingHorizontal: 20, paddingVertical: 16, backgroundColor: '#fff' },
  rowPressed: { backgroundColor: '#f3f3f3' },
  rowTitle: { fontSize: 17, fontWeight: '600', color: '#111' },
  rowSubtitle: { fontSize: 13, color: '#888', marginTop: 4 },
  separator: { height: StyleSheet.hairlineWidth, backgroundColor: '#e5e5e5', marginLeft: 20 },
  deleteAction: {
    width: 96,
    backgroundColor: '#e53935',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'column',
    gap: 4,
  },
  deleteText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  emptyTitle: { fontSize: 20, fontWeight: '600', color: '#222' },
  emptySubtitle: { fontSize: 14, color: '#777', textAlign: 'center' },
  emptyButton: {
    marginTop: 8,
    backgroundColor: '#111',
    paddingHorizontal: 28,
    paddingVertical: 12,
    borderRadius: 999,
    minWidth: 160,
    alignItems: 'center',
  },
  emptyButtonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
