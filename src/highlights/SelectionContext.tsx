import { useReader } from '@epubjs-react-native/core';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import * as highlightStore from './highlights';
import type { Highlight, HighlightChunk, HighlightColor } from './highlights';
import { createHighlightRailScript } from './injected/railScript';
import {
  createApplyHighlightScript,
  createClearPendingScript,
  createRemoveHighlightScript,
  createSetNoteModeScript,
  createSyncHighlightsScript,
  highlightColorToHex,
  parseHighlightWebViewMessage,
} from './webviewBridge';

type PendingSelection = {
  sentenceIds: string[];
  cfiRanges: string[];
  selectedText: string;
  chunks: HighlightChunk[];
};

export type SelectionAPI = {
  noteMode: boolean;
  setNoteMode: (enabled: boolean) => void;
  selectedCount: number;
  hasSelection: boolean;
  selectedText: string;
  lastPickedColor: HighlightColor;
  applyColor: (color: HighlightColor) => Promise<void>;
  saveNote: (text: string, color?: HighlightColor) => Promise<void>;
  erase: () => Promise<void>;
  clearSelection: () => void;
};

type HighlightReaderBridgeAPI = {
  injectedJavascript: string;
  handleWebViewMessage: (event: unknown) => void;
};

type HighlightContextValue = SelectionAPI & HighlightReaderBridgeAPI;

const emptySelection: PendingSelection = {
  sentenceIds: [],
  cfiRanges: [],
  selectedText: '',
  chunks: [],
};

const HighlightSelectionContext = createContext<HighlightContextValue | null>(null);

