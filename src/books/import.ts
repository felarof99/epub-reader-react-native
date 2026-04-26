import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as Crypto from 'expo-crypto';

import * as library from './library';
import type { BookRecord } from './library';

const BOOKS_DIR = `${FileSystem.documentDirectory}books/`;

function sanitizeTitle(filename: string): string {
  const withoutExt = filename.replace(/\.epub$/i, '');
  const lastSlash = Math.max(withoutExt.lastIndexOf('/'), withoutExt.lastIndexOf('\\'));
  const base = lastSlash >= 0 ? withoutExt.slice(lastSlash + 1) : withoutExt;
  return base.trim() || 'Untitled';
}

export function bookFileUri(record: BookRecord): string {
  return `${BOOKS_DIR}${record.fileName}`;
}

export async function importBook(): Promise<BookRecord | null> {
  const picked = await DocumentPicker.getDocumentAsync({
    type: ['application/epub+zip', 'application/zip', '*/*'],
    copyToCacheDirectory: true,
    multiple: false,
  });

  if (picked.canceled || !picked.assets || picked.assets.length === 0) {
    return null;
  }

  const asset = picked.assets[0];
  const id = Crypto.randomUUID();
  const fileName = `${id}.epub`;
  const destination = `${BOOKS_DIR}${fileName}`;

  await FileSystem.makeDirectoryAsync(BOOKS_DIR, { intermediates: true });
  await FileSystem.copyAsync({ from: asset.uri, to: destination });

  const record: BookRecord = {
    id,
    title: sanitizeTitle(asset.name ?? 'Untitled'),
    fileName,
    dateAdded: Date.now(),
  };

  await library.add(record);
  return record;
}

export async function deleteBookFile(record: BookRecord): Promise<void> {
  const path = bookFileUri(record);
  try {
    await FileSystem.deleteAsync(path, { idempotent: true });
  } catch (error) {
    console.warn('deleteBookFile failed', error);
  }
}
