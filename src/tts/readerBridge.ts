type ParagraphRequestKind = 'visible' | 'next' | 'selected';

const BRIDGE_EVENT_TYPES = {
  paragraph: 'ttsParagraph',
  error: 'ttsParagraphError',
  missingNext: 'ttsNextParagraphMissing',
} as const;

export function createRequestVisibleParagraphScript(requestId: string): string {
  return createParagraphRequestScript(requestId, 'visible');
}

export function createRequestNextParagraphScript(requestId: string, currentParagraphId: string): string {
  return createParagraphRequestScript(requestId, 'next', currentParagraphId);
}

export function createRequestSelectedParagraphScript(requestId: string, cfiRange: string): string {
  return createParagraphRequestScript(requestId, 'selected', cfiRange);
}

export function createHighlightWordScript(paragraphId: string, wordId: string): string {
  return `
    (function () {
      const targetParagraphId = ${JSON.stringify(paragraphId)};
      const targetWordId = ${JSON.stringify(wordId)};
      function getRenditionContents() {
        if (typeof rendition === 'undefined' || !rendition || !rendition.getContents) return [];
        return rendition.getContents();
      }
      const contents = getRenditionContents();
      contents.forEach(function (content) {
        const doc = content.document;
        if (!doc) return;
        doc.querySelectorAll('[data-tts-active-word="true"]').forEach(function (node) {
          node.removeAttribute('data-tts-active-word');
          node.style.backgroundColor = '';
          node.style.borderRadius = '';
        });
        Array.prototype.slice.call(doc.querySelectorAll('[data-tts-paragraph-id]')).forEach(function (paragraph) {
          if (paragraph.getAttribute('data-tts-paragraph-id') !== targetParagraphId) return;
          Array.prototype.slice.call(paragraph.querySelectorAll('[data-tts-word-id]')).forEach(function (word) {
            if (word.getAttribute('data-tts-word-id') !== targetWordId) return;
            word.setAttribute('data-tts-active-word', 'true');
            word.style.backgroundColor = 'rgba(184, 223, 255, 0.85)';
            word.style.borderRadius = '3px';
          });
        });
      });
    })();
    true;
  `;
}

export function createClearHighlightScript(): string {
  return `
    (function () {
      function getRenditionContents() {
        if (typeof rendition === 'undefined' || !rendition || !rendition.getContents) return [];
        return rendition.getContents();
      }
      const contents = getRenditionContents();
      contents.forEach(function (content) {
        const doc = content.document;
        if (!doc) return;
        doc.querySelectorAll('[data-tts-active-word="true"]').forEach(function (node) {
          node.removeAttribute('data-tts-active-word');
          node.style.backgroundColor = '';
          node.style.borderRadius = '';
        });
      });
    })();
    true;
  `;
}

