/**
 * ctx-sync — Client-side docs search with CMD+K command palette
 * Loads a pre-built JSON search index and provides:
 *   - Sidebar inline search with instant results
 *   - CMD+K / Ctrl+K floating command palette
 *   - Keyboard navigation (arrow keys, enter, escape)
 *   - Fuzzy matching with scored results
 *   - Result type badges and highlighted terms
 * Vanilla JS — no frameworks.
 */

(function () {
  'use strict';

  var searchIndex = null;
  var sidebarSearchInput = null;
  var sidebarSearchResults = null;

  // CMD+K palette elements
  var paletteOverlay = null;
  var paletteInput = null;
  var paletteResults = null;
  var paletteActiveIndex = -1;

  // --- Load search index ---
  function loadSearchIndex() {
    return fetch('/docs/search-index.json')
      .then(function (res) {
        if (!res.ok) throw new Error('Failed to load search index');
        return res.json();
      })
      .then(function (data) {
        searchIndex = data;
      })
      .catch(function () {
        searchIndex = [];
      });
  }

  // --- Utility: escape HTML ---
  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // --- Utility: highlight matching text ---
  function highlightText(text, query) {
    if (!query) return escapeHtml(text);
    var escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    var regex = new RegExp('(' + escaped + ')', 'gi');
    return escapeHtml(text).replace(
      regex,
      '<span class="search-highlight">$1</span>'
    );
  }

  // --- Fuzzy search scoring ---
  function scoreResult(entry, query) {
    var lowerQuery = query.toLowerCase();
    var score = 0;

    // Exact title match (highest weight)
    if (entry.title.toLowerCase() === lowerQuery) {
      score += 100;
    }
    // Title contains query
    else if (entry.title.toLowerCase().indexOf(lowerQuery) !== -1) {
      score += 20;
    }

    // Heading exact match
    entry.headings.forEach(function (heading) {
      if (heading.toLowerCase() === lowerQuery) {
        score += 15;
      } else if (heading.toLowerCase().indexOf(lowerQuery) !== -1) {
        score += 5;
      }
    });

    // Snippet match
    if (entry.snippet.toLowerCase().indexOf(lowerQuery) !== -1) {
      score += 2;
    }

    // Fuzzy: check if all characters of query appear in order in title
    if (score === 0) {
      var titleLower = entry.title.toLowerCase();
      var qi = 0;
      for (var ci = 0; ci < titleLower.length && qi < lowerQuery.length; ci++) {
        if (titleLower[ci] === lowerQuery[qi]) {
          qi++;
        }
      }
      if (qi === lowerQuery.length) {
        score += 1;
      }
    }

    return score;
  }

  // --- Perform search and return scored results ---
  function getResults(query) {
    if (!searchIndex || !query || query.length < 2) return [];

    var results = [];
    searchIndex.forEach(function (entry) {
      var score = scoreResult(entry, query);
      if (score > 0) {
        results.push({ entry: entry, score: score });
      }
    });

    results.sort(function (a, b) {
      return b.score - a.score;
    });

    return results.slice(0, 8);
  }

  // --- Icon for each page category ---
  var categoryIcons = {
    'Getting Started': '&#9889;',
    'Core Reference': '&#9000;',
    'Security': '&#128274;',
    'Advanced': '&#128101;',
    'Help': '&#10067;',
    'Documentation': '&#128196;',
  };

  // === SIDEBAR SEARCH ===
  function performSidebarSearch(query) {
    if (!sidebarSearchResults) return;

    if (!query || query.length < 2) {
      sidebarSearchResults.innerHTML = '';
      return;
    }

    if (!searchIndex) {
      sidebarSearchResults.innerHTML =
        '<div class="search-result-item"><span class="result-snippet">Loading...</span></div>';
      return;
    }

    var results = getResults(query);

    if (results.length === 0) {
      sidebarSearchResults.innerHTML =
        '<div class="search-no-results">No results found</div>';
      return;
    }

    var html = results.map(function (r) {
      var title = highlightText(r.entry.title, query);
      var snippet = highlightText(
        r.entry.snippet.substring(0, 100),
        query
      );
      var badgeType = r.entry.accent === 'orange' ? 'security' :
                      r.entry.accent === 'green' ? 'reference' : 'guide';

      return (
        '<a href="/docs/' + r.entry.slug + '.html" class="search-result-item">' +
        '<div class="result-title">' + title +
        ' <span class="result-badge" data-type="' + badgeType + '">' +
        (r.entry.category || 'Docs') + '</span></div>' +
        '<div class="result-snippet">' + snippet + '</div>' +
        '</a>'
      );
    }).join('');

    sidebarSearchResults.innerHTML = html;
  }

  // === CMD+K COMMAND PALETTE ===
  function openPalette() {
    if (!paletteOverlay) return;
    paletteOverlay.classList.add('open');
    paletteInput.value = '';
    paletteResults.innerHTML = '';
    paletteActiveIndex = -1;

    // Show all pages as default
    renderPaletteResults(searchIndex || [], '');

    // Focus input after animation
    setTimeout(function () {
      paletteInput.focus();
    }, 50);
  }

  function closePalette() {
    if (!paletteOverlay) return;
    paletteOverlay.classList.remove('open');
    paletteActiveIndex = -1;
  }

  function renderPaletteResults(entries, query) {
    if (!paletteResults) return;

    var items;
    if (query && query.length >= 2) {
      items = getResults(query);
    } else {
      // Show all pages
      items = (entries || []).map(function (entry) {
        return { entry: entry, score: 0 };
      });
    }

    if (items.length === 0) {
      paletteResults.innerHTML = '';
      return;
    }

    var html = items.map(function (r, i) {
      var icon = categoryIcons[r.entry.category] || '&#128196;';
      var title = query ? highlightText(r.entry.title, query) : escapeHtml(r.entry.title);
      var desc = r.entry.snippet ? r.entry.snippet.substring(0, 80) : '';
      var activeClass = i === paletteActiveIndex ? ' active' : '';

      return (
        '<a href="/docs/' + r.entry.slug + '.html" class="cmd-palette-result' + activeClass + '" data-index="' + i + '">' +
        '<div class="cmd-palette-result-icon">' + icon + '</div>' +
        '<div class="cmd-palette-result-text">' +
        '<div class="cmd-palette-result-title">' + title + '</div>' +
        '<div class="cmd-palette-result-desc">' + escapeHtml(desc) + '</div>' +
        '</div>' +
        '</a>'
      );
    }).join('');

    paletteResults.innerHTML = html;
  }

  function navigatePaletteResults(direction) {
    var items = paletteResults.querySelectorAll('.cmd-palette-result');
    if (items.length === 0) return;

    // Remove current active
    if (paletteActiveIndex >= 0 && items[paletteActiveIndex]) {
      items[paletteActiveIndex].classList.remove('active');
    }

    paletteActiveIndex += direction;
    if (paletteActiveIndex < 0) paletteActiveIndex = items.length - 1;
    if (paletteActiveIndex >= items.length) paletteActiveIndex = 0;

    if (items[paletteActiveIndex]) {
      items[paletteActiveIndex].classList.add('active');
      items[paletteActiveIndex].scrollIntoView({ block: 'nearest' });
    }
  }

  function selectPaletteResult() {
    var items = paletteResults.querySelectorAll('.cmd-palette-result');
    if (paletteActiveIndex >= 0 && items[paletteActiveIndex]) {
      var href = items[paletteActiveIndex].getAttribute('href');
      if (href) {
        window.location.href = href;
      }
    }
  }

  // === INITIALIZATION ===
  document.addEventListener('DOMContentLoaded', function () {
    sidebarSearchInput = document.getElementById('docs-search-input');
    sidebarSearchResults = document.getElementById('docs-search-results');
    paletteOverlay = document.getElementById('cmd-palette-overlay');
    paletteInput = document.getElementById('cmd-palette-input');
    paletteResults = document.getElementById('cmd-palette-results');

    // Load search index
    loadSearchIndex();

    // --- Sidebar search ---
    if (sidebarSearchInput && sidebarSearchResults) {
      var debounceTimer = null;
      sidebarSearchInput.addEventListener('input', function () {
        var query = this.value.trim();
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(function () {
          performSidebarSearch(query);
        }, 200);
      });

      sidebarSearchInput.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') {
          this.value = '';
          sidebarSearchResults.innerHTML = '';
          this.blur();
        }
      });

      // Close results when clicking outside
      document.addEventListener('click', function (e) {
        if (
          sidebarSearchResults &&
          !sidebarSearchResults.contains(e.target) &&
          e.target !== sidebarSearchInput
        ) {
          sidebarSearchResults.innerHTML = '';
        }
      });
    }

    // --- CMD+K / Ctrl+K global shortcut ---
    document.addEventListener('keydown', function (e) {
      // CMD+K or Ctrl+K to open palette
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        if (paletteOverlay && paletteOverlay.classList.contains('open')) {
          closePalette();
        } else {
          openPalette();
        }
      }

      // Escape to close palette
      if (e.key === 'Escape' && paletteOverlay && paletteOverlay.classList.contains('open')) {
        closePalette();
      }
    });

    // --- Palette input handler ---
    if (paletteInput) {
      var paletteDebounce = null;
      paletteInput.addEventListener('input', function () {
        var query = this.value.trim();
        clearTimeout(paletteDebounce);
        paletteActiveIndex = -1;
        paletteDebounce = setTimeout(function () {
          renderPaletteResults(searchIndex || [], query);
        }, 100);
      });

      // Keyboard navigation in palette
      paletteInput.addEventListener('keydown', function (e) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          navigatePaletteResults(1);
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          navigatePaletteResults(-1);
        } else if (e.key === 'Enter') {
          e.preventDefault();
          selectPaletteResult();
        }
      });
    }

    // --- Click overlay to close palette ---
    if (paletteOverlay) {
      paletteOverlay.addEventListener('click', function (e) {
        if (e.target === paletteOverlay) {
          closePalette();
        }
      });
    }

    // --- Also open palette when clicking the sidebar search shortcut hint ---
    var shortcutHint = document.querySelector('.search-shortcut');
    if (shortcutHint) {
      shortcutHint.style.cursor = 'pointer';
      shortcutHint.addEventListener('click', function (e) {
        e.stopPropagation();
        openPalette();
      });
    }

  }); // end DOMContentLoaded
})();
