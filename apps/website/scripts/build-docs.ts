/**
 * build-docs.ts — Converts Markdown files in content/ to HTML docs pages.
 *
 * Reads each .md file from content/, converts to HTML via `marked`,
 * wraps in a shared layout template, writes to public/docs/<slug>.html,
 * generates sidebar navigation, and produces a search index JSON file.
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
}

/** Represents an entry in the search index. */
interface SearchEntry {
  slug: string;
  title: string;
  headings: string[];
  snippet: string;
}

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
 * Create a plain-text snippet from Markdown for the search index.
 */
function createSnippet(markdown: string, maxLength = 200): string {
  const text = markdown
    .replace(/^#+\s+.+$/gm, '') // Remove headings
    .replace(/```[\s\S]*?```/g, '') // Remove code blocks
    .replace(/`[^`]+`/g, '') // Remove inline code
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // Links → text
    .replace(/[*_~]/g, '') // Remove emphasis markers
    .replace(/\n+/g, ' ')
    .trim();
  return text.length > maxLength ? text.slice(0, maxLength) + '...' : text;
}

/**
 * Generate a sidebar navigation HTML string from the list of pages.
 */
function generateSidebarNav(pages: DocPage[], currentSlug: string): string {
  let nav = '<nav class="docs-sidebar" id="docs-sidebar">\n';
  nav += '  <div class="sidebar-header">\n';
  nav += '    <a href="/docs/" class="sidebar-title">Documentation</a>\n';
  nav += '    <button class="sidebar-close" id="sidebar-close" aria-label="Close sidebar">&times;</button>\n';
  nav += '  </div>\n';
  nav += '  <div class="sidebar-search">\n';
  nav +=
    '    <input type="text" id="docs-search-input" placeholder="Search docs..." aria-label="Search documentation" />\n';
  nav += '    <div id="docs-search-results" class="search-results"></div>\n';
  nav += '  </div>\n';
  nav += '  <ul class="sidebar-nav-list">\n';

  for (const page of pages) {
    const active = page.slug === currentSlug ? ' class="active"' : '';
    nav += `    <li${active}><a href="/docs/${page.slug}.html">${page.title}</a></li>\n`;
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
 */
function wrapInLayout(
  title: string,
  sidebar: string,
  bodyHtml: string,
  slug = '',
  description = '',
): string {
  const pageTitle = `${title} — ctx-sync docs`;
  const pageDesc = description || `${title} documentation for ctx-sync, the CLI tool that syncs your dev context across machines.`;
  const canonicalPath = slug ? `/docs/${slug}.html` : '/docs/';
  const canonicalUrl = `https://ctx-sync.dev${canonicalPath}`;

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
  <meta property="og:image" content="https://ctx-sync.dev/assets/images/og-image.png" />
  <meta property="og:site_name" content="ctx-sync" />

  <!-- Twitter Card -->
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:url" content="${canonicalUrl}" />
  <meta name="twitter:title" content="${pageTitle}" />
  <meta name="twitter:description" content="${pageDesc}" />
  <meta name="twitter:image" content="https://ctx-sync.dev/assets/images/og-image.png" />

  <!-- Favicon & Icons -->
  <link rel="icon" type="image/svg+xml" href="/assets/images/favicon.svg" />
  <link rel="apple-touch-icon" href="/assets/images/apple-touch-icon.svg" />
  <link rel="manifest" href="/site.webmanifest" />

  <!-- Preconnect to Google Fonts -->
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&family=Plus+Jakarta+Sans:wght@400;500;600;700&family=Space+Grotesk:wght@400;500;600;700&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="/css/main.css" />
  <link rel="stylesheet" href="/css/docs.css" />

  <!-- Structured Data: BreadcrumbList (JSON-LD) -->
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    "itemListElement": [
      { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://ctx-sync.dev/" },
      { "@type": "ListItem", "position": 2, "name": "Docs", "item": "https://ctx-sync.dev/docs/" }${slug ? `,\n      { "@type": "ListItem", "position": 3, "name": "${title}", "item": "${canonicalUrl}" }` : ''}
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
    "author": { "@type": "Organization", "name": "ctx-sync", "url": "https://ctx-sync.dev" },
    "publisher": { "@type": "Organization", "name": "ctx-sync", "url": "https://ctx-sync.dev", "logo": { "@type": "ImageObject", "url": "https://ctx-sync.dev/assets/images/logo.svg" } },
    "mainEntityOfPage": "${canonicalUrl}",
    "image": "https://ctx-sync.dev/assets/images/og-image.png"
  }
  </script>
</head>
<body class="docs-page">
  <header class="docs-header">
    <div class="docs-header-inner">
      <button class="sidebar-toggle" id="sidebar-toggle" aria-label="Toggle sidebar">
        <span></span><span></span><span></span>
      </button>
      <a href="/" class="logo" aria-label="ctx-sync home">
        ${LOGO_SVG}
        <span class="logo-text">ctx-sync</span>
      </a>
      <nav class="header-nav" aria-label="Documentation navigation">
        <a href="/docs/">Docs</a>
        <a href="https://github.com/user/ctx-sync" target="_blank" rel="noopener">GitHub</a>
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
  </div>

  <script src="/js/main.js"></script>
  <script src="/js/docs-nav.js"></script>
  <script src="/js/docs-search.js"></script>
</body>
</html>`;
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

    const htmlContent = await marked(raw, { renderer });

    pages.push({ slug, title, headings, content: raw, htmlContent });
  }

  // Define page order (explicit ordering)
  const ORDER = [
    'getting-started',
    'commands',
    'security',
    'teams',
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
    const snippet = createSnippet(page.content, 160);
    const html = wrapInLayout(page.title, sidebar, page.htmlContent, page.slug, snippet);
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
  }));

  fs.writeFileSync(SEARCH_INDEX_PATH, JSON.stringify(searchIndex, null, 2), 'utf-8');
  console.log(`  ✅ search-index.json`);

  // Generate docs index page
  const docsIndexSidebar = generateSidebarNav(pages, '');
  const docsIndexBody = `
    <h1>ctx-sync Documentation</h1>
    <p>Welcome to the ctx-sync documentation. Choose a topic from the sidebar or start with the getting started guide.</p>
    <div class="docs-grid">
      ${pages
        .map(
          (p) => `
        <a href="/docs/${p.slug}.html" class="docs-card">
          <h3>${p.title}</h3>
          <p>${createSnippet(p.content, 100)}</p>
        </a>`,
        )
        .join('\n')}
    </div>`;

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
