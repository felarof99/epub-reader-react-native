type ParagraphRequestKind = 'visible' | 'next';

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

export function createHighlightWordScript(paragraphId: string, wordId: string): string {
  return `
    (function () {
      const targetParagraphId = ${JSON.stringify(paragraphId)};
      const targetWordId = ${JSON.stringify(wordId)};
      const contents = window.rendition && window.rendition.getContents ? window.rendition.getContents() : [];
      contents.forEach(function (content) {
        const doc = content.document;
        if (!doc) return;
        doc.querySelectorAll('[data-tts-active-word="true"]').forEach(function (node) {
          node.removeAttribute('data-tts-active-word');
          node.style.backgroundColor = '';
          node.style.borderRadius = '';
        });
        const node = doc.querySelector('[data-tts-paragraph-id="' + targetParagraphId + '"] [data-tts-word-id="' + targetWordId + '"]');
        if (node) {
          node.setAttribute('data-tts-active-word', 'true');
          node.style.backgroundColor = 'rgba(184, 223, 255, 0.85)';
          node.style.borderRadius = '3px';
        }
      });
    })();
    true;
  `;
}

export function createClearHighlightScript(): string {
  return `
    (function () {
      const contents = window.rendition && window.rendition.getContents ? window.rendition.getContents() : [];
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
  currentParagraphId?: string,
): string {
  return `
    (function () {
      const requestId = ${JSON.stringify(requestId)};
      const kind = ${JSON.stringify(kind)};
      const currentParagraphId = ${JSON.stringify(currentParagraphId ?? '')};
      const blockSelector = 'p,h1,h2,h3,h4,h5,h6,li,blockquote';
      const minTextLength = 2;

      function send(payload) {
        window.ReactNativeWebView.postMessage(JSON.stringify(payload));
      }

      function normalizeText(text) {
        return (text || '').replace(/\\s+/g, ' ').trim();
      }

      function wordRecords(text) {
        const words = [];
        const pattern = /\\S+/g;
        let match;
        while ((match = pattern.exec(text)) !== null) {
          words.push({
            id: 'w' + words.length,
            text: match[0],
            startOffset: match.index,
            endOffset: match.index + match[0].length
          });
        }
        return words;
      }

      function ensureWordMarkup(element, paragraphId, words) {
        if (element.getAttribute('data-tts-paragraph-id') === paragraphId && element.querySelector('[data-tts-word-id]')) {
          return;
        }

        const text = normalizeText(element.textContent);
        element.setAttribute('data-tts-paragraph-id', paragraphId);
        element.innerHTML = '';
        words.forEach(function (word, index) {
          if (index > 0) element.appendChild(element.ownerDocument.createTextNode(' '));
          const span = element.ownerDocument.createElement('span');
          span.setAttribute('data-tts-word-id', word.id);
          span.textContent = word.text;
          element.appendChild(span);
        });
      }

      function contentTopOffset(content) {
        if (content && content.iframe && content.iframe.getBoundingClientRect) {
          return content.iframe.getBoundingClientRect().top;
        }
        return 0;
      }

      function candidateFromElement(contentIndex, content, element, elementIndex) {
        const text = normalizeText(element.textContent);
        if (text.length < minTextLength) return null;
        const rect = element.getBoundingClientRect();
        const top = rect.top + contentTopOffset(content);
        const bottom = rect.bottom + contentTopOffset(content);
        const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
        if (bottom <= 0 || top >= viewportHeight) return null;
        const paragraphId = 'c' + contentIndex + '-e' + elementIndex;
        const words = wordRecords(text);
        if (words.length === 0) return null;
        return { contentIndex, elementIndex, paragraphId, text, words, top, bottom, element };
      }

      try {
        const contents = window.rendition && window.rendition.getContents ? window.rendition.getContents() : [];
        const candidates = [];
        contents.forEach(function (content, contentIndex) {
          const doc = content.document;
          if (!doc) return;
          Array.prototype.slice.call(doc.querySelectorAll(blockSelector)).forEach(function (element, elementIndex) {
            const candidate = candidateFromElement(contentIndex, content, element, elementIndex);
            if (candidate) candidates.push(candidate);
          });
        });

        candidates.sort(function (a, b) {
          if (a.top !== b.top) return a.top - b.top;
          return a.elementIndex - b.elementIndex;
        });

        let selected = null;
        if (kind === 'next') {
          const currentIndex = candidates.findIndex(function (candidate) {
            return candidate.paragraphId === currentParagraphId;
          });
          if (currentIndex < 0 || !candidates[currentIndex + 1]) {
            send({ type: '${BRIDGE_EVENT_TYPES.missingNext}', requestId });
            return;
          }
          selected = candidates[currentIndex + 1];
        } else {
          selected = candidates.find(function (candidate) { return candidate.bottom > 0; });
        }

        if (!selected) {
          send({ type: '${BRIDGE_EVENT_TYPES.error}', requestId, message: 'Could not find readable text here.' });
          return;
        }

        ensureWordMarkup(selected.element, selected.paragraphId, selected.words);
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
