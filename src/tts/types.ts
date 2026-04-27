export const DEFAULT_TTS_SPEED = 1;
export const TTS_SPEED_MAX = 2;
export const TTS_SPEED_MIN = 0.5;
export const TTS_SPEED_STEP = 0.1;

export type TtsSpeed = number;

export type ElevenLabsVoice = {
  voice_id: string;
  name: string;
  category?: string;
  labels?: Record<string, string>;
  preview_url?: string;
};

export type ElevenLabsAlignment = {
  characters: string[];
  character_start_times_seconds: number[];
  character_end_times_seconds: number[];
};

export type ElevenLabsSpeechResponse = {
  audio_base64: string;
  alignment?: ElevenLabsAlignment | null;
  normalized_alignment?: ElevenLabsAlignment | null;
};

export type TtsVoiceSelection = {
  voiceId: string;
  voiceName: string;
};

export type TtsSettings = {
  selectedVoice?: TtsVoiceSelection;
  speed: TtsSpeed;
};

export type TtsWord = {
  id: string;
  text: string;
  startOffset: number;
  endOffset: number;
};

export type TtsParagraph = {
  paragraphId: string;
  text: string;
  words: TtsWord[];
};

export type WordTiming = {
  wordId: string;
  startTime: number;
  endTime: number;
};

export type TtsBridgeMessage =
  | { type: 'ttsParagraph'; requestId: string; paragraph: TtsParagraph }
  | { type: 'ttsParagraphError'; requestId: string; message: string }
  | { type: 'ttsNextParagraphMissing'; requestId: string };
