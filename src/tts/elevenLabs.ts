import type { ElevenLabsSpeechResponse, ElevenLabsVoice } from './types';

const API_BASE_URL = 'https://api.elevenlabs.io';
const DEFAULT_MODEL_ID = 'eleven_flash_v2_5';
const DEFAULT_OUTPUT_FORMAT = 'mp3_44100_128';
const VOICES_PAGE_SIZE = 100;

type VoicesResponse = {
  voices?: unknown;
  has_more?: unknown;
  next_page_token?: unknown;
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
  const voices: ElevenLabsVoice[] = [];
  let nextPageToken: string | undefined;

  do {
    const url = new URL(`${API_BASE_URL}/v2/voices`);
    url.searchParams.set('page_size', String(VOICES_PAGE_SIZE));
    if (nextPageToken) url.searchParams.set('next_page_token', nextPageToken);

    const response = await fetch(url.toString(), {
      headers: {
        'xi-api-key': apiKey,
      },
    });

    if (!response.ok) {
      throw new Error(await extractElevenLabsErrorMessage(response.status, await response.text()));
    }

    const data = (await response.json()) as VoicesResponse;
    voices.push(...extractVoices(data));
    nextPageToken =
      data.has_more === true && typeof data.next_page_token === 'string' && data.next_page_token.trim()
        ? data.next_page_token
        : undefined;
  } while (nextPageToken);

  return sortVoicesByName(voices);
}

export async function generateSpeech({
  apiKey,
  voiceId,
  text,
  previousText,
  nextText,
}: GenerateSpeechParams): Promise<ElevenLabsSpeechResponse> {
  const url = `${API_BASE_URL}/v1/text-to-speech/${encodeURIComponent(voiceId)}/with-timestamps?output_format=${DEFAULT_OUTPUT_FORMAT}`;
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

  const data = (await response.json()) as unknown;
  return extractSpeechResponse(data);
}

export async function extractElevenLabsErrorMessage(statusCode: number, rawBody: string): Promise<string> {
  const parsed = safeJson(rawBody);

  if (parsed && typeof parsed === 'object') {
    const detail = (parsed as { detail?: unknown }).detail;
    if (Array.isArray(detail)) {
      const validationMessage = detail
        .map((item) => {
          if (!item || typeof item !== 'object') return undefined;
          const message = (item as { msg?: unknown }).msg;
          return typeof message === 'string' && message.trim() ? message : undefined;
        })
        .find((message) => message);
      if (validationMessage) return validationMessage;
    }

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

function extractVoices(data: VoicesResponse): ElevenLabsVoice[] {
  if (!Array.isArray(data.voices)) {
    throw new Error('Invalid ElevenLabs voices response: expected voices to be an array.');
  }

  return data.voices as ElevenLabsVoice[];
}

function extractSpeechResponse(data: unknown): ElevenLabsSpeechResponse {
  if (!data || typeof data !== 'object' || typeof (data as { audio_base64?: unknown }).audio_base64 !== 'string') {
    throw new Error('Invalid ElevenLabs speech response: expected audio_base64 to be a string.');
  }

  return data as ElevenLabsSpeechResponse;
}
