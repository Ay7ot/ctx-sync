/**
 * ctx-sync — Docs navigation & interactive enhancements
 * Active page highlighting, mobile sidebar toggle, scroll progress bar,
 * header scroll effects, back-to-top button, code block copy buttons,
 * and smooth scroll for anchor links.
 * Vanilla JS — no frameworks.
 */

(function () {
  'use strict';

  document.addEventListener('DOMContentLoaded', function () {
    var sidebar = document.getElementById('docs-sidebar');
    var sidebarToggle = document.getElementById('sidebar-toggle');
    var sidebarClose = document.getElementById('sidebar-close');

    // --- Mobile Sidebar Toggle ---
    if (sidebarToggle && sidebar) {
      sidebarToggle.addEventListener('click', function () {
        sidebar.classList.toggle('open');
      });
    }

    if (sidebarClose && sidebar) {
      sidebarClose.addEventListener('click', function () {
        sidebar.classList.remove('open');
      });
    }

    // Close sidebar when clicking outside on mobile
    document.addEventListener('click', function (e) {
      if (!sidebar) return;
      if (
        sidebar.classList.contains('open') &&
        !sidebar.contains(e.target) &&
        e.target !== sidebarToggle &&
        (!sidebarToggle || !sidebarToggle.contains(e.target))
      ) {
        sidebar.classList.remove('open');
      }
    });

    // --- Active Page Highlighting ---
    var currentPath = window.location.pathname;
    var navLinks = document.querySelectorAll('.sidebar-nav-list li a');

    navLinks.forEach(function (link) {
      var href = link.getAttribute('href');
      if (href && currentPath.endsWith(href.replace(/^\//, ''))) {
        link.parentElement.classList.add('active');
      } else if (href === currentPath) {
        link.parentElement.classList.add('active');
      }
    });

    // --- Close sidebar on nav link click (mobile) ---
    navLinks.forEach(function (link) {
      link.addEventListener('click', function () {
        if (sidebar && sidebar.classList.contains('open')) {
          sidebar.classList.remove('open');
        }
      });
    });

    // --- Header scroll effect ---
    var docsHeader = document.getElementById('docs-header');
    if (docsHeader) {
      function onHeaderScroll() {
        if (window.scrollY > 20) {
          docsHeader.classList.add('scrolled');
        } else {
          docsHeader.classList.remove('scrolled');
        }
      }
      window.addEventListener('scroll', onHeaderScroll, { passive: true });
      onHeaderScroll();
    }

    // --- Scroll Progress Bar ---
    var progressFill = document.getElementById('progress-fill');
    if (progressFill) {
      function updateProgress() {
        var scrollTop = window.scrollY || document.documentElement.scrollTop;
        var docHeight = document.documentElement.scrollHeight - window.innerHeight;
        if (docHeight > 0) {
          var progress = Math.min((scrollTop / docHeight) * 100, 100);
          progressFill.style.width = progress + '%';
        }
      }
      window.addEventListener('scroll', updateProgress, { passive: true });
      updateProgress();
    }

    // --- Back to Top Button ---
    var backToTop = document.getElementById('back-to-top');
    if (backToTop) {
      function updateBackToTop() {
        if (window.scrollY > 400) {
          backToTop.classList.add('visible');
        } else {
          backToTop.classList.remove('visible');
        }
      }
      window.addEventListener('scroll', updateBackToTop, { passive: true });
      updateBackToTop();

      backToTop.addEventListener('click', function () {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
    }

    // --- Code Block Copy Buttons ---
    document.querySelectorAll('.code-copy-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var pre = btn.closest('pre');
        if (!pre) return;
        var codeEl = pre.querySelector('code');
        if (!codeEl) return;

        var text = codeEl.textContent || '';
        var button = btn;

        navigator.clipboard
          .writeText(text)
          .then(function () {
            button.classList.add('copied');
            button.innerHTML =
              '<svg class="copy-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M20 6L9 17l-5-5"/></svg> Copied!';

            setTimeout(function () {
              button.classList.remove('copied');
              button.innerHTML =
                '<svg class="copy-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copy';
            }, 2000);
          })
          .catch(function () {
            // Fallback
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

    // --- Smooth scrolling for anchor links ---
    document.querySelectorAll('.docs-article a[href^="#"], .docs-toc a[href^="#"]').forEach(function (anchor) {
      anchor.addEventListener('click', function (e) {
        var targetId = this.getAttribute('href');
        if (!targetId || targetId === '#') return;

        var target = document.querySelector(targetId);
        if (target) {
          e.preventDefault();
          var headerH = 80;
          var top = target.getBoundingClientRect().top + window.pageYOffset - headerH;
          window.scrollTo({ top: top, behavior: 'smooth' });

          // Update URL hash without scrolling
          if (history.pushState) {
            history.pushState(null, '', targetId);
          }
        }
      });
    });

    // --- Right Sidebar TOC Scroll-Spy ---
    // Highlights the TOC link matching the currently visible section
    var tocLinks = document.querySelectorAll('.docs-toc-sidebar .docs-toc a');
    if (tocLinks.length > 0) {
      var tocTargets = [];
      tocLinks.forEach(function (link) {
        var id = link.getAttribute('href');
        if (id && id.startsWith('#')) {
          var el = document.getElementById(id.slice(1));
          if (el) tocTargets.push({ el: el, link: link });
        }
      });

      function updateTocActive() {
        var scrollPos = window.scrollY + 100; // offset for header
        var current = null;

        for (var i = 0; i < tocTargets.length; i++) {
          if (tocTargets[i].el.offsetTop <= scrollPos) {
            current = tocTargets[i];
          }
        }

        tocLinks.forEach(function (link) {
          link.classList.remove('active');
        });

        if (current) {
          current.link.classList.add('active');
        }
      }

      window.addEventListener('scroll', updateTocActive, { passive: true });
      updateTocActive();
    }

  }); // end DOMContentLoaded
})();
