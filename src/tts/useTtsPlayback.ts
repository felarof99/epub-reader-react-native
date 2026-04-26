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
  const loadTokenRef = useRef(0);
  const pendingDeleteUrisRef = useRef<Set<string>>(new Set());
  const seekTimeRef = useRef(0);

  useEffect(() => {
    setAudioModeAsync({ playsInSilentMode: true }).catch((error) => {
      console.warn('setAudioModeAsync failed', error);
    });
  }, []);

  useEffect(() => {
    seekTimeRef.current = status.currentTime;
  }, [status.currentTime]);

  const deleteTempFile = useCallback(async (uri: string) => {
    try {
      await FileSystem.deleteAsync(uri, { idempotent: true });
      pendingDeleteUrisRef.current.delete(uri);
    } catch (error) {
      pendingDeleteUrisRef.current.add(uri);
      console.warn('ttsPlayback cleanup failed', error);
    }
  }, []);

  const cleanupPendingDeletes = useCallback(
    async (excludeUri?: string) => {
      const uris = [...pendingDeleteUrisRef.current].filter((uri) => uri !== excludeUri);
      await Promise.all(uris.map((uri) => deleteTempFile(uri)));
    },
    [deleteTempFile]
  );

  const unloadAndCleanupCurrentFile = useCallback(async () => {
    const uri = currentUriRef.current;
    if (!uri) return;

    player.pause();
    player.replace(null);
    currentUriRef.current = null;
    await deleteTempFile(uri);
  }, [deleteTempFile, player]);

  const loadAndPlay = useCallback(
    async ({ audioBase64, speed }: LoadClipParams) => {
      if (!FileSystem.cacheDirectory) throw new Error('Cache directory is unavailable.');

      const loadToken = loadTokenRef.current + 1;
      loadTokenRef.current = loadToken;

      const uri = `${FileSystem.cacheDirectory}tts-${Date.now()}-${loadToken}.mp3`;
      await FileSystem.writeAsStringAsync(uri, audioBase64, {
        encoding: FileSystem.EncodingType.Base64,
      });

      if (loadTokenRef.current !== loadToken) {
        await deleteTempFile(uri);
        return;
      }

      const previousUri = currentUriRef.current;

      try {
        player.replace(uri);
        player.setPlaybackRate(speed);
        player.play();
      } catch (error) {
        if (loadTokenRef.current === loadToken) {
          player.pause();
          player.replace(previousUri);
        }
        await deleteTempFile(uri);
        throw error;
      }

      currentUriRef.current = uri;
      seekTimeRef.current = 0;

      if (previousUri) {
        await deleteTempFile(previousUri);
      }
      await cleanupPendingDeletes(uri);
    },
    [cleanupPendingDeletes, deleteTempFile, player]
  );

  const pause = useCallback(() => {
    player.pause();
  }, [player]);

  const resume = useCallback(() => {
    if (currentUriRef.current) {
      player.play();
    }
  }, [player]);

  const stop = useCallback(async () => {
    loadTokenRef.current += 1;
    player.pause();
    try {
      await player.seekTo(0);
    } finally {
      seekTimeRef.current = 0;
      await unloadAndCleanupCurrentFile();
    }
  }, [player, unloadAndCleanupCurrentFile]);

  const seekBy = useCallback(
    async (seconds: number) => {
      const requestedTime = Math.max(seekTimeRef.current + seconds, 0);
      const nextTime =
        Number.isFinite(status.duration) && status.duration > 0
          ? Math.min(requestedTime, status.duration)
          : requestedTime;
      seekTimeRef.current = nextTime;
      try {
        await player.seekTo(nextTime);
      } catch (error) {
        seekTimeRef.current = status.currentTime;
        throw error;
      }
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
      loadTokenRef.current += 1;
      void unloadAndCleanupCurrentFile();
    };
  }, [unloadAndCleanupCurrentFile]);

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
