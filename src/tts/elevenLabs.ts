import type { ElevenLabsSpeechResponse, ElevenLabsVoice } from './types';

const BASE_URL = 'https://api.elevenlabs.io/v1';
const DEFAULT_MODEL_ID = 'eleven_flash_v2_5';
const DEFAULT_OUTPUT_FORMAT = 'mp3_44100_128';

type VoicesResponse = {
  voices: ElevenLabsVoice[];
};

export type GenerateSpeechParams = {
  apiKey: string;
  voiceId: string;
  text: string;
  previousText?: string;
  nextText?: string;
};

export function sortVoicesByName(voices: ElevenLabsVoice[]): ElevenLabsVoice[] {
  return [...voices].sort((a, b) => a.name.localeCompare(b.name));
}

export async function fetchVoices(apiKey: string): Promise<ElevenLabsVoice[]> {
  const response = await fetch(`${BASE_URL}/voices`, {
    headers: {
      'xi-api-key': apiKey,
    },
  });

  if (!response.ok) {
    throw new Error(await extractElevenLabsErrorMessage(response.status, await response.text()));
  }

  const data = (await response.json()) as VoicesResponse;
  return sortVoicesByName(data.voices ?? []);
}

export async function generateSpeech({
  apiKey,
  voiceId,
  text,
  previousText,
  nextText,
}: GenerateSpeechParams): Promise<ElevenLabsSpeechResponse> {
  const url = `${BASE_URL}/text-to-speech/${encodeURIComponent(voiceId)}/with-timestamps?output_format=${DEFAULT_OUTPUT_FORMAT}`;
  const body: Record<string, unknown> = {
    text,
    model_id: DEFAULT_MODEL_ID,
    voice_settings: {
      stability: 0.5,
      similarity_boost: 0.75,
      style: 0.0,
      use_speaker_boost: true,
    },
  };

  if (previousText) body.previous_text = previousText;
  if (nextText) body.next_text = nextText;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'xi-api-key': apiKey,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(await extractElevenLabsErrorMessage(response.status, await response.text()));
  }

  return (await response.json()) as ElevenLabsSpeechResponse;
}

export async function extractElevenLabsErrorMessage(statusCode: number, rawBody: string): Promise<string> {
  const parsed = safeJson(rawBody);

  if (parsed && typeof parsed === 'object') {
    const detail = (parsed as { detail?: unknown }).detail;
    if (detail && typeof detail === 'object') {
      const detailObject = detail as { status?: unknown; message?: unknown };
      if (detailObject.status === 'quota_exceeded') {
        return 'Monthly character quota exceeded. Upgrade your ElevenLabs plan for more characters.';
      }
      if (typeof detailObject.message === 'string' && detailObject.message.trim()) {
        return detailObject.message;
      }
    }

    if (typeof detail === 'string' && detail.trim()) return detail;

    const message = (parsed as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim()) return message;
  }

  if (rawBody.trim()) return rawBody.trim();

  switch (statusCode) {
    case 401:
      return 'Authentication failed (HTTP 401).';
    case 429:
      return 'Rate limited. Please wait and try again.';
    default:
      return `ElevenLabs error (HTTP ${statusCode}).`;
  }
}

function safeJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}
