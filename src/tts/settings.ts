import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

import { normalizeTtsSpeed } from './timing';
import type { TtsSettings, TtsSpeed, TtsVoiceSelection } from './types';

const API_KEY_KEY = 'elevenLabsApiKey';
const SETTINGS_KEY = 'ttsSettings';

const DEFAULT_SETTINGS: TtsSettings = {
  speed: 1,
};

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
  }
}

export async function getSettings(): Promise<TtsSettings> {
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

export async function saveSelectedVoice(selectedVoice: TtsVoiceSelection): Promise<TtsSettings> {
  const next = normalizeSettings({
    ...(await getSettings()),
    selectedVoice,
  });
  await saveSettings(next);
  return next;
}

export async function saveSpeed(speed: TtsSpeed): Promise<TtsSettings> {
  const next = normalizeSettings({
    ...(await getSettings()),
    speed,
  });
  await saveSettings(next);
  return next;
}

async function saveSettings(settings: TtsSettings): Promise<void> {
  try {
    await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(normalizeSettings(settings)));
  } catch (error) {
    console.warn('ttsSettings.saveSettings failed', error);
  }
}

function normalizeSettings(settings: Partial<TtsSettings>): TtsSettings {
  const selectedVoice = settings.selectedVoice?.voiceId && settings.selectedVoice.voiceName
    ? settings.selectedVoice
    : undefined;

  return {
    selectedVoice,
    speed: normalizeTtsSpeed(settings.speed),
  };
}
