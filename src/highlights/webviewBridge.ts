import type { Highlight, HighlightChunk, HighlightColor } from './highlights';

export type HighlightSelectionMessage = {
  type: 'selection-changed';
  sentenceIds: string[];
  cfiRanges: string[];
  selectedText: string;
  chunks: HighlightChunk[];
};

export type HighlightRailReadyMessage = {
  type: 'rail-ready';
  sectionHref: string;
  sentenceCount: number;
};

export type HighlightLogMessage = {
  type: 'highlight-log';
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
};

export type HighlightWebViewMessage =
  | HighlightSelectionMessage
  | HighlightRailReadyMessage
  | HighlightLogMessage;

type RawMessage = Record<string, unknown>;

export function parseHighlightWebViewMessage(event: unknown): HighlightWebViewMessage | null {
  const message = parseRawMessage(event);
  if (!message || typeof message.type !== 'string') return null;

  if (message.type === 'selection-changed') {
    return {
      type: 'selection-changed',
      sentenceIds: readStringArray(message.sentenceIds),
      cfiRanges: readStringArray(message.cfiRanges),
      selectedText: typeof message.selectedText === 'string' ? message.selectedText : '',
      chunks: readChunks(message.chunks),
    };
  }

  if (message.type === 'rail-ready') {
    return {
      type: 'rail-ready',
      sectionHref: typeof message.sectionHref === 'string' ? message.sectionHref : '',
      sentenceCount: typeof message.sentenceCount === 'number' ? message.sentenceCount : 0,
    };
  }

  if (message.type === 'highlight-log') {
    return {
      type: 'highlight-log',
      level: isLogLevel(message.level) ? message.level : 'info',
      message: typeof message.message === 'string' ? message.message : '',
    };
  }

  return null;
}

export function createSetNoteModeScript(enabled: boolean): string {
  return createRailCommand('setNoteMode', enabled);
}

export function createClearPendingScript(): string {
  return createRailCommand('clearPending');
}

export function createApplyHighlightScript(highlight: Highlight): string {
  return createRailCommand('applyHighlight', {
    id: highlight.id,
    color: highlight.color,
    sentenceIds: highlight.sentenceIds ?? [],
  });
}

export function createRemoveHighlightScript(highlight: Highlight): string {
  return createRailCommand('removeHighlight', {
    id: highlight.id,
    sentenceIds: highlight.sentenceIds ?? [],
  });
}

export function createSyncHighlightsScript(highlights: Highlight[]): string {
  return createRailCommand(
    'setHighlights',
    highlights.map((highlight) => ({
      id: highlight.id,
      color: highlight.color,
      sentenceIds: highlight.sentenceIds ?? [],
    }))
  );
}

function createRailCommand(command: string, payload?: unknown): string {
  return `
    (function () {
      if (window.__rnHighlightRail && typeof window.__rnHighlightRail.${command} === 'function') {
        window.__rnHighlightRail.${command}(${payload === undefined ? '' : JSON.stringify(payload)});
      }
    })();
    true;
  `;
}

function parseRawMessage(event: unknown): RawMessage | null {
  if (!event) return null;
  if (typeof event === 'string') return safeJsonParse(event);
  if (typeof event === 'object') return event as RawMessage;
  return null;
}

function safeJsonParse(value: string): RawMessage | null {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? (parsed as RawMessage) : null;
  } catch {
    return null;
  }
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function readChunks(value: unknown): HighlightChunk[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((item): HighlightChunk | null => {
      if (!item || typeof item !== 'object') return null;

      const candidate = item as Partial<HighlightChunk>;
      if (typeof candidate.id !== 'string' || typeof candidate.text !== 'string') return null;

      const chunk: HighlightChunk = {
        id: candidate.id,
        text: candidate.text,
        order: typeof candidate.order === 'number' ? candidate.order : 0,
      };
      if (typeof candidate.cfiRange === 'string') chunk.cfiRange = candidate.cfiRange;
      return chunk;
    })
    .filter((item): item is HighlightChunk => item !== null);
}

function isLogLevel(value: unknown): value is HighlightLogMessage['level'] {
  return value === 'debug' || value === 'info' || value === 'warn' || value === 'error';
}

export function highlightColorToHex(color: HighlightColor): string {
  switch (color) {
    case 'cyan':
      return '#4cc9d6';
    case 'green':
      return '#5fd991';
    case 'yellow':
      return '#ffd84d';
    case 'red':
      return '#ff7a7a';
  }
}
