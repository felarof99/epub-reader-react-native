import { useAudioPlayer, useAudioPlayerStatus, setAudioModeAsync } from 'expo-audio';
import * as FileSystem from 'expo-file-system/legacy';
import { useCallback, useEffect, useRef } from 'react';

import type { TtsSpeed } from './types';

type LoadClipParams = {
  audioBase64: string;
  speed: TtsSpeed;
};

function isReleasedPlayerError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes('NativeSharedObjectNotFoundException') ||
    message.includes('Unable to find the native shared object')
  );
}

function warnUnlessReleasedPlayer(label: string, error: unknown): void {
  if (!isReleasedPlayerError(error)) {
    console.warn(label, error);
  }
}

export function useTtsPlayback() {
  const player = useAudioPlayer(null, { updateInterval: 100 });
  const status = useAudioPlayerStatus(player);
  const currentUriRef = useRef<string | null>(null);
  const loadTokenRef = useRef(0);
  const mountedRef = useRef(true);
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

  const pausePlayer = useCallback(() => {
    try {
      player.pause();
    } catch (error) {
      if (!isReleasedPlayerError(error)) throw error;
    }
  }, [player]);

  const replacePlayerSource = useCallback(
    (source: string | null) => {
      if (!source) return;
      try {
        player.replace(source);
      } catch (error) {
        if (!isReleasedPlayerError(error)) throw error;
      }
    },
    [player]
  );

  const seekPlayerTo = useCallback(
    async (seconds: number, ignoreReleasedPlayer = false) => {
      try {
        await player.seekTo(seconds);
      } catch (error) {
        if (!ignoreReleasedPlayer || !isReleasedPlayerError(error)) throw error;
      }
    },
    [player]
  );

  const unloadAndCleanupCurrentFile = useCallback(async () => {
    const uri = currentUriRef.current;
    if (!uri) return;

    pausePlayer();
    currentUriRef.current = null;
    await deleteTempFile(uri);
  }, [deleteTempFile, pausePlayer]);

  const loadAndPlay = useCallback(
    async ({ audioBase64, speed }: LoadClipParams) => {
      if (!mountedRef.current) return;
      if (!FileSystem.cacheDirectory) throw new Error('Cache directory is unavailable.');

      const loadToken = loadTokenRef.current + 1;
      loadTokenRef.current = loadToken;

      const uri = `${FileSystem.cacheDirectory}tts-${Date.now()}-${loadToken}.mp3`;
      await FileSystem.writeAsStringAsync(uri, audioBase64, {
        encoding: FileSystem.EncodingType.Base64,
      });

      if (!mountedRef.current || loadTokenRef.current !== loadToken) {
        await deleteTempFile(uri);
        return;
      }

      const previousUri = currentUriRef.current;

      try {
        player.replace(uri);
        player.setPlaybackRate(speed);
        player.play();
      } catch (error) {
        if (mountedRef.current && loadTokenRef.current === loadToken) {
          pausePlayer();
          replacePlayerSource(previousUri);
        }
        await deleteTempFile(uri);
        if (!mountedRef.current && isReleasedPlayerError(error)) return;
        throw error;
      }

      currentUriRef.current = uri;
      seekTimeRef.current = 0;

      if (previousUri) {
        await deleteTempFile(previousUri);
      }
      await cleanupPendingDeletes(uri);
    },
    [cleanupPendingDeletes, deleteTempFile, pausePlayer, player, replacePlayerSource]
  );

  const pause = useCallback(() => {
    pausePlayer();
  }, [pausePlayer]);

  const resume = useCallback(() => {
    if (currentUriRef.current) {
      player.play();
    }
  }, [player]);

  const stop = useCallback(async () => {
    loadTokenRef.current += 1;
    pausePlayer();
    try {
      await seekPlayerTo(0, true);
    } finally {
      seekTimeRef.current = 0;
      await unloadAndCleanupCurrentFile();
    }
  }, [pausePlayer, seekPlayerTo, unloadAndCleanupCurrentFile]);

  const seekBy = useCallback(
    async (seconds: number) => {
      const requestedTime = Math.max(seekTimeRef.current + seconds, 0);
      const nextTime =
        Number.isFinite(status.duration) && status.duration > 0
          ? Math.min(requestedTime, status.duration)
          : requestedTime;
      seekTimeRef.current = nextTime;
      try {
        await seekPlayerTo(nextTime);
      } catch (error) {
        seekTimeRef.current = status.currentTime;
        throw error;
      }
    },
    [seekPlayerTo, status.currentTime, status.duration]
  );

  const setSpeed = useCallback(
    (speed: TtsSpeed) => {
      player.setPlaybackRate(speed);
    },
    [player]
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      loadTokenRef.current += 1;
      void unloadAndCleanupCurrentFile().catch((error) => {
        warnUnlessReleasedPlayer('ttsPlayback unmount cleanup failed', error);
      });
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
