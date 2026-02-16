/**
 * build-docs.ts — Converts Markdown files in content/ to HTML docs pages.
 *
 * Reads each .md file from content/, converts to HTML via `marked`,
 * wraps in a shared layout template, writes to public/docs/<slug>.html,
 * generates accent-coded sidebar navigation with section categories,
 * produces a search index JSON file, and adds:
 *   - Breadcrumbs with decorative separators
 *   - Page metadata (reading time, last updated)
 *   - Table of contents per page
 *   - Enhanced code blocks with language badges and copy buttons
 *   - Callout/admonition parsing (:::info, :::warning, :::tip, etc.)
 *   - Accent-colored docs index cards
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { marked } from 'marked';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const CONTENT_DIR = path.join(ROOT, 'content');
const DOCS_OUT_DIR = path.join(ROOT, 'public', 'docs');
const SEARCH_INDEX_PATH = path.join(DOCS_OUT_DIR, 'search-index.json');

/** Represents a single documentation page. */
interface DocPage {
  slug: string;
  title: string;
  headings: Array<{ level: number; text: string; id: string }>;
  content: string;
  htmlContent: string;
  category: string;
  accent: string;
  icon: string;
  readingTime: number;
}

/** Represents an entry in the search index. */
interface SearchEntry {
  slug: string;
  title: string;
  headings: string[];
  snippet: string;
  category: string;
  accent: string;
}

/** Section categories with accent colors and icons */
const SECTION_CONFIG: Record<string, { category: string; accent: string; icon: string }> = {
  'getting-started': { category: 'Getting Started', accent: 'blue', icon: '&#9889;' },
  'commands': { category: 'Core Reference', accent: 'green', icon: '&#9000;' },
  'security': { category: 'Security', accent: 'orange', icon: '&#128274;' },
  'teams': { category: 'Advanced', accent: 'purple', icon: '&#128101;' },
  'contributing': { category: 'Community', accent: 'green', icon: '&#129309;' },
  'faq': { category: 'Help', accent: 'pink', icon: '&#10067;' },
};

/** Callout type configuration */
const CALLOUT_CONFIG: Record<string, { icon: string; title: string }> = {
  'info': { icon: '&#128161;', title: 'Info' },
  'warning': { icon: '&#9888;&#65039;', title: 'Warning' },
  'tip': { icon: '&#128640;', title: 'Pro Tip' },
  'success': { icon: '&#9989;', title: 'Best Practice' },
  'danger': { icon: '&#9888;&#65039;', title: 'Danger' },
  'security': { icon: '&#128274;', title: 'Security Note' },
};

/**
 * Extract a title from Markdown content (first # heading) or fall back to
 * a human-readable slug.
 */
