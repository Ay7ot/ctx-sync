/**
 * ctx-sync — Docs sidebar navigation
 * Active page highlighting, mobile sidebar toggle, collapsible sections.
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
        !sidebarToggle.contains(e.target)
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
  });
})();
