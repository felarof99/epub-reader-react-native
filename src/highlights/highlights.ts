import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';

const STORAGE_PREFIX = 'highlights:';

export const HIGHLIGHT_PALETTE = {
  cyan: { hex: '#4cc9d6', label: 'Cyan' },
  green: { hex: '#5fd991', label: 'Green' },
  yellow: { hex: '#ffd84d', label: 'Yellow' },
  red: { hex: '#ff7a7a', label: 'Red' },
} as const;

export type HighlightColor = keyof typeof HIGHLIGHT_PALETTE;

export type HighlightChunk = {
  id: string;
  cfiRange?: string;
  text: string;
  order: number;
};

export type Highlight = {
  id: string;
  cfiRange: string;
  color: HighlightColor;
  note?: string;
  text?: string;
  sentenceIds?: string[];
  chunks?: HighlightChunk[];
  createdAt: number;
  updatedAt: number;
};

export type HighlightInput = {
  cfiRange: string;
  color: HighlightColor;
  note?: string;
  text?: string;
  sentenceIds?: string[];
  chunks?: HighlightChunk[];
};

const highlightColors = new Set<HighlightColor>(Object.keys(HIGHLIGHT_PALETTE) as HighlightColor[]);

function storageKey(bookId: string): string {
  return `${STORAGE_PREFIX}${bookId}`;
}

function isHighlightColor(value: unknown): value is HighlightColor {
  return typeof value === 'string' && highlightColors.has(value as HighlightColor);
}

function normalizeHighlight(value: unknown): Highlight | null {
  if (!value || typeof value !== 'object') return null;

  const candidate = value as Partial<Highlight>;
  if (
    typeof candidate.id !== 'string' ||
    typeof candidate.cfiRange !== 'string' ||
    !isHighlightColor(candidate.color)
  ) {
    return null;
  }

  return {
    id: candidate.id,
    cfiRange: candidate.cfiRange,
    color: candidate.color,
    note: typeof candidate.note === 'string' ? candidate.note : undefined,
    text: typeof candidate.text === 'string' ? candidate.text : undefined,
    sentenceIds: Array.isArray(candidate.sentenceIds)
      ? candidate.sentenceIds.filter((id): id is string => typeof id === 'string')
      : undefined,
    chunks: Array.isArray(candidate.chunks)
      ? candidate.chunks
          .map((chunk) => normalizeChunk(chunk))
          .filter((chunk): chunk is HighlightChunk => chunk !== null)
      : undefined,
    createdAt: typeof candidate.createdAt === 'number' ? candidate.createdAt : Date.now(),
    updatedAt: typeof candidate.updatedAt === 'number' ? candidate.updatedAt : Date.now(),
  };
}

function normalizeChunk(value: unknown): HighlightChunk | null {
  if (!value || typeof value !== 'object') return null;

  const candidate = value as Partial<HighlightChunk>;
  if (typeof candidate.id !== 'string' || typeof candidate.text !== 'string') return null;

  return {
    id: candidate.id,
    cfiRange: typeof candidate.cfiRange === 'string' ? candidate.cfiRange : undefined,
    text: candidate.text,
    order: typeof candidate.order === 'number' ? candidate.order : 0,
  };
}

async function readAll(bookId: string): Promise<Highlight[]> {
  try {
    const raw = await AsyncStorage.getItem(storageKey(bookId));
    if (!raw) return [];

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .map((item) => normalizeHighlight(item))
      .filter((item): item is Highlight => item !== null)
      .sort((a, b) => a.createdAt - b.createdAt);
  } catch (error) {
    console.warn('highlights.readAll failed', error);
    return [];
  }
}

async function writeAll(bookId: string, records: Highlight[]): Promise<void> {
  await AsyncStorage.setItem(storageKey(bookId), JSON.stringify(records));
}

export async function list(bookId: string): Promise<Highlight[]> {
  return readAll(bookId);
}

export async function add(bookId: string, input: HighlightInput): Promise<Highlight> {
  const now = Date.now();
  const record: Highlight = {
    id: Crypto.randomUUID(),
    cfiRange: input.cfiRange,
    color: input.color,
    note: input.note,
    text: input.text,
    sentenceIds: input.sentenceIds,
    chunks: input.chunks,
    createdAt: now,
    updatedAt: now,
  };

  try {
    const records = await readAll(bookId);
    await writeAll(bookId, [...records, record]);
  } catch (error) {
    console.warn('highlights.add failed', error);
  }

  return record;
}

export async function update(
  bookId: string,
  id: string,
  patch: Partial<Pick<Highlight, 'color' | 'note' | 'text' | 'sentenceIds' | 'chunks'>>
): Promise<void> {
  try {
    const records = await readAll(bookId);
    const now = Date.now();
    await writeAll(
      bookId,
      records.map((record) =>
        record.id === id
          ? {
              ...record,
              ...patch,
              updatedAt: now,
            }
          : record
      )
    );
  } catch (error) {
    console.warn('highlights.update failed', error);
  }
}

export async function remove(bookId: string, id: string): Promise<void> {
  try {
    const records = await readAll(bookId);
    await writeAll(
      bookId,
      records.filter((record) => record.id !== id)
    );
  } catch (error) {
    console.warn('highlights.remove failed', error);
  }
}

export async function clearForBook(bookId: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(storageKey(bookId));
  } catch (error) {
    console.warn('highlights.clearForBook failed', error);
  }
}
