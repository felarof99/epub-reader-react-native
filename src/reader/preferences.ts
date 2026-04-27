import type { Flow, Manager, Theme } from '@epubjs-react-native/core';

export type ReaderThemeId = 'light' | 'sepia' | 'dark';
export type ReaderReadingMode = 'continuous' | 'paged';

export type ReaderPreferences = {
  fontSize: number;
  themeId: ReaderThemeId;
  readingMode: ReaderReadingMode;
};

export type ReaderLayout = {
  flow: Flow;
  keepScrollOffsetOnLocationChange: boolean;
  manager: Manager;
};

type ReaderThemeOption = {
  label: string;
  theme: Theme;
  colors: {
    background: string;
    text: string;
    mutedText: string;
    border: string;
    pressed: string;
    control: string;
    controlText: string;
    swatch: string;
  };
};

export const READER_FONT_SIZE_MIN = 80;
export const READER_FONT_SIZE_MAX = 160;
export const READER_FONT_SIZE_STEP = 10;
export const DEFAULT_READER_FONT_SIZE = 100;
export const DEFAULT_READER_THEME_ID: ReaderThemeId = 'light';
export const DEFAULT_READER_READING_MODE: ReaderReadingMode = 'continuous';

export const DEFAULT_READER_PREFERENCES: ReaderPreferences = {
  fontSize: DEFAULT_READER_FONT_SIZE,
  readingMode: DEFAULT_READER_READING_MODE,
  themeId: DEFAULT_READER_THEME_ID,
};

const lightText = '#111111';
const sepiaText = '#2f2418';
const darkText = '#f3efe7';

export const READER_THEMES: Record<ReaderThemeId, ReaderThemeOption> = {
  light: {
    label: 'Light',
    theme: createReaderTheme('#ffffff', lightText, '#b8dfff'),
    colors: {
      background: '#ffffff',
      text: lightText,
      mutedText: '#6f6f6f',
      border: '#e5e5e5',
      pressed: '#f3f3f3',
      control: '#111111',
      controlText: '#ffffff',
      swatch: '#ffffff',
    },
  },
  sepia: {
    label: 'Sepia',
    theme: createReaderTheme('#efe5c8', sepiaText, '#c9a95f'),
    colors: {
      background: '#efe5c8',
      text: sepiaText,
      mutedText: '#786850',
      border: '#d7c7a2',
      pressed: '#e4d6b8',
      control: '#5a432b',
      controlText: '#fff8eb',
      swatch: '#efe5c8',
    },
  },
  dark: {
    label: 'Dark',
    theme: createReaderTheme('#111214', darkText, '#536f9d'),
    colors: {
      background: '#111214',
      text: darkText,
      mutedText: '#aaa49a',
      border: '#2c2d31',
      pressed: '#1c1d21',
      control: darkText,
      controlText: '#111214',
      swatch: '#111214',
    },
  },
};

export function isReaderThemeId(value: unknown): value is ReaderThemeId {
  return typeof value === 'string' && value in READER_THEMES;
}

export function isReaderReadingMode(value: unknown): value is ReaderReadingMode {
  return value === 'continuous' || value === 'paged';
}

export function clampReaderFontSize(size: unknown): number {
  if (typeof size !== 'number' || !Number.isFinite(size)) {
    return DEFAULT_READER_FONT_SIZE;
  }

  const stepped = Math.round(size / READER_FONT_SIZE_STEP) * READER_FONT_SIZE_STEP;
  return Math.min(READER_FONT_SIZE_MAX, Math.max(READER_FONT_SIZE_MIN, stepped));
}

export function nextReaderFontSize(current: number, direction: 'decrease' | 'increase'): number {
  const delta = direction === 'increase' ? READER_FONT_SIZE_STEP : -READER_FONT_SIZE_STEP;
  return clampReaderFontSize(current + delta);
}

export function fontSizePercent(size: number): `${number}%` {
  return `${clampReaderFontSize(size)}%`;
}

export function readerThemeForPreferences({ fontSize, themeId }: Pick<ReaderPreferences, 'fontSize' | 'themeId'>): Theme {
  const theme = READER_THEMES[themeId].theme;
  const body = theme.body ?? {};

  return {
    ...theme,
    body: {
      ...body,
      'font-size': `${fontSizePercent(fontSize)} !important`,
    },
  };
}

export function readerLayoutForPreferences({ readingMode }: Pick<ReaderPreferences, 'readingMode'>): ReaderLayout {
  if (readingMode === 'paged') {
    return {
      flow: 'paginated',
      keepScrollOffsetOnLocationChange: false,
      manager: 'default',
    };
  }

  return {
    flow: 'scrolled-doc',
    keepScrollOffsetOnLocationChange: true,
    manager: 'continuous',
  };
}

function createReaderTheme(background: string, text: string, selection: string): Theme {
  const textRule = { color: `${text} !important` };

  return {
    '*': {
      'box-sizing': 'border-box',
    },
    body: {
      background: `${background} !important`,
      color: `${text} !important`,
      'line-height': '1.55',
      'overflow-wrap': 'break-word',
      'word-break': 'break-word',
      hyphens: 'auto',
      padding: '0 14px !important',
    },
    p: textRule,
    span: textRule,
    li: textRule,
    div: textRule,
    h1: textRule,
    h2: textRule,
    h3: textRule,
    h4: textRule,
    h5: textRule,
    h6: textRule,
    a: {
      color: `${text} !important`,
      'pointer-events': 'auto',
      cursor: 'pointer',
    },
    img: {
      'max-width': '100% !important',
      height: 'auto !important',
      'object-fit': 'contain',
    },
    svg: {
      'max-width': '100% !important',
      height: 'auto !important',
    },
    table: {
      'max-width': '100% !important',
      'overflow-wrap': 'anywhere',
    },
    '::selection': {
      background: selection,
    },
  };
}
