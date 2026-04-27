import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  activeWordIdAtTime,
  formatTtsSpeed,
  isTtsSpeed,
  mapAlignmentToWordTimings,
  nextTtsSpeed,
  normalizeTtsSpeed,
  previousTtsSpeed,
} from './timing';
import type { ElevenLabsAlignment, TtsWord } from './types';

describe('TTS speed helpers', () => {
  it('identifies bounded tenth-step speeds', () => {
    assert.equal(isTtsSpeed(0.5), true);
    assert.equal(isTtsSpeed(1), true);
    assert.equal(isTtsSpeed(1.1), true);
    assert.equal(isTtsSpeed(2), true);
    assert.equal(isTtsSpeed(0.4), false);
    assert.equal(isTtsSpeed(1.05), false);
    assert.equal(isTtsSpeed(2.1), false);
    assert.equal(isTtsSpeed('1'), false);
  });

  it('normalizes speed values to bounded tenth-step speeds', () => {
    assert.equal(normalizeTtsSpeed(1.14), 1.1);
    assert.equal(normalizeTtsSpeed(1.15), 1.2);
    assert.equal(normalizeTtsSpeed(0.3), 0.5);
    assert.equal(normalizeTtsSpeed(2.4), 2);
    assert.equal(normalizeTtsSpeed(undefined), 1);
  });

  it('formats speeds with an x suffix', () => {
    assert.equal(formatTtsSpeed(1), '1x');
    assert.equal(formatTtsSpeed(1.1), '1.1x');
    assert.equal(formatTtsSpeed(2), '2x');
  });

  it('steps up by one tenth', () => {
    assert.equal(nextTtsSpeed(1), 1.1);
    assert.equal(nextTtsSpeed(1.9), 2);
    assert.equal(nextTtsSpeed(2), 2);
  });

  it('steps down by one tenth', () => {
    assert.equal(previousTtsSpeed(1.1), 1);
    assert.equal(previousTtsSpeed(1), 0.9);
    assert.equal(previousTtsSpeed(0.5), 0.5);
  });
});

describe('ElevenLabs character timing mapping', () => {
  const words: TtsWord[] = [
    { id: 'w0', text: 'Hello', startOffset: 0, endOffset: 5 },
    { id: 'w1', text: 'reader', startOffset: 6, endOffset: 12 },
  ];

  const alignment: ElevenLabsAlignment = {
    characters: ['H', 'e', 'l', 'l', 'o', ' ', 'r', 'e', 'a', 'd', 'e', 'r'],
    character_start_times_seconds: [0, 0.05, 0.1, 0.15, 0.2, 0.25, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65],
    character_end_times_seconds: [0.05, 0.1, 0.15, 0.2, 0.25, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.8],
  };

  it('maps character offsets to word timing windows', () => {
    assert.deepEqual(mapAlignmentToWordTimings(alignment, words), [
      { wordId: 'w0', startTime: 0, endTime: 0.25 },
      { wordId: 'w1', startTime: 0.4, endTime: 0.8 },
    ]);
  });

  it('skips invalid and out-of-range word offsets', () => {
    const invalidWords: TtsWord[] = [
      { id: 'negative-start', text: 'Bad', startOffset: -1, endOffset: 2 },
      { id: 'empty-range', text: 'Bad', startOffset: 2, endOffset: 2 },
      { id: 'reversed-range', text: 'Bad', startOffset: 4, endOffset: 3 },
      { id: 'start-too-late', text: 'Bad', startOffset: 12, endOffset: 13 },
      { id: 'end-too-late', text: 'Bad', startOffset: 10, endOffset: 13 },
      { id: 'valid', text: 'reader', startOffset: 6, endOffset: 12 },
    ];

    assert.deepEqual(mapAlignmentToWordTimings(alignment, invalidWords), [
      { wordId: 'valid', startTime: 0.4, endTime: 0.8 },
    ]);
  });

  it('returns undefined before playback reaches the first word', () => {
    const timings = mapAlignmentToWordTimings(alignment, words);
    assert.equal(activeWordIdAtTime(timings, -0.01), undefined);
  });

  it('keeps the previous word active between word timing windows', () => {
    const timings = mapAlignmentToWordTimings(alignment, words);
    assert.equal(activeWordIdAtTime(timings, 0.3), 'w0');
  });

  it('treats timing window boundaries as active', () => {
    const timings = mapAlignmentToWordTimings(alignment, words);
    assert.equal(activeWordIdAtTime(timings, 0), 'w0');
    assert.equal(activeWordIdAtTime(timings, 0.25), 'w0');
    assert.equal(activeWordIdAtTime(timings, 0.4), 'w1');
    assert.equal(activeWordIdAtTime(timings, 0.8), 'w1');
  });

  it('keeps the final word active after its timing window', () => {
    const timings = mapAlignmentToWordTimings(alignment, words);
    assert.equal(activeWordIdAtTime(timings, 1.2), 'w1');
  });
});
