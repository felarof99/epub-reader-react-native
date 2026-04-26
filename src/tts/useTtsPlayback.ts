import { useAudioPlayer, useAudioPlayerStatus, setAudioModeAsync } from 'expo-audio';
import * as FileSystem from 'expo-file-system/legacy';
import { useCallback, useEffect, useRef } from 'react';

import type { TtsSpeed } from './types';

type LoadClipParams = {
  audioBase64: string;
  speed: TtsSpeed;
};

export function useTtsPlayback() {
  const player = useAudioPlayer(null, { updateInterval: 100 });
  const status = useAudioPlayerStatus(player);
  const currentUriRef = useRef<string | null>(null);

  useEffect(() => {
    setAudioModeAsync({ playsInSilentMode: true }).catch((error) => {
      console.warn('setAudioModeAsync failed', error);
    });
  }, []);

  const cleanupCurrentFile = useCallback(async () => {
    const uri = currentUriRef.current;
    currentUriRef.current = null;
    if (!uri) return;
    try {
      await FileSystem.deleteAsync(uri, { idempotent: true });
    } catch (error) {
      console.warn('ttsPlayback cleanup failed', error);
    }
  }, []);

  const loadAndPlay = useCallback(
    async ({ audioBase64, speed }: LoadClipParams) => {
      if (!FileSystem.cacheDirectory) throw new Error('Cache directory is unavailable.');

      await cleanupCurrentFile();
      const uri = `${FileSystem.cacheDirectory}tts-${Date.now()}.mp3`;
      await FileSystem.writeAsStringAsync(uri, audioBase64, {
        encoding: FileSystem.EncodingType.Base64,
      });

      currentUriRef.current = uri;
      player.replace(uri);
      player.setPlaybackRate(speed);
      player.play();
    },
    [cleanupCurrentFile, player]
  );

  const pause = useCallback(() => {
    player.pause();
  }, [player]);

  const resume = useCallback(() => {
    player.play();
  }, [player]);

  const stop = useCallback(async () => {
    player.pause();
    await player.seekTo(0);
    await cleanupCurrentFile();
  }, [cleanupCurrentFile, player]);

  const seekBy = useCallback(
    async (seconds: number) => {
      const requestedTime = Math.max(status.currentTime + seconds, 0);
      const nextTime =
        Number.isFinite(status.duration) && status.duration > 0
          ? Math.min(requestedTime, status.duration)
          : requestedTime;
      await player.seekTo(nextTime);
    },
    [player, status.currentTime, status.duration]
  );

  const setSpeed = useCallback(
    (speed: TtsSpeed) => {
      player.setPlaybackRate(speed);
    },
    [player]
  );

  useEffect(() => {
    return () => {
      player.pause();
      void cleanupCurrentFile();
    };
  }, [cleanupCurrentFile, player]);

  return {
    currentTime: status.currentTime,
    duration: status.duration,
    isLoaded: status.isLoaded,
    isPlaying: status.playing,
    loadAndPlay,
    pause,
    resume,
    seekBy,
    setSpeed,
    stop,
  };
}
