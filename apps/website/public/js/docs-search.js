/**
 * ctx-sync — Client-side docs search
 * Loads a pre-built JSON search index and provides instant search results.
 * Vanilla JS — no frameworks.
 */

(function () {
  'use strict';

  var searchIndex = null;
  var searchInput = null;
  var searchResults = null;

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
        // Silently fail — search just won't work
        searchIndex = [];
      });
  }

  function highlightText(text, query) {
    if (!query) return escapeHtml(text);
    var escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    var regex = new RegExp('(' + escaped + ')', 'gi');
    return escapeHtml(text).replace(
      regex,
      '<span class="search-highlight">$1</span>'
    );
  }

  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function performSearch(query) {
    if (!searchResults) return;

    if (!query || query.length < 2) {
      searchResults.innerHTML = '';
      return;
    }

    if (!searchIndex) {
      searchResults.innerHTML =
        '<div class="search-result-item"><span class="result-snippet">Loading search index...</span></div>';
      return;
    }

    var lowerQuery = query.toLowerCase();
    var results = [];

    searchIndex.forEach(function (entry) {
      var score = 0;

      // Title match (highest weight)
      if (entry.title.toLowerCase().indexOf(lowerQuery) !== -1) {
        score += 10;
      }

      // Heading match
      entry.headings.forEach(function (heading) {
        if (heading.toLowerCase().indexOf(lowerQuery) !== -1) {
          score += 5;
        }
      });

      // Snippet match
      if (entry.snippet.toLowerCase().indexOf(lowerQuery) !== -1) {
        score += 2;
      }

      if (score > 0) {
        results.push({ entry: entry, score: score });
      }
    });

    // Sort by score descending
    results.sort(function (a, b) {
      return b.score - a.score;
    });

    if (results.length === 0) {
      searchResults.innerHTML =
        '<div class="search-result-item"><span class="result-snippet">No results found</span></div>';
      return;
    }

    var html = results
      .slice(0, 8)
      .map(function (r) {
        var title = highlightText(r.entry.title, query);
        var snippet = highlightText(
          r.entry.snippet.substring(0, 100),
          query
        );
        return (
          '<a href="/docs/' +
          r.entry.slug +
          '.html" class="search-result-item">' +
          '<div class="result-title">' +
          title +
          '</div>' +
          '<div class="result-snippet">' +
          snippet +
          '</div>' +
          '</a>'
        );
      })
      .join('');

    searchResults.innerHTML = html;
  }

  document.addEventListener('DOMContentLoaded', function () {
    searchInput = document.getElementById('docs-search-input');
    searchResults = document.getElementById('docs-search-results');

    if (!searchInput || !searchResults) return;

    // Load search index
    loadSearchIndex();

    // Debounced search
    var debounceTimer = null;
    searchInput.addEventListener('input', function () {
      var query = this.value.trim();
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(function () {
        performSearch(query);
      }, 200);
    });

    // Close results on escape
    searchInput.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        this.value = '';
        searchResults.innerHTML = '';
        this.blur();
      }
    });

    // Close results when clicking outside
    document.addEventListener('click', function (e) {
      if (
        searchResults &&
        !searchResults.contains(e.target) &&
        e.target !== searchInput
      ) {
        searchResults.innerHTML = '';
      }
    });
  });
})();
