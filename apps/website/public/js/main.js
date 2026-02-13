/**
 * ctx-sync — Main site JavaScript
 * Smooth scrolling, mobile nav, dark/light mode, copy-to-clipboard.
 * Vanilla JS — no frameworks.
 */

(function () {
  'use strict';

  // --- Dark / Light Mode Toggle ---
  var THEME_KEY = 'ctx-sync-theme';

  function getPreferredTheme() {
    var saved = localStorage.getItem(THEME_KEY);
    if (saved) return saved;
    return window.matchMedia('(prefers-color-scheme: light)').matches
      ? 'light'
      : 'dark';
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem(THEME_KEY, theme);

    // Update toggle icon
    var icons = document.querySelectorAll('.theme-icon');
    icons.forEach(function (icon) {
      icon.textContent = theme === 'light' ? '\u2600\uFE0F' : '\uD83C\uDF19';
    });
  }

  // Apply on load
  applyTheme(getPreferredTheme());

  document.addEventListener('DOMContentLoaded', function () {
    // Theme toggles
    var toggles = document.querySelectorAll('.theme-toggle');
    toggles.forEach(function (btn) {
      btn.addEventListener('click', function () {
        var current = document.documentElement.getAttribute('data-theme');
        applyTheme(current === 'light' ? 'dark' : 'light');
      });
    });

    // --- Mobile Nav Toggle ---
    var mobileToggle = document.getElementById('mobile-nav-toggle');
    var mainNav = document.getElementById('main-nav');

    if (mobileToggle && mainNav) {
      mobileToggle.addEventListener('click', function () {
        mainNav.classList.toggle('open');
      });

      // Close on link click
      mainNav.querySelectorAll('a').forEach(function (link) {
        link.addEventListener('click', function () {
          mainNav.classList.remove('open');
        });
      });
    }

    // --- Smooth Scrolling for Anchor Links ---
    document.querySelectorAll('a[href^="#"]').forEach(function (anchor) {
      anchor.addEventListener('click', function (e) {
        var targetId = this.getAttribute('href');
        if (!targetId || targetId === '#') return;

        var target = document.querySelector(targetId);
        if (target) {
          e.preventDefault();
          var headerHeight = 70;
          var top =
            target.getBoundingClientRect().top + window.pageYOffset - headerHeight;
          window.scrollTo({ top: top, behavior: 'smooth' });
        }
      });
    });

    // --- Copy to Clipboard ---
    document.querySelectorAll('.copy-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var text = this.getAttribute('data-copy');
        if (!text) return;

        var button = this;
        navigator.clipboard
          .writeText(text)
          .then(function () {
            button.classList.add('copied');
            var label = button.querySelector('.copy-label');
            var originalText = label ? label.textContent : '';
            if (label) label.textContent = 'Copied!';

            setTimeout(function () {
              button.classList.remove('copied');
              if (label) label.textContent = originalText || 'Copy';
            }, 2000);
          })
          .catch(function () {
            // Fallback: select text
            var temp = document.createElement('textarea');
            temp.value = text;
            document.body.appendChild(temp);
            temp.select();
            document.execCommand('copy');
            document.body.removeChild(temp);
          });
      });
    });

    // --- Header Scroll Effect ---
    var header = document.getElementById('site-header');
    if (header) {
      var scrolled = false;
      window.addEventListener('scroll', function () {
        if (window.scrollY > 10 && !scrolled) {
          header.style.borderBottomColor = 'var(--border-color)';
          scrolled = true;
        } else if (window.scrollY <= 10 && scrolled) {
          header.style.borderBottomColor = 'var(--border-subtle)';
          scrolled = false;
        }
      });
    }
  });
})();
