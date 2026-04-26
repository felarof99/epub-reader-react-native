import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

import { normalizeTtsSpeed } from './timing';
import type { TtsSettings, TtsSpeed, TtsVoiceSelection } from './types';

const API_KEY_KEY = 'elevenLabsApiKey';
const SETTINGS_KEY = 'ttsSettings';

const DEFAULT_SETTINGS: TtsSettings = {
  speed: 1,
};

let settingsWriteQueue: Promise<void> = Promise.resolve();

export async function getApiKey(): Promise<string> {
  try {
    return (await SecureStore.getItemAsync(API_KEY_KEY)) ?? '';
  } catch (error) {
    console.warn('ttsSettings.getApiKey failed', error);
    return '';
  }
}

export async function saveApiKey(apiKey: string): Promise<void> {
  try {
    const trimmed = apiKey.trim();
    if (trimmed) {
      await SecureStore.setItemAsync(API_KEY_KEY, trimmed);
    } else {
      await SecureStore.deleteItemAsync(API_KEY_KEY);
    }
  } catch (error) {
    console.warn('ttsSettings.saveApiKey failed', error);
    throw error;
  }
}

export async function getSettings(): Promise<TtsSettings> {
  return readSettings();
}

export function saveSelectedVoice(selectedVoice: TtsVoiceSelection): Promise<TtsSettings> {
  return enqueueSettingsUpdate((settings) => ({
    ...settings,
    selectedVoice,
  }));
}

export function saveSpeed(speed: TtsSpeed): Promise<TtsSettings> {
  return enqueueSettingsUpdate((settings) => ({
    ...settings,
    speed,
  }));
}

function enqueueSettingsUpdate(update: (settings: TtsSettings) => Partial<TtsSettings>): Promise<TtsSettings> {
  let nextSettings: TtsSettings | undefined;

  const operation = settingsWriteQueue.then(async () => {
    nextSettings = normalizeSettings(update(await readSettings()));
    await saveSettings(nextSettings);
  });

  settingsWriteQueue = operation.catch(() => undefined);

  return operation.then(() => {
    if (!nextSettings) {
      throw new Error('TTS settings update failed before settings were produced.');
    }
    return nextSettings;
  });
}

async function readSettings(): Promise<TtsSettings> {
  try {
    const raw = await AsyncStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;

    const parsed = JSON.parse(raw) as Partial<TtsSettings>;
    return normalizeSettings(parsed);
  } catch (error) {
    console.warn('ttsSettings.getSettings failed', error);
    return DEFAULT_SETTINGS;
  }
}

async function saveSettings(settings: TtsSettings): Promise<void> {
  try {
    await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(normalizeSettings(settings)));
  } catch (error) {
    console.warn('ttsSettings.saveSettings failed', error);
    throw error;
  }
}

function normalizeSettings(settings: Partial<TtsSettings>): TtsSettings {
  return {
    selectedVoice: normalizeSelectedVoice(settings.selectedVoice),
    speed: normalizeTtsSpeed(settings.speed),
  };
}

function normalizeSelectedVoice(value: unknown): TtsVoiceSelection | undefined {
  if (!value || typeof value !== 'object') return undefined;

  const selectedVoice = value as Partial<Record<keyof TtsVoiceSelection, unknown>>;
  if (typeof selectedVoice.voiceId !== 'string' || typeof selectedVoice.voiceName !== 'string') {
    return undefined;
  }

  const voiceId = selectedVoice.voiceId.trim();
  const voiceName = selectedVoice.voiceName.trim();

  return voiceId && voiceName ? { voiceId, voiceName } : undefined;
}