export function HighlightSelectionProvider({
  bookId,
  initialHighlights,
  onRequestPauseAudio,
  children,
}: {
  bookId: string;
  initialHighlights: Highlight[];
  onRequestPauseAudio?: () => void;
  children: ReactNode;
}) {
  const {
    addAnnotation,
    injectJavascript,
    isLoading,
    isRendering,
    removeAnnotationByCfi,
  } = useReader();
  const [records, setRecords] = useState<Highlight[]>(initialHighlights);
  const [selection, setSelection] = useState<PendingSelection>(emptySelection);
  const [noteMode, setNoteModeState] = useState(false);
  const [lastPickedColor, setLastPickedColor] = useState<HighlightColor>('yellow');
  const recordsRef = useRef(records);
  const selectionRef = useRef(selection);
  const annotatedIdsRef = useRef(new Set<string>());
  const injectedJavascript = useMemo(() => createHighlightRailScript(), []);

  useEffect(() => {
    setRecords(initialHighlights);
    recordsRef.current = initialHighlights;
    setSelection(emptySelection);
    selectionRef.current = emptySelection;
    setNoteModeState(false);
    annotatedIdsRef.current.clear();
  }, [bookId, initialHighlights]);

  useEffect(() => {
    recordsRef.current = records;
  }, [records]);

  useEffect(() => {
    selectionRef.current = selection;
  }, [selection]);

  const syncRailHighlights = useCallback(
    (nextRecords = recordsRef.current) => {
      injectJavascript(createSyncHighlightsScript(nextRecords));
    },
    [injectJavascript]
  );

  const replayAnnotations = useCallback(
    (nextRecords = recordsRef.current) => {
      nextRecords.forEach((record) => {
        if (annotatedIdsRef.current.has(record.id)) return;

        addAnnotation(
          'highlight',
          record.cfiRange,
          { id: record.id, note: record.note, text: record.text },
          { color: highlightColorToHex(record.color), opacity: 0.4 }
        );
        annotatedIdsRef.current.add(record.id);
      });
    },
    [addAnnotation]
  );

  useEffect(() => {
    if (isLoading || isRendering) return;
    replayAnnotations(records);
    syncRailHighlights(records);
  }, [isLoading, isRendering, records, replayAnnotations, syncRailHighlights]);

  const clearSelection = useCallback(() => {
    setSelection(emptySelection);
    selectionRef.current = emptySelection;
    injectJavascript(createClearPendingScript());
  }, [injectJavascript]);

  const setNoteMode = useCallback(
    (enabled: boolean) => {
      setNoteModeState(enabled);
      injectJavascript(createSetNoteModeScript(enabled));

      if (enabled) {
        onRequestPauseAudio?.();
        return;
      }

      setSelection(emptySelection);
      selectionRef.current = emptySelection;
      injectJavascript(createClearPendingScript());
    },
    [injectJavascript, onRequestPauseAudio]
  );

  const removeOverlappingRecords = useCallback(
    async (pending: PendingSelection): Promise<Highlight[]> => {
      const selectedIds = new Set(pending.sentenceIds);
      const selectedCfis = new Set(pending.cfiRanges);
      const overlapping = recordsRef.current.filter((record) => {
        if (selectedCfis.has(record.cfiRange)) return true;
        return record.sentenceIds?.some((id) => selectedIds.has(id)) ?? false;
      });

      if (overlapping.length === 0) return recordsRef.current;

      const overlappingIds = new Set(overlapping.map((record) => record.id));
      for (const record of overlapping) {
        await highlightStore.remove(bookId, record.id);
        removeAnnotationByCfi(record.cfiRange);
        injectJavascript(createRemoveHighlightScript(record));
        annotatedIdsRef.current.delete(record.id);
      }

      const nextRecords = recordsRef.current.filter((record) => !overlappingIds.has(record.id));
      recordsRef.current = nextRecords;
      setRecords(nextRecords);
      return nextRecords;
    },
    [bookId, injectJavascript, removeAnnotationByCfi]
  );

  const saveSelection = useCallback(
    async (color: HighlightColor, note?: string) => {
      const pending = selectionRef.current;
      const cfiRange = pending.cfiRanges[0];
      if (!cfiRange || pending.sentenceIds.length === 0) return;

      const baseRecords = await removeOverlappingRecords(pending);
      const created = await highlightStore.add(bookId, {
        cfiRange,
        color,
        note,
        text: pending.selectedText,
        sentenceIds: pending.sentenceIds,
        chunks: pending.chunks,
      });

      addAnnotation(
        'highlight',
        created.cfiRange,
        { id: created.id, note: created.note, text: created.text },
        { color: highlightColorToHex(created.color), opacity: 0.4 }
      );
      annotatedIdsRef.current.add(created.id);
      injectJavascript(createApplyHighlightScript(created));

      const nextRecords = [...baseRecords, created];
      recordsRef.current = nextRecords;
      setRecords(nextRecords);
      setLastPickedColor(color);
      clearSelection();
    },
    [addAnnotation, bookId, clearSelection, injectJavascript, removeOverlappingRecords]
  );

  const applyColor = useCallback(
    async (color: HighlightColor) => {
      await saveSelection(color);
    },
    [saveSelection]
  );

  const saveNote = useCallback(
    async (text: string, color?: HighlightColor) => {
      const note = text.trim();
      await saveSelection(color ?? lastPickedColor, note.length > 0 ? note : undefined);
    },
    [lastPickedColor, saveSelection]
  );

  const erase = useCallback(async () => {
    const pending = selectionRef.current;
    if (pending.sentenceIds.length === 0 && pending.cfiRanges.length === 0) return;

    await removeOverlappingRecords(pending);
    clearSelection();
  }, [clearSelection, removeOverlappingRecords]);

  const handleWebViewMessage = useCallback(
    (event: unknown) => {
      const message = parseHighlightWebViewMessage(event);
      if (!message) return;

      if (message.type === 'selection-changed') {
        const nextSelection = {
          sentenceIds: message.sentenceIds,
          cfiRanges: message.cfiRanges,
          selectedText: message.selectedText,
          chunks: message.chunks,
        };
        selectionRef.current = nextSelection;
        setSelection(nextSelection);
        return;
      }

      if (message.type === 'rail-ready') {
        injectJavascript(createSetNoteModeScript(noteMode));
        syncRailHighlights();
        return;
      }

      if (message.level === 'error') {
        console.warn('highlight rail', message.message);
      }
    },
    [injectJavascript, noteMode, syncRailHighlights]
  );

  const value = useMemo<HighlightContextValue>(
    () => ({
      noteMode,
      setNoteMode,
      selectedCount: selection.sentenceIds.length,
      hasSelection: selection.sentenceIds.length > 0 && selection.cfiRanges.length > 0,
      selectedText: selection.selectedText,
      lastPickedColor,
      applyColor,
      saveNote,
      erase,
      clearSelection,
      injectedJavascript,
      handleWebViewMessage,
    }),
    [
      applyColor,
      clearSelection,
      erase,
      handleWebViewMessage,
      injectedJavascript,
      lastPickedColor,
      noteMode,
      saveNote,
      selection.cfiRanges.length,
      selection.selectedText,
      selection.sentenceIds.length,
      setNoteMode,
    ]
  );

  return (
    <HighlightSelectionContext.Provider value={value}>
      {children}
    </HighlightSelectionContext.Provider>
  );
}

export function useHighlightSelection(): SelectionAPI {
  const value = useHighlightContext();
  return {
    noteMode: value.noteMode,
    setNoteMode: value.setNoteMode,
    selectedCount: value.selectedCount,
    hasSelection: value.hasSelection,
    selectedText: value.selectedText,
    lastPickedColor: value.lastPickedColor,
    applyColor: value.applyColor,
    saveNote: value.saveNote,
    erase: value.erase,
    clearSelection: value.clearSelection,
  };
}

export function useHighlightReaderBridge(): HighlightReaderBridgeAPI {
  const value = useHighlightContext();
  return {
    injectedJavascript: value.injectedJavascript,
    handleWebViewMessage: value.handleWebViewMessage,
  };
}

function useHighlightContext(): HighlightContextValue {
  const value = useContext(HighlightSelectionContext);
  if (!value) {
    throw new Error('HighlightSelectionProvider is missing');
  }
  return value;
}
