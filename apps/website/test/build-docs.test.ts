/**
 * Unit tests for the build-docs script.
 * Verifies:
 *  - Markdown → HTML conversion
 *  - Layout template is applied
 *  - Search index is generated
 *  - All expected pages are produced
 *  - Internal links resolve
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const WEBSITE_ROOT = path.resolve(__dirname, '..');
const DOCS_OUT = path.join(WEBSITE_ROOT, 'public', 'docs');
const CONTENT_DIR = path.join(WEBSITE_ROOT, 'content');

// Run the build before all tests
beforeAll(() => {
  execSync('npx tsx scripts/build-docs.ts', {
    cwd: WEBSITE_ROOT,
    stdio: 'pipe',
  });
});

describe('Build docs script', () => {
  describe('Markdown → HTML conversion', () => {
    it('should produce HTML files for each Markdown content file', () => {
      const mdFiles = fs
        .readdirSync(CONTENT_DIR)
        .filter((f) => f.endsWith('.md'));

      for (const mdFile of mdFiles) {
        const slug = path.basename(mdFile, '.md');
        const htmlPath = path.join(DOCS_OUT, `${slug}.html`);
        expect(fs.existsSync(htmlPath)).toBe(true);
      }
    });

    it('should produce valid HTML with DOCTYPE', () => {
      const mdFiles = fs
        .readdirSync(CONTENT_DIR)
        .filter((f) => f.endsWith('.md'));

      for (const mdFile of mdFiles) {
        const slug = path.basename(mdFile, '.md');
        const html = fs.readFileSync(
          path.join(DOCS_OUT, `${slug}.html`),
          'utf-8',
        );
        expect(html).toMatch(/^<!DOCTYPE html>/);
        expect(html).toContain('</html>');
      }
    });

    it('should convert Markdown headings to HTML headings with IDs', () => {
      const gettingStarted = fs.readFileSync(
        path.join(DOCS_OUT, 'getting-started.html'),
        'utf-8',
      );

      // Should have h1 from the # Getting Started heading
      expect(gettingStarted).toContain('<h1');
      // Should have h2 headings with id attributes
      expect(gettingStarted).toMatch(/<h2 id="[^"]+"/);
    });

    it('should convert Markdown code blocks to HTML pre/code', () => {
      const commands = fs.readFileSync(
        path.join(DOCS_OUT, 'commands.html'),
        'utf-8',
      );

      expect(commands).toContain('<pre');
      expect(commands).toContain('<code');
    });

    it('should convert Markdown tables to HTML tables', () => {
      const security = fs.readFileSync(
        path.join(DOCS_OUT, 'security.html'),
        'utf-8',
      );

      expect(security).toContain('<table>');
      expect(security).toContain('<th>');
      expect(security).toContain('<td>');
    });
  });

  describe('Layout template', () => {
    it('should wrap content in the docs layout', () => {
      const html = fs.readFileSync(
        path.join(DOCS_OUT, 'getting-started.html'),
        'utf-8',
      );

      // Should have header
      expect(html).toContain('class="docs-header"');
      // Should have sidebar
      expect(html).toContain('class="docs-sidebar"');
      // Should have main content
      expect(html).toContain('class="docs-content"');
      // Should link CSS (relative paths for GitHub Pages subpath support)
      expect(html).toContain('href="../css/main.css"');
      expect(html).toContain('href="../css/docs.css"');
      // Should link JS
      expect(html).toContain('src="../js/main.js"');
      expect(html).toContain('src="../js/docs-nav.js"');
      expect(html).toContain('src="../js/docs-search.js"');
    });

    it('should include page title in <title> tag', () => {
      const html = fs.readFileSync(
        path.join(DOCS_OUT, 'getting-started.html'),
        'utf-8',
      );

      expect(html).toContain('<title>Getting Started');
      expect(html).toContain('ctx-sync docs</title>');
    });

    it('should include sidebar navigation with all pages', () => {
      const html = fs.readFileSync(
        path.join(DOCS_OUT, 'getting-started.html'),
        'utf-8',
      );

      // All doc pages should be in the sidebar
      expect(html).toContain('getting-started.html');
      expect(html).toContain('commands.html');
      expect(html).toContain('security.html');
      expect(html).toContain('teams.html');
      expect(html).toContain('faq.html');
    });

    it('should mark the current page as active in sidebar', () => {
      const html = fs.readFileSync(
        path.join(DOCS_OUT, 'commands.html'),
        'utf-8',
      );

      // The commands page link should have active class
      expect(html).toMatch(/class="active"[^>]*>.*?commands\.html/s);
    });
  });

  describe('Search index', () => {
    it('should generate a search-index.json file', () => {
      const indexPath = path.join(DOCS_OUT, 'search-index.json');
      expect(fs.existsSync(indexPath)).toBe(true);
    });

    it('should contain entries for each docs page', () => {
      const index = JSON.parse(
        fs.readFileSync(path.join(DOCS_OUT, 'search-index.json'), 'utf-8'),
      );

      expect(Array.isArray(index)).toBe(true);

      const slugs = index.map((entry: { slug: string }) => entry.slug);
      expect(slugs).toContain('getting-started');
      expect(slugs).toContain('commands');
      expect(slugs).toContain('security');
      expect(slugs).toContain('teams');
      expect(slugs).toContain('faq');
    });

    it('should include title, headings, and snippet for each entry', () => {
      const index = JSON.parse(
        fs.readFileSync(path.join(DOCS_OUT, 'search-index.json'), 'utf-8'),
      );

      for (const entry of index) {
        expect(entry).toHaveProperty('slug');
        expect(entry).toHaveProperty('title');
        expect(entry).toHaveProperty('headings');
        expect(entry).toHaveProperty('snippet');
        expect(typeof entry.title).toBe('string');
        expect(entry.title.length).toBeGreaterThan(0);
        expect(Array.isArray(entry.headings)).toBe(true);
        expect(typeof entry.snippet).toBe('string');
      }
    });

    it('should have headings that match Markdown content', () => {
      const index = JSON.parse(
        fs.readFileSync(path.join(DOCS_OUT, 'search-index.json'), 'utf-8'),
      );

      const securityEntry = index.find(
        (e: { slug: string }) => e.slug === 'security',
      );
      expect(securityEntry).toBeDefined();
      expect(securityEntry.headings).toContain('Security Model');
      expect(securityEntry.headings).toContain('Core Principles');
    });
  });

  describe('Docs index page', () => {
    it('should generate an index.html for docs landing', () => {
      const indexPath = path.join(DOCS_OUT, 'index.html');
      expect(fs.existsSync(indexPath)).toBe(true);
    });

    it('should contain links to all docs pages', () => {
      const html = fs.readFileSync(
        path.join(DOCS_OUT, 'index.html'),
        'utf-8',
      );

      expect(html).toContain('./getting-started.html');
      expect(html).toContain('./commands.html');
      expect(html).toContain('./security.html');
      expect(html).toContain('./teams.html');
      expect(html).toContain('./faq.html');
    });

    it('should display docs cards with titles and snippets', () => {
      const html = fs.readFileSync(
        path.join(DOCS_OUT, 'index.html'),
        'utf-8',
      );

      // Redesigned index uses docs-index-card and docs-index-cards
      expect(html).toContain('docs-index-card');
      expect(html).toContain('docs-index-cards');
    });
  });

  describe('Internal link validation', () => {
    it('should have no broken internal links in generated HTML', () => {
      const htmlFiles = fs
        .readdirSync(DOCS_OUT)
        .filter((f) => f.endsWith('.html'));

      const brokenLinks: string[] = [];

      for (const file of htmlFiles) {
        const html = fs.readFileSync(path.join(DOCS_OUT, file), 'utf-8');
        // Match relative docs links: ./slug.html
        const linkRegex = /href="\.\/([^"]+\.html)"/g;
        let match;

        while ((match = linkRegex.exec(html)) !== null) {
          const linkedFile = match[1];
          if (linkedFile && !fs.existsSync(path.join(DOCS_OUT, linkedFile))) {
            brokenLinks.push(`${file} -> ./${linkedFile}`);
          }
        }
      }

      expect(brokenLinks).toEqual([]);
    });
  });

  describe('HTML validation (basic)', () => {
    it('should not have unclosed tags in generated docs', () => {
      const htmlFiles = fs
        .readdirSync(DOCS_OUT)
        .filter((f) => f.endsWith('.html'));

      for (const file of htmlFiles) {
        const html = fs.readFileSync(path.join(DOCS_OUT, file), 'utf-8');

        // Basic checks: opened tags should be closed
        expect(html).toContain('<!DOCTYPE html>');
        expect(html).toContain('<html');
        expect(html).toContain('</html>');
        expect(html).toContain('<head>');
        expect(html).toContain('</head>');
        expect(html).toContain('<body');
        expect(html).toContain('</body>');
      }
    });

    it('should have proper meta viewport tag', () => {
      const htmlFiles = fs
        .readdirSync(DOCS_OUT)
        .filter((f) => f.endsWith('.html'));

      for (const file of htmlFiles) {
        const html = fs.readFileSync(path.join(DOCS_OUT, file), 'utf-8');
        expect(html).toContain('name="viewport"');
      }
    });

    it('should have proper charset meta tag', () => {
      const htmlFiles = fs
        .readdirSync(DOCS_OUT)
        .filter((f) => f.endsWith('.html'));

      for (const file of htmlFiles) {
        const html = fs.readFileSync(path.join(DOCS_OUT, file), 'utf-8');
        expect(html).toContain('charset="UTF-8"');
      }
    });
  });
});

describe('Sync repo documentation', () => {
  it('getting-started should explain dedicated sync repository', () => {
    const html = fs.readFileSync(
      path.join(DOCS_OUT, 'getting-started.html'),
      'utf-8',
    );

    expect(html).toContain('dedicated');
    expect(html).toContain('separate from your project');
  });

  it('getting-started should include repo creation steps', () => {
    const html = fs.readFileSync(
      path.join(DOCS_OUT, 'getting-started.html'),
      'utf-8',
    );

    // Should mention creating a private repo on GitHub/GitLab
    expect(html).toContain('Create a Sync Repository');
    expect(html).toMatch(/GitHub|GitLab/);
    expect(html).toContain('private');
  });

  it('faq should explain sync repo vs project repo distinction', () => {
    const html = fs.readFileSync(
      path.join(DOCS_OUT, 'faq.html'),
      'utf-8',
    );

    expect(html).toContain('sync repo the same as my project repo');
    expect(html).toContain('~/.context-sync/');
  });

  it('landing page should mention dedicated repo in how-it-works', () => {
    const html = fs.readFileSync(
      path.join(WEBSITE_ROOT, 'public', 'index.html'),
      'utf-8',
    );

    // The how-it-works Sync step should clarify the dedicated repo
    expect(html).toContain('dedicated');
  });

  it('commands should document --remote option for init', () => {
    const html = fs.readFileSync(
      path.join(DOCS_OUT, 'commands.html'),
      'utf-8',
    );

    expect(html).toContain('--remote');
    expect(html).toContain('--no-interactive');
  });
});

describe('Landing page validation', () => {
  const indexPath = path.join(WEBSITE_ROOT, 'public', 'index.html');

  it('should exist', () => {
    expect(fs.existsSync(indexPath)).toBe(true);
  });

  it('should be valid HTML', () => {
    const html = fs.readFileSync(indexPath, 'utf-8');
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('</html>');
    expect(html).toContain('charset="UTF-8"');
    expect(html).toContain('name="viewport"');
  });

  it('should have all required sections', () => {
    const html = fs.readFileSync(indexPath, 'utf-8');

    // Hero
    expect(html).toContain('class="hero"');
    // Problem statement
    expect(html).toContain('id="problem"');
    // Features
    expect(html).toContain('id="features"');
    // How it works
    expect(html).toContain('id="how-it-works"');
    // Security
    expect(html).toContain('id="security"');
    // Comparison
    expect(html).toContain('id="comparison"');
    // Getting started
    expect(html).toContain('id="get-started"');
    // Footer
    expect(html).toContain('class="site-footer"');
  });

  it('should contain install command', () => {
    const html = fs.readFileSync(indexPath, 'utf-8');
    expect(html).toContain('npm install -g ctx-sync');
  });

  it('should link to documentation', () => {
    const html = fs.readFileSync(indexPath, 'utf-8');
    expect(html).toContain('./docs/');
    expect(html).toContain('./docs/getting-started.html');
  });

  it('should reference CSS and JS assets', () => {
    const html = fs.readFileSync(indexPath, 'utf-8');
    expect(html).toContain('href="./css/main.css"');
    expect(html).toContain('src="./js/main.js"');
  });

  it('should be responsive with mobile meta viewport', () => {
    const html = fs.readFileSync(indexPath, 'utf-8');
    expect(html).toContain('width=device-width, initial-scale=1.0');
  });

  it('should have a comparison table', () => {
    const html = fs.readFileSync(indexPath, 'utf-8');
    expect(html).toContain('class="comparison-table"');
    expect(html).toContain('Atuin');
    expect(html).toContain('Dotfiles Managers');
    expect(html).toContain('Cloud IDEs');
  });
});

describe('CSS validation', () => {
  it('should have main.css', () => {
    const cssPath = path.join(WEBSITE_ROOT, 'public', 'css', 'main.css');
    expect(fs.existsSync(cssPath)).toBe(true);
    const css = fs.readFileSync(cssPath, 'utf-8');
    expect(css.length).toBeGreaterThan(100);
  });

  it('should have docs.css', () => {
    const cssPath = path.join(WEBSITE_ROOT, 'public', 'css', 'docs.css');
    expect(fs.existsSync(cssPath)).toBe(true);
    const css = fs.readFileSync(cssPath, 'utf-8');
    expect(css.length).toBeGreaterThan(100);
  });

  it('should have CSS variables for theming', () => {
    const css = fs.readFileSync(
      path.join(WEBSITE_ROOT, 'public', 'css', 'main.css'),
      'utf-8',
    );
    expect(css).toContain('--bg-primary');
    expect(css).toContain('--accent-blue');
    expect(css).toContain('--text-primary');
  });

  it('should support dark/light mode', () => {
    const css = fs.readFileSync(
      path.join(WEBSITE_ROOT, 'public', 'css', 'main.css'),
      'utf-8',
    );
    expect(css).toContain("[data-theme='light']");
  });

  it('should have responsive breakpoints', () => {
    const css = fs.readFileSync(
      path.join(WEBSITE_ROOT, 'public', 'css', 'main.css'),
      'utf-8',
    );
    expect(css).toContain('@media');
  });
});

describe('JavaScript validation', () => {
  it('should have main.js', () => {
    const jsPath = path.join(WEBSITE_ROOT, 'public', 'js', 'main.js');
    expect(fs.existsSync(jsPath)).toBe(true);
  });

  it('should have docs-nav.js', () => {
    const jsPath = path.join(WEBSITE_ROOT, 'public', 'js', 'docs-nav.js');
    expect(fs.existsSync(jsPath)).toBe(true);
  });

  it('should have docs-search.js', () => {
    const jsPath = path.join(WEBSITE_ROOT, 'public', 'js', 'docs-search.js');
    expect(fs.existsSync(jsPath)).toBe(true);
  });
});
