import { HIGHLIGHT_PALETTE } from '../highlights';

const RAIL_CSS = `
  .rn-hl-sent {
    border-radius: 3px;
    transition: background-color 120ms ease;
  }

  .rn-hl-sent.rn-hl-pending {
    background: rgba(110, 118, 129, 0.22);
  }

  .rn-hl-rail {
    display: none;
    position: absolute;
    top: 0;
    right: 3px;
    width: 26px;
    min-height: 100%;
    pointer-events: none;
    z-index: 2147483647;
  }

  body.rn-hl-note-mode .rn-hl-rail {
    display: block;
  }

  .rn-hl-dot {
    position: absolute;
    right: 5px;
    width: 13px;
    height: 13px;
    margin: 0;
    padding: 0;
    border-radius: 999px;
    border: 1.5px solid rgba(118, 118, 118, 0.72);
    background: rgba(255, 255, 255, 0.82);
    pointer-events: auto;
    box-sizing: border-box;
    -webkit-appearance: none;
    appearance: none;
  }

  .rn-hl-dot.rn-hl-pending {
    border-color: rgba(85, 85, 85, 0.95);
    background: rgba(85, 85, 85, 0.82);
  }

  .rn-hl-dot[data-color="cyan"] {
    border-color: ${HIGHLIGHT_PALETTE.cyan.hex};
    background: ${HIGHLIGHT_PALETTE.cyan.hex};
  }

  .rn-hl-dot[data-color="green"] {
    border-color: ${HIGHLIGHT_PALETTE.green.hex};
    background: ${HIGHLIGHT_PALETTE.green.hex};
  }

  .rn-hl-dot[data-color="yellow"] {
    border-color: ${HIGHLIGHT_PALETTE.yellow.hex};
    background: ${HIGHLIGHT_PALETTE.yellow.hex};
  }

  .rn-hl-dot[data-color="red"] {
    border-color: ${HIGHLIGHT_PALETTE.red.hex};
    background: ${HIGHLIGHT_PALETTE.red.hex};
  }
`;

