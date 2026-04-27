import {
  DEFAULT_TTS_SPEED,
  TTS_SPEED_MAX,
  TTS_SPEED_MIN,
  TTS_SPEED_STEP,
  type ElevenLabsAlignment,
  type TtsSpeed,
  type TtsWord,
  type WordTiming,
} from './types';

export function isTtsSpeed(value: unknown): value is TtsSpeed {
  return typeof value === 'number' && Number.isFinite(value) && value === normalizeTtsSpeed(value);
}

export function normalizeTtsSpeed(value: unknown): TtsSpeed {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_TTS_SPEED;
  return normalizeSpeedStep(value);
}

export function nextTtsSpeed(current: TtsSpeed): TtsSpeed {
  return normalizeSpeedStep(current + TTS_SPEED_STEP);
}

export function previousTtsSpeed(current: TtsSpeed): TtsSpeed {
  return normalizeSpeedStep(current - TTS_SPEED_STEP);
}

export function formatTtsSpeed(speed: TtsSpeed): string {
  const normalized = normalizeTtsSpeed(speed);
  return Number.isInteger(normalized) ? `${normalized}x` : `${normalized.toFixed(1)}x`;
}

function normalizeSpeedStep(speed: number): TtsSpeed {
  const stepped = Math.round((speed + 1e-8) / TTS_SPEED_STEP) * TTS_SPEED_STEP;
  const clamped = Math.min(TTS_SPEED_MAX, Math.max(TTS_SPEED_MIN, stepped));
  return Number(clamped.toFixed(1));
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
    if (
      word.startOffset < 0 ||
      word.endOffset <= word.startOffset ||
      word.startOffset >= starts.length ||
      word.endOffset > ends.length
    ) {
      return [];
    }

    const startTime = starts[word.startOffset];
    const endTime = ends[word.endOffset - 1];

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
  if (currentTime < timings[0].startTime) return undefined;

  const exact = timings.find((timing) => currentTime >= timing.startTime && currentTime <= timing.endTime);
  if (exact) return exact.wordId;

  const previous = [...timings].reverse().find((timing) => timing.startTime <= currentTime);
  return previous?.wordId;
}
