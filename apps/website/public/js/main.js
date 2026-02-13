/**
 * ctx-sync — Main site JavaScript
 * Scroll-triggered reveals, header effects, mobile nav, theme toggle,
 * copy-to-clipboard, and terminal typing animation.
 * Vanilla JS — no frameworks.
 */

(function () {
  'use strict';

  /* ===========================================================
     1. DARK / LIGHT MODE TOGGLE
     =========================================================== */
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
    var icons = document.querySelectorAll('.theme-icon');
    icons.forEach(function (icon) {
      icon.textContent = theme === 'light' ? '\u2600\uFE0F' : '\uD83C\uDF19';
    });
  }

  // Apply immediately (before DOMContentLoaded to prevent flash)
  applyTheme(getPreferredTheme());

  /* ===========================================================
     2. DOM-READY SETUP
     =========================================================== */
  document.addEventListener('DOMContentLoaded', function () {

    /* ---------------------------------------------------------
       2a. Theme toggle buttons
       --------------------------------------------------------- */
    document.querySelectorAll('.theme-toggle').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var current = document.documentElement.getAttribute('data-theme');
        applyTheme(current === 'light' ? 'dark' : 'light');
      });
    });

    /* ---------------------------------------------------------
       2b. Mobile navigation toggle
       --------------------------------------------------------- */
    var mobileToggle = document.getElementById('mobile-nav-toggle');
    var mainNav = document.getElementById('main-nav');

    if (mobileToggle && mainNav) {
      mobileToggle.addEventListener('click', function () {
        mainNav.classList.toggle('open');
      });

      mainNav.querySelectorAll('a').forEach(function (link) {
        link.addEventListener('click', function () {
          mainNav.classList.remove('open');
        });
      });
    }

    /* ---------------------------------------------------------
       2c. Smooth scrolling for anchor links
       --------------------------------------------------------- */
    document.querySelectorAll('a[href^="#"]').forEach(function (anchor) {
      anchor.addEventListener('click', function (e) {
        var targetId = this.getAttribute('href');
        if (!targetId || targetId === '#') return;

        var target = document.querySelector(targetId);
        if (target) {
          e.preventDefault();
          var headerH = 80;
          var top =
            target.getBoundingClientRect().top + window.pageYOffset - headerH;
          window.scrollTo({ top: top, behavior: 'smooth' });
        }
      });
    });

    /* ---------------------------------------------------------
       2d. Copy to clipboard
       --------------------------------------------------------- */
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
            var original = label ? label.textContent : '';
            if (label) label.textContent = 'Copied!';

            setTimeout(function () {
              button.classList.remove('copied');
              if (label) label.textContent = original || 'Copy';
            }, 2000);
          })
          .catch(function () {
            // Fallback for older browsers
            var temp = document.createElement('textarea');
            temp.value = text;
            temp.style.position = 'fixed';
            temp.style.opacity = '0';
            document.body.appendChild(temp);
            temp.select();
            document.execCommand('copy');
            document.body.removeChild(temp);
          });
      });
    });

    /* ---------------------------------------------------------
       2e. Header scroll effect — adds .scrolled class
       --------------------------------------------------------- */
    var header = document.getElementById('site-header');
    if (header) {
      var lastScroll = 0;
      function onScroll() {
        var scrollY = window.scrollY || window.pageYOffset;
        if (scrollY > 20) {
          header.classList.add('scrolled');
        } else {
          header.classList.remove('scrolled');
        }
        lastScroll = scrollY;
      }
      window.addEventListener('scroll', onScroll, { passive: true });
      onScroll(); // Run on load
    }

    /* ---------------------------------------------------------
       2f. Scroll-triggered reveal animations (IntersectionObserver)
       --------------------------------------------------------- */
    var revealSelectors = '.reveal, .reveal-left, .reveal-right, .reveal-scale, .stagger-children';
    var revealEls = document.querySelectorAll(revealSelectors);

    if (revealEls.length > 0 && 'IntersectionObserver' in window) {
      var revealObserver = new IntersectionObserver(
        function (entries) {
          entries.forEach(function (entry) {
            if (entry.isIntersecting) {
              entry.target.classList.add('is-visible');
              revealObserver.unobserve(entry.target);
            }
          });
        },
        {
          threshold: 0.12,
          rootMargin: '0px 0px -40px 0px',
        }
      );

      revealEls.forEach(function (el) {
        revealObserver.observe(el);
      });
    } else {
      // Fallback: just show everything
      revealEls.forEach(function (el) {
        el.classList.add('is-visible');
      });
    }

    /* ---------------------------------------------------------
       2g. Card tilt / 3D hover effect on feature cards
       --------------------------------------------------------- */
    var featureCards = document.querySelectorAll('.feature-card');
    featureCards.forEach(function (card) {
      card.addEventListener('mousemove', function (e) {
        var rect = card.getBoundingClientRect();
        var x = e.clientX - rect.left;
        var y = e.clientY - rect.top;
        var centerX = rect.width / 2;
        var centerY = rect.height / 2;

        // Mild tilt: max 3deg
        var rotateX = ((y - centerY) / centerY) * -2.5;
        var rotateY = ((x - centerX) / centerX) * 2.5;

        card.style.transform =
          'translateY(-4px) perspective(800px) rotateX(' +
          rotateX +
          'deg) rotateY(' +
          rotateY +
          'deg)';
      });

      card.addEventListener('mouseleave', function () {
        card.style.transform = '';
      });
    });

    /* ---------------------------------------------------------
       2h. Terminal typing animation (on page load, hero terminal)
       --------------------------------------------------------- */
    // The terminal content is already in the HTML for SSR/noscript.
    // We enhance it with a subtle line-by-line fade-in on load.
    var terminalBody = document.getElementById('terminal-body');
    if (terminalBody) {
      var lines = terminalBody.querySelectorAll('.line');
      lines.forEach(function (line, i) {
        line.style.opacity = '0';
        line.style.transform = 'translateX(-8px)';
        line.style.transition =
          'opacity 0.3s cubic-bezier(0.16,1,0.3,1), transform 0.3s cubic-bezier(0.16,1,0.3,1)';
        line.style.transitionDelay = 0.6 + i * 0.1 + 's';
      });

      // Force a reflow, then reveal
      void terminalBody.offsetWidth;
      lines.forEach(function (line) {
        line.style.opacity = '1';
        line.style.transform = 'translateX(0)';
      });
    }

  }); // end DOMContentLoaded
})();
