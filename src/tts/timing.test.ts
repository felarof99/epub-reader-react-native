import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  activeWordIdAtTime,
  mapAlignmentToWordTimings,
  nextTtsSpeed,
  previousTtsSpeed,
} from './timing';
import type { ElevenLabsAlignment, TtsWord } from './types';

describe('TTS speed helpers', () => {
  it('steps up through the allowed speeds', () => {
    assert.equal(nextTtsSpeed(1), 1.5);
    assert.equal(nextTtsSpeed(1.5), 2);
    assert.equal(nextTtsSpeed(2), 2);
  });

  it('steps down through the allowed speeds', () => {
    assert.equal(previousTtsSpeed(2), 1.5);
    assert.equal(previousTtsSpeed(1.5), 1);
    assert.equal(previousTtsSpeed(1), 1);
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

  it('finds the active word for a playback time', () => {
    const timings = mapAlignmentToWordTimings(alignment, words);
    assert.equal(activeWordIdAtTime(timings, 0.01), 'w0');
    assert.equal(activeWordIdAtTime(timings, 0.5), 'w1');
    assert.equal(activeWordIdAtTime(timings, 1.2), 'w1');
  });
});
