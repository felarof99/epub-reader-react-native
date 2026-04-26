import AsyncStorage from '@react-native-async-storage/async-storage';

import * as highlights from '../highlights/highlights';

const LIBRARY_KEY = 'library';

export type BookRecord = {
  id: string;
  title: string;
  fileName: string;
  dateAdded: number;
};

async function readAll(): Promise<BookRecord[]> {
  try {
    const raw = await AsyncStorage.getItem(LIBRARY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as BookRecord[]) : [];
  } catch (error) {
    console.warn('library.readAll failed', error);
    return [];
  }
}

async function writeAll(records: BookRecord[]): Promise<void> {
  await AsyncStorage.setItem(LIBRARY_KEY, JSON.stringify(records));
}

export async function list(): Promise<BookRecord[]> {
  const records = await readAll();
  return records.sort((a, b) => b.dateAdded - a.dateAdded);
}

export async function add(record: BookRecord): Promise<void> {
  const records = await readAll();
  records.push(record);
  await writeAll(records);
}

export async function remove(id: string): Promise<void> {
  const records = await readAll();
  const next = records.filter((record) => record.id !== id);
  await writeAll(next);
  await highlights.clearForBook(id);
}

export async function getById(id: string): Promise<BookRecord | undefined> {
  const records = await readAll();
  return records.find((record) => record.id === id);
}