function createParagraphRequestScript(
  requestId: string,
  kind: ParagraphRequestKind,
  referenceValue?: string,
): string {
  return `
    (function () {
      const requestId = ${JSON.stringify(requestId)};
      const kind = ${JSON.stringify(kind)};
      const referenceValue = ${JSON.stringify(referenceValue ?? '')};
      const currentParagraphId = kind === 'next' ? referenceValue : '';
      const selectedCfiRange = kind === 'selected' ? referenceValue : '';
      const blockSelector = 'p,h1,h2,h3,h4,h5,h6,li,blockquote,div,section,article,main,td,th,dd,dt';
      const minTextLength = 2;

      function send(payload) {
        window.ReactNativeWebView.postMessage(JSON.stringify(payload));
      }

      function getRenditionContents() {
        if (typeof rendition === 'undefined' || !rendition || !rendition.getContents) return [];
        return rendition.getContents();
      }

      function liveSelectedRangeForContent(content) {
        if (!content || !content.window || typeof content.window.getSelection !== 'function') return null;
        const selection = content.window.getSelection();
        if (!selection || selection.rangeCount < 1) return null;
        const selectionRange = selection.getRangeAt(0);
        if (!selectionRange || selectionRange.collapsed) return null;
        if (typeof content.cfiFromRange === 'function' && typeof content.range === 'function') {
          try {
            const liveCfiRange = content.cfiFromRange(selectionRange);
            if (liveCfiRange) return content.range(liveCfiRange);
          } catch (error) {
            // Fall through to using the live DOM range.
          }
        }
        return selectionRange;
      }

      function selectedRangeForContent(content) {
        if (!content) return null;
        if (selectedCfiRange && typeof content.range === 'function') {
          try {
            return content.range(selectedCfiRange);
          } catch (error) {
            // Fall through to the live WebView selection fallback.
          }
        }
        return liveSelectedRangeForContent(content);
      }

      function clearLiveSelections(contents) {
        contents.forEach(function (content) {
          if (!content || !content.window || typeof content.window.getSelection !== 'function') return;
          const selection = content.window.getSelection();
          if (selection && typeof selection.removeAllRanges === 'function') selection.removeAllRanges();
        });
      }

      function normalizeText(text) {
        return (text || '').replace(/\\s+/g, ' ').trim();
      }

      function textNodesFor(element) {
        const nodes = [];
        const walker = element.ownerDocument.createTreeWalker(element, NodeFilter.SHOW_TEXT);
        let node = walker.nextNode();
        while (node) {
          if (normalizeText(node.textContent).length > 0) nodes.push(node);
          node = walker.nextNode();
        }
        return nodes;
      }

      function wordRangesForElement(content, element, startAtFirstVisibleWord) {
        const ranges = [];
        const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
        textNodesFor(element).forEach(function (node) {
          const text = node.textContent || '';
          const pattern = /\\S+/g;
          let match;
          while ((match = pattern.exec(text)) !== null) {
            const range = element.ownerDocument.createRange();
            range.setStart(node, match.index);
            range.setEnd(node, match.index + match[0].length);
            const rect = range.getBoundingClientRect();
            const top = rect.top + contentTopOffset(content);
            const bottom = rect.bottom + contentTopOffset(content);
            if (range.detach) range.detach();
            ranges.push({
              node,
              startOffset: match.index,
              endOffset: match.index + match[0].length,
              text: match[0],
              top,
              bottom
            });
          }
        });

        if (!startAtFirstVisibleWord) return ranges;

        const firstVisibleIndex = ranges.findIndex(function (range) {
          return range.bottom > 0 && range.top < viewportHeight;
        });

        return firstVisibleIndex >= 0 ? ranges.slice(firstVisibleIndex) : [];
      }

      function wordRecordsFromRanges(ranges) {
        let offset = 0;
        return ranges.map(function (range, index) {
          const startOffset = offset;
          offset += range.text.length;
          if (index < ranges.length - 1) offset += 1;
          range.wordId = 'w' + index;
          return {
            id: range.wordId,
            text: range.text,
            startOffset,
            endOffset: startOffset + range.text.length
          };
        });
      }

      function textFromRanges(ranges) {
        return ranges.map(function (range) { return range.text; }).join(' ');
      }

      function rangeIntersectsElement(range, element) {
        if (!range) return false;
        try {
          if (typeof range.intersectsNode === 'function' && range.intersectsNode(element)) return true;
        } catch (error) {
          // Fall through to container checks for WebKit edge cases.
        }
        return element.contains(range.startContainer) || element.contains(range.endContainer);
      }

      function firstWordIndexAtOrAfterSelection(wordRanges, selectedRange) {
        if (!selectedRange) return 0;
        for (let index = 0; index < wordRanges.length; index += 1) {
          const rangeRecord = wordRanges[index];
          const doc = rangeRecord.node.ownerDocument;
          const wordRange = doc.createRange();
          wordRange.setStart(rangeRecord.node, rangeRecord.startOffset);
          wordRange.setEnd(rangeRecord.node, rangeRecord.endOffset);
          const comparison = wordRange.compareBoundaryPoints(wordRange.END_TO_START, selectedRange);
          if (wordRange.detach) wordRange.detach();
          if (comparison > 0) return index;
        }
        return -1;
      }

      function unwrapExistingWordMarkup(element) {
        Array.prototype.slice.call(element.querySelectorAll('[data-tts-word-id]')).forEach(function (node) {
          const parent = node.parentNode;
          if (!parent) return;
          while (node.firstChild) parent.insertBefore(node.firstChild, node);
          parent.removeChild(node);
        });
        element.removeAttribute('data-tts-paragraph-id');
      }

      function wrapWordRange(rangeRecord) {
        const doc = rangeRecord.node.ownerDocument;
        const range = doc.createRange();
        range.setStart(rangeRecord.node, rangeRecord.startOffset);
        range.setEnd(rangeRecord.node, rangeRecord.endOffset);
        const span = doc.createElement('span');
        span.setAttribute('data-tts-word-id', rangeRecord.wordId);
        try {
          range.surroundContents(span);
        } catch (error) {
          const contents = range.extractContents();
          span.appendChild(contents);
          range.insertNode(span);
        }
        if (range.detach) range.detach();
      }

      function ensureWordMarkup(element, paragraphId, wordRanges) {
        unwrapExistingWordMarkup(element);
        element.setAttribute('data-tts-paragraph-id', paragraphId);
        wordRanges.slice().reverse().forEach(wrapWordRange);
      }

      function contentTopOffset(content) {
        if (content && content.iframe && content.iframe.getBoundingClientRect) {
          return content.iframe.getBoundingClientRect().top;
        }
        return 0;
      }

      function hasNestedReadableBlock(element) {
        return Array.prototype.slice.call(element.querySelectorAll(blockSelector)).some(function (child) {
          return normalizeText(child.textContent).length >= minTextLength;
        });
      }

      function isVisibleCandidate(candidate) {
        const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
        return candidate.bottom > 0 && candidate.top < viewportHeight;
      }

      function candidateFromElement(contentIndex, content, element, elementIndex, startAtFirstVisibleWord, selectedRange) {
        if (hasNestedReadableBlock(element)) return null;
        if (selectedRange && !rangeIntersectsElement(selectedRange, element)) return null;
        let wordRanges = wordRangesForElement(content, element, startAtFirstVisibleWord);
        if (selectedRange) {
          const selectedStartIndex = firstWordIndexAtOrAfterSelection(wordRanges, selectedRange);
          if (selectedStartIndex < 0) return null;
          wordRanges = wordRanges.slice(selectedStartIndex);
        }
        const text = textFromRanges(wordRanges);
        if (text.length < minTextLength) return null;
        const rect = element.getBoundingClientRect();
        const firstWordRange = wordRanges[0];
        const lastWordRange = wordRanges[wordRanges.length - 1];
        const top = firstWordRange ? firstWordRange.top : rect.top + contentTopOffset(content);
        const bottom = lastWordRange ? lastWordRange.bottom : rect.bottom + contentTopOffset(content);
        const paragraphId = 'c' + contentIndex + '-e' + elementIndex;
        const words = wordRecordsFromRanges(wordRanges);
        if (words.length === 0) return null;
        return { contentIndex, elementIndex, paragraphId, text, words, top, bottom, element, wordRanges };
      }

      try {
        const contents = getRenditionContents();
        const candidates = [];
        contents.forEach(function (content, contentIndex) {
          const doc = content.document;
          if (!doc) return;
          const selectedRange = selectedRangeForContent(content);
          if (kind === 'selected' && !selectedRange) return;
          Array.prototype.slice.call(doc.querySelectorAll(blockSelector)).forEach(function (element, elementIndex) {
            const candidate = candidateFromElement(
              contentIndex,
              content,
              element,
              elementIndex,
              kind === 'visible',
              selectedRange
            );
            if (candidate) candidates.push(candidate);
          });
        });

        candidates.sort(function (a, b) {
          if (a.top !== b.top) return a.top - b.top;
          return a.elementIndex - b.elementIndex;
        });

        let selected = null;
        if (kind === 'next') {
          const orderedCandidates = candidates.slice().sort(function (a, b) {
            if (a.contentIndex !== b.contentIndex) return a.contentIndex - b.contentIndex;
            return a.elementIndex - b.elementIndex;
          });
          const currentIndex = orderedCandidates.findIndex(function (candidate) {
            return candidate.paragraphId === currentParagraphId;
          });
          if (currentIndex < 0 || !orderedCandidates[currentIndex + 1]) {
            send({ type: '${BRIDGE_EVENT_TYPES.missingNext}', requestId });
            return;
          }
          selected = orderedCandidates[currentIndex + 1];
        } else if (kind === 'selected') {
          selected = candidates[0];
        } else {
          selected = candidates.find(isVisibleCandidate);
        }

        if (!selected) {
          send({ type: '${BRIDGE_EVENT_TYPES.error}', requestId, message: 'Could not find readable text here.' });
          return;
        }

        ensureWordMarkup(selected.element, selected.paragraphId, selected.wordRanges);
        if (kind === 'selected') clearLiveSelections(contents);
        send({
          type: '${BRIDGE_EVENT_TYPES.paragraph}',
          requestId,
          paragraph: {
            paragraphId: selected.paragraphId,
            text: selected.text,
            words: selected.words
          }
        });
      } catch (error) {
        send({
          type: '${BRIDGE_EVENT_TYPES.error}',
          requestId,
          message: error && error.message ? error.message : 'Could not read text here.'
        });
      }
    })();
    true;
  `;
}
