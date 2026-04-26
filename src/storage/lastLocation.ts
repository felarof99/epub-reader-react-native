import AsyncStorage from '@react-native-async-storage/async-storage';

const keyFor = (bookId: string) => `lastLocation:${bookId}`;

export async function get(bookId: string): Promise<string | undefined> {
  try {
    const value = await AsyncStorage.getItem(keyFor(bookId));
    return value ?? undefined;
  } catch (error) {
    console.warn('lastLocation.get failed', error);
    return undefined;
  }
}

export async function save(bookId: string, cfi: string): Promise<void> {
  try {
    await AsyncStorage.setItem(keyFor(bookId), cfi);
  } catch (error) {
    console.warn('lastLocation.save failed', error);
  }
}

export async function clear(bookId: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(keyFor(bookId));
  } catch (error) {
    console.warn('lastLocation.clear failed', error);
  }
}

const PROGRESS_KEY = 'lastProgress';
type ProgressMap = Record<string, { label: string; percentage: number }>;

export async function getProgress(bookId: string): Promise<{ label: string; percentage: number } | undefined> {
  try {
    const raw = await AsyncStorage.getItem(PROGRESS_KEY);
    if (!raw) return undefined;
    const map = JSON.parse(raw) as ProgressMap;
    return map[bookId];
  } catch (error) {
    console.warn('lastLocation.getProgress failed', error);
    return undefined;
  }
}

export async function saveProgress(bookId: string, label: string, percentage: number): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(PROGRESS_KEY);
    const map: ProgressMap = raw ? JSON.parse(raw) : {};
    map[bookId] = { label, percentage };
    await AsyncStorage.setItem(PROGRESS_KEY, JSON.stringify(map));
  } catch (error) {
    console.warn('lastLocation.saveProgress failed', error);
  }
}

export async function clearProgress(bookId: string): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(PROGRESS_KEY);
    if (!raw) return;
    const map = JSON.parse(raw) as ProgressMap;
    delete map[bookId];
    await AsyncStorage.setItem(PROGRESS_KEY, JSON.stringify(map));
  } catch (error) {
    console.warn('lastLocation.clearProgress failed', error);
  }
}
