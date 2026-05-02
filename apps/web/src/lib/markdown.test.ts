import { describe, expect, it } from 'vitest';
import { renderMarkdownToHtml } from './markdown.js';

describe('renderMarkdownToHtml', () => {
  describe('image rendering for trusted hosts', () => {
    it('renders raw.githubusercontent.com image as <img>', () => {
      const md =
        '![Step 1](https://raw.githubusercontent.com/shaunnez/goose-hub/abc1234/evidence/issue-233/step-1.png)';
      const html = renderMarkdownToHtml(md);
      expect(html).toContain('<img');
      expect(html).toContain(
        'src="https://raw.githubusercontent.com/shaunnez/goose-hub/abc1234/evidence/issue-233/step-1.png"',
      );
      expect(html).toContain('alt="Step 1"');
      expect(html).toContain('loading="lazy"');
    });

    it('renders user-images.githubusercontent.com image as <img>', () => {
      const md = '![](https://user-images.githubusercontent.com/1751766/abc.png)';
      const html = renderMarkdownToHtml(md);
      expect(html).toContain('<img');
      expect(html).toContain('src="https://user-images.githubusercontent.com/1751766/abc.png"');
    });

    it('renders camo.githubusercontent.com proxied image as <img>', () => {
      const md = '![proxied](https://camo.githubusercontent.com/hash)';
      const html = renderMarkdownToHtml(md);
      expect(html).toContain('<img');
    });

    it('renders github.com image (e.g. /blob/.../file.png) as <img>', () => {
      const md = '![diagram](https://github.com/shaunnez/goose-hub/blob/main/docs/diagram.png)';
      const html = renderMarkdownToHtml(md);
      expect(html).toContain('<img');
    });

    it('renders an image inside a paragraph along with surrounding text', () => {
      const md =
        'See ![Step 1](https://raw.githubusercontent.com/owner/repo/sha/x.png) for the result.';
      const html = renderMarkdownToHtml(md);
      expect(html).toContain('<img');
      expect(html).toContain('See ');
      expect(html).toContain(' for the result.');
    });
  });

  describe('image rendering for untrusted hosts', () => {
    it('renders evil.com image as a plain link, not <img>', () => {
      const md = '![harmless-looking](https://evil.com/payload.png)';
      const html = renderMarkdownToHtml(md);
      expect(html).not.toContain('<img');
      expect(html).toContain('<a');
      expect(html).toContain('href="https://evil.com/payload.png"');
      expect(html).toContain('harmless-looking');
    });

    it('uses URL as link text when alt is empty for untrusted host', () => {
      const md = '![](https://evil.com/p.png)';
      const html = renderMarkdownToHtml(md);
      expect(html).toContain('<a');
      expect(html).toContain('https://evil.com/p.png');
    });

    it('does not produce an executable <img src=javascript:> or <a href=javascript:>', () => {
      // The regex requires https?:// so this should not match the image OR link rule.
      // The literal text passes through escapeHtml as harmless paragraph content.
      const md = '![bad](javascript:alert(1))';
      const html = renderMarkdownToHtml(md);
      expect(html).not.toContain('<img');
      expect(html).not.toMatch(/href="javascript:/);
      expect(html).not.toMatch(/src="javascript:/);
    });
  });

  describe('regression: existing markdown features still work', () => {
    it('renders a regular link', () => {
      const md = '[Goose Hub](https://github.com/shaunnez/goose-hub)';
      const html = renderMarkdownToHtml(md);
      expect(html).toContain('<a href="https://github.com/shaunnez/goose-hub"');
      expect(html).toContain('Goose Hub');
    });

    it('renders headings, lists, and code blocks', () => {
      const md = '# Title\n\nA paragraph with `code`.\n\n- item 1\n- item 2';
      const html = renderMarkdownToHtml(md);
      expect(html).toContain('<h1');
      expect(html).toContain('<code');
      expect(html).toContain('<ul');
    });

    it('escapes html entities in plain text', () => {
      const md = 'A & B < C';
      const html = renderMarkdownToHtml(md);
      expect(html).toContain('&amp;');
      expect(html).toContain('&lt;');
      expect(html).not.toContain('A & B');
    });

    it('does not double-process when image precedes a link', () => {
      const md =
        '![img](https://raw.githubusercontent.com/o/r/sha/a.png) and [link](https://example.com)';
      const html = renderMarkdownToHtml(md);
      expect(html).toContain('<img');
      expect(html).toContain('<a href="https://example.com"');
      // Critical: no leftover `!<a>` from the link rule consuming the image syntax
      expect(html).not.toContain('!<a');
    });
  });
});
