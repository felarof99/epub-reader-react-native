import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { extractElevenLabsErrorMessage, fetchVoices, generateSpeech, sortVoicesByName } from './elevenLabs';

type FetchCall = {
  url: string;
  init?: RequestInit;
};

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

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

  it('uses validation detail messages when present', async () => {
    const message = await extractElevenLabsErrorMessage(
      422,
      JSON.stringify({ detail: [{ msg: 'Voice ID is required' }] })
    );
    assert.equal(message, 'Voice ID is required');
  });

  it('falls back to status-specific messages', async () => {
    assert.equal(await extractElevenLabsErrorMessage(401, ''), 'Authentication failed (HTTP 401).');
    assert.equal(await extractElevenLabsErrorMessage(429, ''), 'Rate limited. Please wait and try again.');
  });
});

describe('fetchVoices', () => {
  it('fetches paginated voices with API key header and returns merged voices sorted by name', async () => {
    const calls = mockFetch([
      jsonResponse({
        voices: [{ voice_id: '2', name: 'Zoe' }],
        has_more: true,
        next_page_token: 'next-token',
      }),
      jsonResponse({
        voices: [{ voice_id: '1', name: 'Aike' }],
        has_more: false,
        next_page_token: null,
      }),
    ]);

    const voices = await fetchVoices('test-key');

    assert.deepEqual(
      voices.map((voice) => voice.name),
      ['Aike', 'Zoe']
    );
    assert.equal(calls.length, 2);
    assert.equal(calls[0]?.url, 'https://api.elevenlabs.io/v2/voices?page_size=100');
    assert.deepEqual(calls[0]?.init?.headers, { 'xi-api-key': 'test-key' });
    assert.equal(calls[1]?.url, 'https://api.elevenlabs.io/v2/voices?page_size=100&next_page_token=next-token');
    assert.deepEqual(calls[1]?.init?.headers, { 'xi-api-key': 'test-key' });
  });

  it('throws readable API errors for non-OK responses', async () => {
    mockFetch([textResponse(401, JSON.stringify({ detail: { message: 'Invalid API key' } }))]);

    await assert.rejects(fetchVoices('bad-key'), {
      message: 'Invalid API key',
    });
  });

  it('throws readable errors for malformed voice responses', async () => {
    mockFetch([jsonResponse({ voices: null })]);

    await assert.rejects(fetchVoices('test-key'), {
      message: 'Invalid ElevenLabs voices response: expected voices to be an array.',
    });
  });
});

describe('generateSpeech', () => {
  it('posts timestamped speech requests with headers and context text', async () => {
    const calls = mockFetch([jsonResponse({ audio_base64: 'audio-data' })]);

    const response = await generateSpeech({
      apiKey: 'test-key',
      voiceId: 'voice/id',
      text: 'Current text',
      previousText: 'Previous text',
      nextText: 'Next text',
    });

    assert.equal(response.audio_base64, 'audio-data');
    assert.equal(calls.length, 1);
    assert.equal(
      calls[0]?.url,
      'https://api.elevenlabs.io/v1/text-to-speech/voice%2Fid/with-timestamps?output_format=mp3_44100_128'
    );
    assert.equal(calls[0]?.init?.method, 'POST');
    assert.deepEqual(calls[0]?.init?.headers, {
      'Content-Type': 'application/json',
      'xi-api-key': 'test-key',
    });
    assert.deepEqual(JSON.parse(String(calls[0]?.init?.body)), {
      text: 'Current text',
      model_id: 'eleven_flash_v2_5',
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.75,
        style: 0.0,
        use_speaker_boost: true,
      },
      previous_text: 'Previous text',
      next_text: 'Next text',
    });
  });

  it('throws readable API errors for non-OK responses', async () => {
    mockFetch([textResponse(429, JSON.stringify({ detail: { status: 'quota_exceeded' } }))]);

    await assert.rejects(
      generateSpeech({
        apiKey: 'test-key',
        voiceId: 'voice-id',
        text: 'Current text',
      }),
      {
        message: 'Monthly character quota exceeded. Upgrade your ElevenLabs plan for more characters.',
      }
    );
  });

  it('throws readable errors for malformed speech responses', async () => {
    mockFetch([jsonResponse({ alignment: null })]);

    await assert.rejects(
      generateSpeech({
        apiKey: 'test-key',
        voiceId: 'voice-id',
        text: 'Current text',
      }),
      {
        message: 'Invalid ElevenLabs speech response: expected audio_base64 to be a string.',
      }
    );
  });
});

function mockFetch(responses: Response[]): FetchCall[] {
  const calls: FetchCall[] = [];

  globalThis.fetch = (async (input, init) => {
    calls.push({ url: String(input), init });
    const response = responses.shift();
    assert.ok(response, `Unexpected fetch call to ${String(input)}`);
    return response;
  }) as typeof fetch;

  return calls;
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

function textResponse(status: number, body: string): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => JSON.parse(body),
    text: async () => body,
  } as Response;
}
