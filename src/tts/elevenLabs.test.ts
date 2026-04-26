import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { extractElevenLabsErrorMessage, sortVoicesByName } from './elevenLabs';

describe('sortVoicesByName', () => {
  it('sorts voices by display name', () => {
    assert.deepEqual(
      sortVoicesByName([
        { voice_id: '2', name: 'Zoe' },
        { voice_id: '1', name: 'Aike' },
      ]).map((voice) => voice.name),
      ['Aike', 'Zoe']
    );
  });
});

describe('extractElevenLabsErrorMessage', () => {
  it('uses quota message for quota_exceeded responses', async () => {
    const message = await extractElevenLabsErrorMessage(
      429,
      JSON.stringify({ detail: { status: 'quota_exceeded', message: 'quota hit' } })
    );
    assert.equal(message, 'Monthly character quota exceeded. Upgrade your ElevenLabs plan for more characters.');
  });

  it('uses nested API message when present', async () => {
    const message = await extractElevenLabsErrorMessage(
      401,
      JSON.stringify({ detail: { message: 'Invalid API key' } })
    );
    assert.equal(message, 'Invalid API key');
  });

  it('falls back to status-specific messages', async () => {
    assert.equal(await extractElevenLabsErrorMessage(401, ''), 'Authentication failed (HTTP 401).');
    assert.equal(await extractElevenLabsErrorMessage(429, ''), 'Rate limited. Please wait and try again.');
  });
});
