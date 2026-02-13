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

/**
 * Wrap HTML content in the shared docs layout template.
 */
function wrapInLayout(
  title: string,
  sidebar: string,
  bodyHtml: string,
): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title} — ctx-sync docs</title>
  <link rel="stylesheet" href="/css/main.css" />
  <link rel="stylesheet" href="/css/docs.css" />
</head>
<body class="docs-page">
  <header class="docs-header">
    <div class="docs-header-inner">
      <button class="sidebar-toggle" id="sidebar-toggle" aria-label="Toggle sidebar">
        <span></span><span></span><span></span>
      </button>
      <a href="/" class="logo">ctx-sync</a>
      <nav class="header-nav">
        <a href="/docs/">Docs</a>
        <a href="https://github.com/user/ctx-sync" target="_blank" rel="noopener">GitHub</a>
      </nav>
      <button class="theme-toggle" id="theme-toggle" aria-label="Toggle dark/light mode">
        <span class="theme-icon">🌙</span>
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
    const html = wrapInLayout(page.title, sidebar, page.htmlContent);
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

  const docsIndexHtml = wrapInLayout('Documentation', docsIndexSidebar, docsIndexBody);
  fs.writeFileSync(path.join(DOCS_OUT_DIR, 'index.html'), docsIndexHtml, 'utf-8');
  console.log(`  ✅ index.html (docs home)`);

  console.log(`\n🎉 Built ${pages.length} docs pages + search index.`);
}

build().catch((err: unknown) => {
  console.error('❌ Build failed:', err);
  process.exit(1);
});
