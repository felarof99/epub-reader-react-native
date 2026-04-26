import { TTS_SPEEDS, type ElevenLabsAlignment, type TtsSpeed, type TtsWord, type WordTiming } from './types';

export function isTtsSpeed(value: unknown): value is TtsSpeed {
  return typeof value === 'number' && TTS_SPEEDS.includes(value as TtsSpeed);
}

export function normalizeTtsSpeed(value: unknown): TtsSpeed {
  return isTtsSpeed(value) ? value : 1;
}

export function nextTtsSpeed(current: TtsSpeed): TtsSpeed {
  const index = TTS_SPEEDS.indexOf(current);
  return TTS_SPEEDS[Math.min(TTS_SPEEDS.length - 1, index + 1)];
}

export function previousTtsSpeed(current: TtsSpeed): TtsSpeed {
  const index = TTS_SPEEDS.indexOf(current);
  return TTS_SPEEDS[Math.max(0, index - 1)];
}

export function formatTtsSpeed(speed: TtsSpeed): string {
  return `${speed}x`;
}

export function mapAlignmentToWordTimings(
  alignment: ElevenLabsAlignment | null | undefined,
  words: TtsWord[]
): WordTiming[] {
  if (!alignment) return [];

  const starts = alignment.character_start_times_seconds;
  const ends = alignment.character_end_times_seconds;
  if (starts.length === 0 || ends.length === 0) return [];

  return words.flatMap((word) => {
    const startIndex = Math.min(word.startOffset, starts.length - 1);
    const endIndex = Math.min(Math.max(word.endOffset - 1, startIndex), ends.length - 1);
    const startTime = starts[startIndex];
    const endTime = ends[endIndex];

    if (!Number.isFinite(startTime) || !Number.isFinite(endTime)) return [];

    return [{
      wordId: word.id,
      startTime,
      endTime: Math.max(endTime, startTime),
    }];
  });
}

export function activeWordIdAtTime(timings: WordTiming[], currentTime: number): string | undefined {
  if (timings.length === 0) return undefined;

  const exact = timings.find((timing) => currentTime >= timing.startTime && currentTime <= timing.endTime);
  if (exact) return exact.wordId;

  const previous = [...timings].reverse().find((timing) => timing.startTime <= currentTime);
  return previous?.wordId ?? timings[0].wordId;
}
