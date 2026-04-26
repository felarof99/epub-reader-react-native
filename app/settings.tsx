import { Ionicons } from '@expo/vector-icons';
import { Stack } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { fetchVoices, generateSpeech } from '../src/tts/elevenLabs';
import * as ttsSettings from '../src/tts/settings';
import type { ElevenLabsVoice, TtsSettings } from '../src/tts/types';
import { useTtsPlayback } from '../src/tts/useTtsPlayback';

const SAMPLE_PREVIEW_TEXT = 'This is a short preview of this ElevenLabs voice.';
const DEFAULT_TTS_SETTINGS: TtsSettings = { speed: 1 };

export default function SettingsScreen() {
  const [apiKey, setApiKey] = useState('');
  const [settings, setSettings] = useState<TtsSettings>(DEFAULT_TTS_SETTINGS);
  const [voices, setVoices] = useState<ElevenLabsVoice[]>([]);
  const [initialLoading, setInitialLoading] = useState(true);
  const [voiceLoading, setVoiceLoading] = useState(false);
  const [previewLoadingVoiceId, setPreviewLoadingVoiceId] = useState<string | null>(null);
  const [previewVoiceId, setPreviewVoiceId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { isPlaying, loadAndPlay, stop } = useTtsPlayback();

  useEffect(() => {
    let cancelled = false;
    Promise.all([ttsSettings.getApiKey(), ttsSettings.getSettings()])
      .then(([savedApiKey, savedSettings]) => {
        if (cancelled) return;
        setApiKey(savedApiKey);
        setSettings(savedSettings);
      })
      .catch((loadError) => {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : 'Could not load settings.');
      })
      .finally(() => {
        if (!cancelled) setInitialLoading(false);
      });
    return () => {
      cancelled = true;
      void stop().catch((stopError) => {
        console.warn('Settings preview cleanup failed', stopError);
      });
    };
  }, [stop]);

  const handleApiKeyChange = useCallback((nextApiKey: string) => {
    setApiKey(nextApiKey);
    void ttsSettings.saveApiKey(nextApiKey).catch((saveError) => {
      setError(saveError instanceof Error ? saveError.message : 'Could not save API key.');
    });
  }, []);

  const loadVoices = useCallback(async () => {
    const trimmedApiKey = apiKey.trim();
    if (!trimmedApiKey) {
      setError('Enter your ElevenLabs API key first.');
      return;
    }
    setVoiceLoading(true);
    setError(null);
    try {
      setVoices(await fetchVoices(trimmedApiKey));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load voices.');
    } finally {
      setVoiceLoading(false);
    }
  }, [apiKey]);

  const selectVoice = useCallback(async (voice: ElevenLabsVoice) => {
    try {
      const nextSettings = await ttsSettings.saveSelectedVoice({
        voiceId: voice.voice_id,
        voiceName: voice.name,
      });
      setSettings(nextSettings);
      setError(null);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save selected voice.');
    }
  }, []);

  const previewVoice = useCallback(async (voice: ElevenLabsVoice) => {
    if (previewVoiceId === voice.voice_id && isPlaying) {
      try {
        await stop();
        setPreviewVoiceId(null);
        setError(null);
      } catch (stopError) {
        setError(stopError instanceof Error ? stopError.message : 'Could not stop voice preview.');
      }
      return;
    }
    const trimmedApiKey = apiKey.trim();
    if (!trimmedApiKey) {
      setError('Enter your ElevenLabs API key first.');
      return;
    }

    setPreviewLoadingVoiceId(voice.voice_id);
    setPreviewVoiceId(null);
    setError(null);
    try {
      const speech = await generateSpeech({
        apiKey: trimmedApiKey,
        voiceId: voice.voice_id,
        text: SAMPLE_PREVIEW_TEXT,
      });
      await loadAndPlay({ audioBase64: speech.audio_base64, speed: settings.speed });
      setPreviewVoiceId(voice.voice_id);
    } catch (previewError) {
      setError(previewError instanceof Error ? previewError.message : 'Could not play voice preview.');
    } finally {
      setPreviewLoadingVoiceId(null);
    }
  }, [apiKey, isPlaying, loadAndPlay, previewVoiceId, settings.speed, stop]);

  const selectedVoiceId = settings.selectedVoice?.voiceId;
  const selectedVoiceName = settings.selectedVoice?.voiceName;

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <Stack.Screen options={{ title: 'Settings' }} />
      {initialLoading ? (
        <View style={styles.center}>
          <ActivityIndicator />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>ElevenLabs</Text>
            <TextInput
              value={apiKey}
              onChangeText={handleApiKeyChange}
              placeholder="ElevenLabs API key"
              placeholderTextColor="#888"
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              style={styles.apiKeyInput}
            />
            <TouchableOpacity
              onPress={loadVoices}
              disabled={voiceLoading || !apiKey.trim()}
              style={[styles.primaryButton, (voiceLoading || !apiKey.trim()) && styles.disabledControl]}
            >
              {voiceLoading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.primaryButtonText}>Load voices</Text>
              )}
            </TouchableOpacity>
            {selectedVoiceName ? (
              <Text style={styles.selectedVoiceText}>Selected: {selectedVoiceName}</Text>
            ) : null}
            {error ? <Text style={styles.errorText}>{error}</Text> : null}
          </View>

          <View style={styles.voiceList}>
            {voices.map((voice) => (
              <VoiceRow
                key={voice.voice_id}
                voice={voice}
                selected={voice.voice_id === selectedVoiceId}
                previewing={isPlaying && previewVoiceId === voice.voice_id}
                previewLoading={previewLoadingVoiceId === voice.voice_id}
                onPreview={() => void previewVoice(voice)}
                onSelect={() => void selectVoice(voice)}
              />
            ))}
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function VoiceRow({
  voice,
  selected,
  previewing,
  previewLoading,
  onPreview,
  onSelect,
}: {
  voice: ElevenLabsVoice;
  selected: boolean;
  previewing: boolean;
  previewLoading: boolean;
  onPreview: () => void;
  onSelect: () => void;
}) {
  return (
    <View style={[styles.voiceRow, selected && styles.voiceRowSelected]}>
      <TouchableOpacity onPress={onSelect} style={styles.voiceInfo} accessibilityRole="button">
        <Text style={styles.voiceName}>{voice.name}</Text>
        {selected ? <Text style={styles.voiceStatus}>Selected</Text> : null}
      </TouchableOpacity>
      <Pressable
        accessibilityLabel={`Preview ${voice.name}`}
        disabled={previewLoading}
        hitSlop={8}
        onPress={onPreview}
        style={[styles.previewButton, previewLoading && styles.disabledControl]}
      >
        {previewLoading ? (
          <ActivityIndicator size="small" color="#111" />
        ) : (
          <Ionicons name={previewing ? 'stop' : 'play'} size={18} color="#111" />
        )}
      </Pressable>
      {selected ? <Ionicons name="checkmark" size={21} color="#111" /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  content: { padding: 20, gap: 24 },
  section: { gap: 12 },
  sectionLabel: { fontSize: 13, fontWeight: '700', color: '#666', letterSpacing: 0, textTransform: 'uppercase' },
  apiKeyInput: {
    minHeight: 46,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#d8d8d8',
    borderRadius: 8,
    paddingHorizontal: 12,
    fontSize: 15,
    color: '#111',
  },
  primaryButton: {
    alignSelf: 'flex-start',
    minHeight: 42,
    borderRadius: 8,
    backgroundColor: '#111',
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  selectedVoiceText: { fontSize: 13, color: '#666' },
  errorText: { fontSize: 13, color: '#666' },
  voiceList: { gap: 8 },
  voiceRow: {
    minHeight: 56,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#d8d8d8',
    borderRadius: 8,
    paddingLeft: 12,
    paddingRight: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  voiceRowSelected: { borderColor: '#111' },
  voiceInfo: { flex: 1, minHeight: 54, justifyContent: 'center' },
  voiceName: { fontSize: 15, fontWeight: '600', color: '#111' },
  voiceStatus: { marginTop: 2, fontSize: 12, color: '#666' },
  previewButton: {
    width: 36,
    height: 36,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f2f2f2',
  },
  disabledControl: { opacity: 0.35 },
});