function extractTitle(markdown: string, slug: string): string {
  const match = /^#\s+(.+)$/m.exec(markdown);
  if (match?.[1]) {
    return match[1].trim();
  }
  return slug
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Extract headings from Markdown for sidebar sub-navigation and search index.
 */
function extractHeadings(
  markdown: string,
): Array<{ level: number; text: string; id: string }> {
  const headings: Array<{ level: number; text: string; id: string }> = [];
  const regex = /^(#{1,6})\s+(.+)$/gm;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(markdown)) !== null) {
    const hashes = match[1];
    const rawText = match[2];
    if (!hashes || !rawText) continue;
    const level = hashes.length;
    const text = rawText.trim();
    const id = text
      .toLowerCase()
      .replace(/[^\w\s-]/g, '')
      .replace(/\s+/g, '-');
    headings.push({ level, text, id });
  }
  return headings;
}

/**
 * Estimate reading time in minutes.
 */
function estimateReadingTime(markdown: string): number {
  const words = markdown.replace(/```[\s\S]*?```/g, '').split(/\s+/).length;
  return Math.max(1, Math.ceil(words / 200));
}

/**
 * Create a plain-text snippet from Markdown for the search index.
 */
function createSnippet(markdown: string, maxLength = 200): string {
  const text = markdown
    .replace(/^#+\s+.+$/gm, '') // Remove headings
    .replace(/```[\s\S]*?```/g, '') // Remove code blocks
    .replace(/`[^`]+`/g, '') // Remove inline code
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // Links → text
    .replace(/:::(info|warning|tip|success|danger|security)\b[^\n]*/g, '') // Remove callout markers
    .replace(/^:::\s*$/gm, '')
    .replace(/[*_~]/g, '') // Remove emphasis markers
    .replace(/\n+/g, ' ')
    .trim();
  return text.length > maxLength ? text.slice(0, maxLength) + '...' : text;
}

/**
 * Process callout blocks in markdown before marked conversion.
 * Syntax: :::type optional title\ncontent\n:::
 */
function processCallouts(markdown: string): string {
  const calloutRegex = /^:::(info|warning|tip|success|danger|security)\s*(.*?)$\n([\s\S]*?)^:::$/gm;

  return markdown.replace(calloutRegex, (_match, type: string, customTitle: string, content: string) => {
    const config = CALLOUT_CONFIG[type] ?? { icon: '&#128161;', title: 'Note' };
    const title = customTitle.trim() || config.title;
    const trimmedContent = content.trim();

    return `<div class="docs-callout callout-${type}">
  <div class="docs-callout-icon">${config.icon}</div>
  <div class="docs-callout-content">
    <div class="docs-callout-title">${title}</div>
    <p>${trimmedContent}</p>
  </div>
</div>`;
  });
}

/**
 * Generate a table of contents HTML from page headings.
 */
function generateTableOfContents(headings: Array<{ level: number; text: string; id: string }>): string {
  const tocHeadings = headings.filter((h) => h.level === 2 || h.level === 3);
  if (tocHeadings.length < 3) return ''; // Skip TOC for short pages

  let toc = '<div class="docs-toc">\n';
  toc += '  <div class="docs-toc-title">On this page</div>\n';
  toc += '  <ul>\n';

  for (const h of tocHeadings) {
    const cls = h.level === 3 ? ' class="toc-h3"' : '';
    toc += `    <li${cls}><a href="#${h.id}">${h.text}</a></li>\n`;
  }

  toc += '  </ul>\n';
  toc += '</div>\n';
  return toc;
}

/**
 * Generate breadcrumbs HTML for a page.
 */
function generateBreadcrumbs(title: string, slug: string): string {
  const sepSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9 6l6 6-6 6"/></svg>';

  if (!slug) return '';

  return `<nav class="docs-breadcrumbs" aria-label="Breadcrumb">
  <a href="../">Home</a>
  <span class="breadcrumb-sep">${sepSvg}</span>
  <a href="./">Docs</a>
  <span class="breadcrumb-sep">${sepSvg}</span>
  <span class="breadcrumb-current">${title}</span>
</nav>`;
}

/**
 * Generate page metadata HTML (reading time).
 */
function generatePageMeta(readingTime: number): string {
  return `<div class="docs-page-meta">
  <span class="docs-meta-item">
    <svg class="docs-meta-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
    ${readingTime} min read
  </span>
</div>`;
}

/**
 * Generate accent-coded sidebar navigation HTML with section categories.
 */
function generateSidebarNav(pages: DocPage[], currentSlug: string): string {
  let nav = '<nav class="docs-sidebar" id="docs-sidebar">\n';
  nav += '  <div class="sidebar-header">\n';
  nav += '    <a href="./" class="sidebar-title">Documentation</a>\n';
  nav += '    <button class="sidebar-close" id="sidebar-close" aria-label="Close sidebar">&times;</button>\n';
  nav += '  </div>\n';
  nav += '  <div class="sidebar-search">\n';
  nav += '    <input type="text" id="docs-search-input" placeholder="Search docs..." aria-label="Search documentation" />\n';
  nav += '    <span class="search-shortcut">\u2318K</span>\n';
  nav += '    <div id="docs-search-results" class="search-results"></div>\n';
  nav += '  </div>\n';
  nav += '  <ul class="sidebar-nav-list">\n';

  let lastCategory = '';
  for (const page of pages) {
    // Add section label if category changed
    if (page.category !== lastCategory) {
      nav += `    <li class="sidebar-section-label"><span class="sidebar-section-dot" data-accent="${page.accent}"></span>${page.category}</li>\n`;
      lastCategory = page.category;
    }

    const active = page.slug === currentSlug ? ' class="active"' : '';
    const accentAttr = page.slug === currentSlug ? ` data-accent="${page.accent}"` : '';
    nav += `    <li${active}${accentAttr}><a href="./${page.slug}.html"><span class="nav-icon">${page.icon}</span>${page.title}</a></li>\n`;
  }

  nav += '  </ul>\n';
  nav += '</nav>\n';
  return nav;
}

/** SVG logo mark used inline in docs header */
const LOGO_SVG = `<svg class="logo-mark" width="24" height="24" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <defs>
    <linearGradient id="doc-grad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#0ea5e9"/>
      <stop offset="50%" stop-color="#a855f7"/>
      <stop offset="100%" stop-color="#ec4899"/>
    </linearGradient>
  </defs>
  <circle cx="20" cy="20" r="18" stroke="url(#doc-grad)" stroke-width="2.5" fill="none" opacity="0.25"/>
  <path d="M20 4 A16 16 0 0 1 34.5 14" stroke="url(#doc-grad)" stroke-width="3" stroke-linecap="round" fill="none"/>
  <polygon points="33,10.5 36.5,15 31,15.5" fill="url(#doc-grad)"/>
  <path d="M20 36 A16 16 0 0 1 5.5 26" stroke="url(#doc-grad)" stroke-width="3" stroke-linecap="round" fill="none"/>
  <polygon points="7,29.5 3.5,25 9,24.5" fill="url(#doc-grad)"/>
  <path d="M16 16 L12.5 20 L16 24" stroke="url(#doc-grad)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
  <path d="M24 16 L27.5 20 L24 24" stroke="url(#doc-grad)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
</svg>`;

/**
 * Wrap HTML content in the shared docs layout template with full SEO support.
 * The toc (table of contents) is rendered as a sticky right sidebar, separate
 * from the main article content — matching the layout pattern used by Stripe,
 * Vercel, and Next.js documentation.
 */
function wrapInLayout(
  title: string,
  sidebar: string,
  bodyHtml: string,
  slug = '',
  description = '',
  toc = '',
): string {
  const pageTitle = `${title} — ctx-sync docs`;
  const pageDesc = description || `${title} documentation for ctx-sync, the CLI tool that syncs your dev context across machines.`;
  const canonicalPath = slug ? `/docs/${slug}.html` : '/docs/';
  const canonicalUrl = `https://ctx-sync.live${canonicalPath}`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />

  <!-- Primary Meta Tags -->
  <title>${pageTitle}</title>
  <meta name="title" content="${pageTitle}" />
  <meta name="description" content="${pageDesc}" />
  <meta name="robots" content="index, follow" />
  <meta name="theme-color" content="#0ea5e9" />
  <link rel="canonical" href="${canonicalUrl}" />

  <!-- Open Graph / Facebook -->
  <meta property="og:type" content="article" />
  <meta property="og:url" content="${canonicalUrl}" />
  <meta property="og:title" content="${pageTitle}" />
  <meta property="og:description" content="${pageDesc}" />
  <meta property="og:image" content="https://ctx-sync.live/assets/images/og-image.jpg" />
  <meta property="og:site_name" content="ctx-sync" />

  <!-- Twitter Card -->
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:url" content="${canonicalUrl}" />
  <meta name="twitter:title" content="${pageTitle}" />
  <meta name="twitter:description" content="${pageDesc}" />
  <meta name="twitter:image" content="https://ctx-sync.live/assets/images/og-image.jpg" />

  <!-- Favicon & Icons -->
  <link rel="icon" type="image/svg+xml" href="../assets/images/favicon.svg" />
  <link rel="apple-touch-icon" href="../assets/images/apple-touch-icon.svg" />
  <link rel="manifest" href="../site.webmanifest" />

  <!-- Preconnect to Google Fonts -->
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&family=Plus+Jakarta+Sans:wght@400;500;600;700&family=Space+Grotesk:wght@400;500;600;700&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="../css/main.css" />
  <link rel="stylesheet" href="../css/docs.css" />

  <!-- Structured Data: BreadcrumbList (JSON-LD) -->
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    "itemListElement": [
      { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://ctx-sync.live/" },
      { "@type": "ListItem", "position": 2, "name": "Docs", "item": "https://ctx-sync.live/docs/" }${slug ? `,\n      { "@type": "ListItem", "position": 3, "name": "${title}", "item": "${canonicalUrl}" }` : ''}
    ]
  }
  </script>

  <!-- Structured Data: TechArticle (JSON-LD) -->
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "TechArticle",
    "headline": "${title}",
    "description": "${pageDesc}",
    "url": "${canonicalUrl}",
    "author": { "@type": "Organization", "name": "ctx-sync", "url": "https://ctx-sync.live" },
    "publisher": { "@type": "Organization", "name": "ctx-sync", "url": "https://ctx-sync.live", "logo": { "@type": "ImageObject", "url": "https://ctx-sync.live/assets/images/logo.svg" } },
    "mainEntityOfPage": "${canonicalUrl}",
    "image": "https://ctx-sync.live/assets/images/og-image.jpg"
  }
  </script>
</head>
<body class="docs-page">
  <!-- Scroll Progress Bar -->
  <div class="docs-progress-bar" id="docs-progress-bar">
    <div class="progress-fill" id="progress-fill"></div>
  </div>

  <header class="docs-header" id="docs-header">
    <div class="docs-header-inner">
      <button class="sidebar-toggle" id="sidebar-toggle" aria-label="Toggle sidebar">
        <span></span><span></span><span></span>
      </button>
      <a href="../" class="logo" aria-label="ctx-sync home">
        ${LOGO_SVG}
        <span class="logo-text">ctx-sync</span>
      </a>
      <nav class="header-nav" aria-label="Documentation navigation">
        <a href="./">Docs</a>
        <a href="./contributing.html">Contributing</a>
        <a href="https://github.com/Ay7ot/ctx-sync" target="_blank" rel="noopener">GitHub</a>
      </nav>
      <button class="theme-toggle" id="theme-toggle" aria-label="Toggle dark/light mode">
        <span class="theme-icon">&#127769;</span>
      </button>
    </div>
  </header>

  <div class="docs-layout">
    ${sidebar}
    <main class="docs-content">
      <article class="docs-article">
        ${bodyHtml}
      </article>
    </main>
    ${toc ? `<aside class="docs-toc-sidebar" id="docs-toc-sidebar">${toc}</aside>` : ''}
  </div>

  <!-- CMD+K Command Palette -->
  <div class="cmd-palette-overlay" id="cmd-palette-overlay">
    <div class="cmd-palette" id="cmd-palette">
      <div class="cmd-palette-input-wrap">
        <span class="cmd-palette-search-icon">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        </span>
        <input type="text" class="cmd-palette-input" id="cmd-palette-input" placeholder="Search documentation..." autocomplete="off" />
      </div>
      <div class="cmd-palette-results" id="cmd-palette-results"></div>
      <div class="cmd-palette-footer">
        <span><kbd>&uarr;</kbd><kbd>&darr;</kbd> navigate</span>
        <span><kbd>&#9166;</kbd> open</span>
        <span><kbd>esc</kbd> close</span>
      </div>
    </div>
  </div>

  <!-- Back to Top -->
  <button class="back-to-top" id="back-to-top" aria-label="Back to top">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 15l-6-6-6 6"/></svg>
  </button>

  <script src="../js/main.js"></script>
  <script src="../js/docs-nav.js"></script>
  <script src="../js/docs-search.js"></script>
</body>
</html>`;
}

/** Icon SVGs for docs index cards */
const INDEX_CARD_ICONS: Record<string, string> = {
  'getting-started': '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>',
  'commands': '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>',
  'security': '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>',
  'teams': '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
  'contributing': '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
  'faq': '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
};

/** Accent color CSS values for docs index cards */
const ACCENT_CSS: Record<string, string> = {
  'blue': 'rgba(14,165,233,0.08)',
  'green': 'rgba(34,197,94,0.08)',
  'orange': 'rgba(251,146,60,0.08)',
  'purple': 'rgba(168,85,247,0.08)',
  'pink': 'rgba(236,72,153,0.08)',
};

const ACCENT_CSS_VAR: Record<string, string> = {
  'blue': 'var(--accent-blue)',
  'green': 'var(--accent-green)',
  'orange': 'var(--accent-orange)',
  'purple': 'var(--accent-purple)',
  'pink': 'var(--accent-pink)',
};

const ACCENT_DOT_SHADOW: Record<string, string> = {
  'blue': '0 0 8px rgba(14,165,233,0.4)',
  'green': '0 0 8px rgba(34,197,94,0.4)',
  'orange': '0 0 8px rgba(251,146,60,0.4)',
  'purple': '0 0 8px rgba(168,85,247,0.4)',
  'pink': '0 0 8px rgba(236,72,153,0.4)',
};

const ARROW_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>';

/**
 * Generate the redesigned docs index page body HTML.
 */
function generateDocsIndexBody(pages: DocPage[]): string {
  // Group pages by category
  const sectionTitles: Record<string, string> = {
    'Getting Started': 'Essentials',
    'Core Reference': 'Essentials',
    'Security': 'Security &amp; Architecture',
    'Advanced': 'Advanced',
    'Community': 'Community',
    'Help': 'Help',
  };

  // Build cards grouped by section
  const sections: Record<string, DocPage[]> = {};
  for (const page of pages) {
    const sectionTitle = sectionTitles[page.category] ?? page.category;
    const arr = sections[sectionTitle] ?? (sections[sectionTitle] = []);
    arr.push(page);
  }

  let cardsHtml = '';
  for (const sectionTitle of ['Essentials', 'Security &amp; Architecture', 'Advanced', 'Community', 'Help']) {
    const sectionPages = sections[sectionTitle];
    if (!sectionPages || sectionPages.length === 0) continue;

    const firstPage = sectionPages[0];
    if (!firstPage) continue;
    const dotColor = ACCENT_CSS_VAR[firstPage.accent] ?? 'var(--accent-blue)';
    const dotShadow = ACCENT_DOT_SHADOW[firstPage.accent] ?? '';

    cardsHtml += `
        <div class="docs-index-section">
          <div class="docs-index-section-header">
            <span class="docs-index-section-dot" style="background: ${dotColor}; box-shadow: ${dotShadow}"></span>
            <h2 class="docs-index-section-title">${sectionTitle}</h2>
          </div>
          <div class="docs-index-cards">`;

    for (const p of sectionPages) {
      const iconSvg = INDEX_CARD_ICONS[p.slug] ?? '';
      const bgColor = ACCENT_CSS[p.accent] ?? 'rgba(14,165,233,0.08)';
      const fgColor = ACCENT_CSS_VAR[p.accent] ?? 'var(--accent-blue)';

      cardsHtml += `
            <a href="./${p.slug}.html" class="docs-index-card" data-accent="${p.accent}">
              <div class="docs-index-card-icon" style="background: ${bgColor}; color: ${fgColor}">
                ${iconSvg}
              </div>
              <div class="docs-index-card-body">
                <h3>${p.title}</h3>
                <p>${createSnippet(p.content, 140)}</p>
              </div>
              <span class="docs-index-card-arrow">${ARROW_SVG}</span>
            </a>`;
    }

    cardsHtml += `
          </div>
        </div>`;
  }

  return `
    <div class="docs-index-page">
      <div class="docs-index-hero">
        <div class="docs-index-hero-badge"><span class="hero-badge-dot"></span>v1.3.4</div>
        <h1 class="docs-index-title">ctx-sync Documentation</h1>
        <p class="docs-index-description">Learn how to sync your complete development context across machines. From installation to team workflows, find everything you need to get started.</p>
        <div class="docs-index-actions">
          <a href="./getting-started.html" class="docs-index-cta">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>
            Quick Start
          </a>
          <a href="./commands.html" class="docs-index-cta docs-index-cta-secondary">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>
            CLI Reference
          </a>
        </div>
      </div>

      <div class="docs-index-install">
        <div class="docs-index-install-label">Install</div>
        <code class="docs-index-install-cmd">npm install -g ctx-sync</code>
        <button class="docs-index-install-copy" aria-label="Copy install command" onclick="navigator.clipboard.writeText('npm install -g ctx-sync');this.classList.add('copied');setTimeout(()=>this.classList.remove('copied'),2000)">
          <svg class="copy-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
          <svg class="check-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
        </button>
      </div>

      ${cardsHtml}

      <div class="docs-index-footer-info">
        <p>Need help? <a href="https://github.com/Ay7ot/ctx-sync/issues" target="_blank" rel="noopener">Open an issue on GitHub</a> or check the <a href="./faq.html">FAQ</a>.</p>
      </div>
    </div>`;
}

/**
 * Post-process HTML to enhance code blocks with headers, language badges,
 * and copy buttons.
 */
function enhanceCodeBlocks(html: string): string {
  // Match <pre><code class="language-xxx"> blocks produced by marked
  return html.replace(
    /<pre><code class="language-(\w+)">([\s\S]*?)<\/code><\/pre>/g,
    (_match, lang: string, code: string) => {
      const langDisplay = lang.toUpperCase();
      return `<pre data-lang="${lang}"><div class="code-block-header"><span class="code-lang-badge">${langDisplay}</span><button class="code-copy-btn" aria-label="Copy code"><svg class="copy-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copy</button></div><code class="language-${lang}">${code}</code></pre>`;
    },
  );
}