export function createHighlightRailScript(): string {
  return `
    (function () {
      if (window.__rnHighlightRail && window.__rnHighlightRail.version === 2) {
        window.__rnHighlightRail.processAll();
        true;
        return;
      }

      const railCss = ${JSON.stringify(RAIL_CSS)};
      const readableBlockSelector = 'p,h1,h2,h3,h4,h5,h6,li,blockquote,div,section,article,main,td,th,dd,dt';
      const minTextLength = 2;
      const state = {
        version: 2,
        noteMode: false,
        anchor: null,
        selectedIds: [],
        highlightMap: {},
        sections: {},
      };

      function post(message) {
        try {
          const target = window.ReactNativeWebView !== undefined && window.ReactNativeWebView !== null
            ? window.ReactNativeWebView
            : window;
          target.postMessage(JSON.stringify(message));
        } catch (error) {
          // There is nowhere better to report bridge failures from inside the WebView.
        }
      }

      function log(level, message) {
        post({ type: 'highlight-log', level: level, message: String(message) });
      }

      function getContentsList() {
        try {
          if (typeof rendition === 'undefined' || !rendition || typeof rendition.getContents !== 'function') return [];
          return rendition.getContents() || [];
        } catch (error) {
          log('warn', error && error.message ? error.message : error);
          return [];
        }
      }

      function docKeyFor(contents, doc) {
        const section = contents && contents.section;
        return (section && (section.href || section.id)) || doc.location.href || 'current-section';
      }

      function installStyle(doc) {
        if (doc.getElementById('rn-highlight-rail-style')) return;

        const style = doc.createElement('style');
        style.id = 'rn-highlight-rail-style';
        style.textContent = railCss;
        (doc.head || doc.documentElement).appendChild(style);
      }

      function normalizeText(text) {
        return (text || '').replace(/\\s+/g, ' ').trim();
      }

      function hasNestedReadableBlock(element) {
        return Array.prototype.slice.call(element.querySelectorAll(readableBlockSelector)).some(function (child) {
          return normalizeText(child.textContent).length >= minTextLength;
        });
      }

      function selectableBlocks(doc) {
        return Array.prototype.slice.call(
          doc.querySelectorAll(readableBlockSelector)
        ).filter(function (node) {
          return (
            node &&
            normalizeText(node.textContent).length >= minTextLength &&
            !hasNestedReadableBlock(node)
          );
        });
      }

      function shouldSkipTextNode(node) {
        if (!node || !node.nodeValue || node.nodeValue.trim().length < 2) return true;
        const parent = node.parentElement;
        if (!parent) return true;
        if (parent.closest('.rn-hl-sent')) return true;
        if (parent.closest('script, style, svg, math, audio, video, textarea, input')) return true;
        return false;
      }

      function splitSentences(text) {
        const matches = text.match(/[^.!?]+[.!?]+["')\\]]*\\s*|[^.!?]+$/g);
        return matches && matches.length > 0 ? matches : [text];
      }

      function wrapBlockText(block, doc) {
        const walker = doc.createTreeWalker(
          block,
          4,
          {
            acceptNode: function (node) {
              return shouldSkipTextNode(node) ? 2 : 1;
            },
          }
        );
        const nodes = [];
        while (walker.nextNode()) nodes.push(walker.currentNode);

        nodes.forEach(function (node) {
          const parts = splitSentences(node.nodeValue || '');
          if (parts.length <= 1) return;

          const fragment = doc.createDocumentFragment();
          parts.forEach(function (part) {
            if (part.trim().length < 2) {
              fragment.appendChild(doc.createTextNode(part));
              return;
            }

            const span = doc.createElement('span');
            span.className = 'rn-hl-sent';
            span.textContent = part;
            fragment.appendChild(span);
          });

          if (node.parentNode) node.parentNode.replaceChild(fragment, node);
        });
      }

      function ensureWholeBlockSpans(block, doc) {
        if (block.querySelector('.rn-hl-sent')) return;
        const text = block.textContent || '';
        if (text.trim().length < 2) return;

        const span = doc.createElement('span');
        span.className = 'rn-hl-sent';
        while (block.firstChild) span.appendChild(block.firstChild);
        block.appendChild(span);
      }

      function cfiForElement(contents, element) {
        try {
          const doc = element.ownerDocument;
          const range = doc.createRange();
          range.selectNodeContents(element);
          return contents.cfiFromRange(range);
        } catch (error) {
          return null;
        }
      }

      function cfiForChunkRange(sectionData, chunks) {
        try {
          if (!chunks || chunks.length === 0) return null;
          const doc = sectionData.doc;
          const range = doc.createRange();
          range.setStartBefore(chunks[0].element);
          range.setEndAfter(chunks[chunks.length - 1].element);
          return sectionData.contents.cfiFromRange(range);
        } catch (error) {
          log('warn', error && error.message ? error.message : error);
          return null;
        }
      }

      function buildChunks(contents, doc, docKey) {
        selectableBlocks(doc).forEach(function (block) {
          wrapBlockText(block, doc);
          ensureWholeBlockSpans(block, doc);
        });

        return Array.prototype.slice.call(doc.querySelectorAll('.rn-hl-sent')).map(function (element, index) {
          const id = docKey + '#' + String(index).padStart(5, '0');
          element.dataset.rnHlSid = id;
          element.dataset.rnHlOrder = String(index);

          return {
            id: id,
            order: index,
            text: normalizeText(element.textContent),
            cfiRange: cfiForElement(contents, element),
            element: element,
            dot: null,
          };
        }).filter(function (chunk) {
          return chunk.text.length > 0;
        });
      }

      function ensureRail(doc) {
        let rail = doc.querySelector('.rn-hl-rail');
        if (rail) return rail;

        rail = doc.createElement('div');
        rail.className = 'rn-hl-rail';
        doc.body.appendChild(rail);
        return rail;
      }

      function renderRail(sectionData) {
        const doc = sectionData.doc;
        const win = doc.defaultView || window;
        const rail = ensureRail(doc);
        rail.innerHTML = '';

        sectionData.chunks.forEach(function (chunk) {
          const rects = chunk.element.getClientRects();
          const rect = rects && rects.length > 0 ? rects[0] : chunk.element.getBoundingClientRect();
          if (!rect || !Number.isFinite(rect.top)) return;

          const dot = doc.createElement('button');
          dot.type = 'button';
          dot.className = 'rn-hl-dot';
          dot.dataset.sid = chunk.id;
          dot.style.top = Math.max(0, rect.top + (win.scrollY || 0)) + 'px';
          dot.setAttribute('aria-label', 'Select text chunk');
          dot.addEventListener('click', function (event) {
            event.preventDefault();
            event.stopPropagation();
            handleDotPress(sectionData.docKey, chunk.order);
          });
          rail.appendChild(dot);
          chunk.dot = dot;
        });

        applyVisualState();
      }

      function processContents(contents) {
        const doc = contents && contents.document;
        if (!doc || !doc.body) return;

        installStyle(doc);
        if (!doc.body.style.position) doc.body.style.position = 'relative';
        doc.body.classList.toggle('rn-hl-note-mode', state.noteMode);

        const docKey = docKeyFor(contents, doc);
        let sectionData = state.sections[docKey];
        if (!sectionData) {
          const chunks = buildChunks(contents, doc, docKey);
          sectionData = {
            docKey: docKey,
            contents: contents,
            doc: doc,
            chunks: chunks,
          };
          state.sections[docKey] = sectionData;
          post({ type: 'rail-ready', sectionHref: docKey, sentenceCount: chunks.length });
        }

        renderRail(sectionData);
      }

      function processAll() {
        getContentsList().forEach(processContents);
      }

      function selectedChunkObjects() {
        if (!state.anchor) return [];
        const sectionData = state.sections[state.anchor.docKey];
        if (!sectionData) return [];

        const selected = new Set(state.selectedIds);
        return sectionData.chunks.filter(function (chunk) {
          return selected.has(chunk.id);
        });
      }

      function clearPendingClasses() {
        Object.keys(state.sections).forEach(function (key) {
          state.sections[key].chunks.forEach(function (chunk) {
            chunk.element.classList.remove('rn-hl-pending');
            if (chunk.dot) chunk.dot.classList.remove('rn-hl-pending');
          });
        });
      }

      function applyVisualState() {
        Object.keys(state.sections).forEach(function (key) {
          const sectionData = state.sections[key];
          const selected = new Set(state.selectedIds);

          sectionData.doc.body.classList.toggle('rn-hl-note-mode', state.noteMode);
          sectionData.chunks.forEach(function (chunk) {
            const color = state.highlightMap[chunk.id];
            chunk.element.classList.toggle('rn-hl-pending', selected.has(chunk.id));
            if (chunk.dot) {
              chunk.dot.classList.toggle('rn-hl-pending', selected.has(chunk.id));
              if (color) {
                chunk.dot.dataset.color = color;
              } else {
                delete chunk.dot.dataset.color;
              }
            }
          });
        });
      }

      function emitSelection() {
        const chunks = selectedChunkObjects();
        const sectionData = state.anchor ? state.sections[state.anchor.docKey] : null;
        const cfiRange = sectionData ? cfiForChunkRange(sectionData, chunks) : null;

        post({
          type: 'selection-changed',
          sentenceIds: chunks.map(function (chunk) { return chunk.id; }),
          cfiRanges: cfiRange ? [cfiRange] : chunks.map(function (chunk) { return chunk.cfiRange; }).filter(Boolean),
          selectedText: chunks.map(function (chunk) { return chunk.text; }).join(' ').replace(/\\s+/g, ' ').trim(),
          chunks: chunks.map(function (chunk) {
            return {
              id: chunk.id,
              cfiRange: chunk.cfiRange || undefined,
              text: chunk.text,
              order: chunk.order,
            };
          }),
        });
      }

      function clearPending() {
        state.anchor = null;
        state.selectedIds = [];
        clearPendingClasses();
        emitSelection();
      }

      function handleDotPress(docKey, order) {
        if (!state.noteMode) return;

        const sectionData = state.sections[docKey];
        if (!sectionData) return;

        if (
          state.anchor &&
          state.anchor.docKey === docKey &&
          state.anchor.order === order &&
          state.selectedIds.length === 1
        ) {
          clearPending();
          return;
        }

        if (!state.anchor || state.anchor.docKey !== docKey) {
          state.anchor = { docKey: docKey, order: order };
          state.selectedIds = sectionData.chunks
            .filter(function (chunk) { return chunk.order === order; })
            .map(function (chunk) { return chunk.id; });
        } else {
          const start = Math.min(state.anchor.order, order);
          const end = Math.max(state.anchor.order, order);
          state.selectedIds = sectionData.chunks
            .filter(function (chunk) { return chunk.order >= start && chunk.order <= end; })
            .map(function (chunk) { return chunk.id; });
        }

        applyVisualState();
        emitSelection();
      }

      function setNoteMode(enabled) {
        state.noteMode = !!enabled;
        if (!state.noteMode) {
          state.anchor = null;
          state.selectedIds = [];
        }
        processAll();
        applyVisualState();
        if (!state.noteMode) emitSelection();
      }

      function setHighlights(highlights) {
        state.highlightMap = {};
        (Array.isArray(highlights) ? highlights : []).forEach(function (highlight) {
          const color = highlight && highlight.color;
          const ids = highlight && Array.isArray(highlight.sentenceIds) ? highlight.sentenceIds : [];
          ids.forEach(function (id) {
            state.highlightMap[id] = color;
          });
        });
        applyVisualState();
      }

      function applyHighlight(highlight) {
        if (!highlight || !Array.isArray(highlight.sentenceIds)) return;
        highlight.sentenceIds.forEach(function (id) {
          state.highlightMap[id] = highlight.color;
        });
        applyVisualState();
      }

      function removeHighlight(highlight) {
        if (!highlight || !Array.isArray(highlight.sentenceIds)) return;
        highlight.sentenceIds.forEach(function (id) {
          delete state.highlightMap[id];
        });
        applyVisualState();
      }

      window.__rnHighlightRail = {
        version: 2,
        processAll: processAll,
        setNoteMode: setNoteMode,
        clearPending: clearPending,
        setHighlights: setHighlights,
        applyHighlight: applyHighlight,
        removeHighlight: removeHighlight,
      };

      if (typeof rendition !== 'undefined' && rendition && typeof rendition.on === 'function') {
        rendition.on('rendered', function () {
          setTimeout(processAll, 0);
        });
        rendition.on('relocated', function () {
          setTimeout(processAll, 0);
        });
      }

      window.addEventListener('resize', function () {
        setTimeout(processAll, 50);
      });

      setTimeout(processAll, 0);
    })();
    true;
  `;
}