/**
 * Build all documentation pages from Markdown content.
 */
async function build(): Promise<void> {
  // Ensure output directory exists
  if (!fs.existsSync(DOCS_OUT_DIR)) {
    fs.mkdirSync(DOCS_OUT_DIR, { recursive: true });
  }

  // Read content files
  if (!fs.existsSync(CONTENT_DIR)) {
    console.warn('⚠️  No content/ directory found. Creating placeholder.');
    fs.mkdirSync(CONTENT_DIR, { recursive: true });
    return;
  }

  const mdFiles = fs
    .readdirSync(CONTENT_DIR)
    .filter((f) => f.endsWith('.md'))
    .sort();

  if (mdFiles.length === 0) {
    console.warn('⚠️  No .md files found in content/. Nothing to build.');
    return;
  }

  // Parse all pages first (need full list for sidebar)
  const pages: DocPage[] = [];
  for (const file of mdFiles) {
    const slug = path.basename(file, '.md');
    const raw = fs.readFileSync(path.join(CONTENT_DIR, file), 'utf-8');
    const title = extractTitle(raw, slug);
    const headings = extractHeadings(raw);
    const readingTime = estimateReadingTime(raw);

    // Get section config
    const sectionCfg = SECTION_CONFIG[slug] ?? {
      category: 'Documentation',
      accent: 'blue',
      icon: '&#128196;',
    };

    // Strip the first # heading (and its subtitle paragraph) from the markdown
    // since the build script already renders <h1> + page meta from extracted data.
    // This prevents the title from appearing twice on the page.
    const strippedMd = raw.replace(/^#\s+.+\n+(?:[^#\n][^\n]*\n+)?/, '');

    // Process callouts before marked conversion
    const processedMd = processCallouts(strippedMd);

    // Configure marked for heading IDs
    const renderer = new marked.Renderer();
    renderer.heading = ({ text, depth }: { text: string; depth: number }): string => {
      const id = text
        .toLowerCase()
        .replace(/<[^>]+>/g, '')
        .replace(/[^\w\s-]/g, '')
        .replace(/\s+/g, '-');
      return `<h${depth} id="${id}">${text}</h${depth}>`;
    };

    let htmlContent = await marked(processedMd, { renderer });

    // Enhance code blocks with headers + copy buttons
    htmlContent = enhanceCodeBlocks(htmlContent);

    pages.push({
      slug,
      title,
      headings,
      content: raw,
      htmlContent,
      category: sectionCfg.category,
      accent: sectionCfg.accent,
      icon: sectionCfg.icon,
      readingTime,
    });
  }

  // Define page order (explicit ordering)
  const ORDER = [
    'getting-started',
    'commands',
    'security',
    'teams',
    'contributing',
    'faq',
  ];
  pages.sort((a, b) => {
    const ai = ORDER.indexOf(a.slug);
    const bi = ORDER.indexOf(b.slug);
    if (ai === -1 && bi === -1) return a.slug.localeCompare(b.slug);
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });

  // Generate HTML for each page
  for (const page of pages) {
    const sidebar = generateSidebarNav(pages, page.slug);
    const breadcrumbs = generateBreadcrumbs(page.title, page.slug);
    const pageMeta = generatePageMeta(page.readingTime);
    const toc = generateTableOfContents(page.headings);
    const snippet = createSnippet(page.content, 160);

    const bodyHtml = `${breadcrumbs}\n<h1>${page.title}</h1>\n${pageMeta}\n${page.htmlContent}`;
    const html = wrapInLayout(page.title, sidebar, bodyHtml, page.slug, snippet, toc);
    const outPath = path.join(DOCS_OUT_DIR, `${page.slug}.html`);
    fs.writeFileSync(outPath, html, 'utf-8');
    console.log(`  ✅ ${page.slug}.html`);
  }

  // Generate search index
  const searchIndex: SearchEntry[] = pages.map((page) => ({
    slug: page.slug,
    title: page.title,
    headings: page.headings.map((h) => h.text),
    snippet: createSnippet(page.content),
    category: page.category,
    accent: page.accent,
  }));

  fs.writeFileSync(SEARCH_INDEX_PATH, JSON.stringify(searchIndex, null, 2), 'utf-8');
  console.log(`  ✅ search-index.json`);

  // Generate docs index page with redesigned hero layout
  const docsIndexSidebar = generateSidebarNav(pages, '');
  const docsIndexBody = generateDocsIndexBody(pages);
  const docsIndexHtml = wrapInLayout(
    'Documentation',
    docsIndexSidebar,
    docsIndexBody,
    '',
    'Complete documentation for ctx-sync — the CLI tool that syncs your dev context across machines. Installation, commands, security model, team setup, and FAQ.',
  );
  fs.writeFileSync(path.join(DOCS_OUT_DIR, 'index.html'), docsIndexHtml, 'utf-8');
  console.log(`  ✅ index.html (docs home)`);

  console.log(`\n🎉 Built ${pages.length} docs pages + search index.`);
}

build().catch((err: unknown) => {
  console.error('❌ Build failed:', err);
  process.exit(1);
});
