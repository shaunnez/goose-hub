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

  describe('h1/h2/h3 headings', () => {
    it('renders ## heading as h2', () => {
      const html = renderMarkdownToHtml('## My Section');
      expect(html).toContain('<h2');
      expect(html).toContain('My Section');
    });

    it('renders ### heading as h3', () => {
      const html = renderMarkdownToHtml('### Sub-section');
      expect(html).toContain('<h3');
      expect(html).toContain('Sub-section');
    });

    it('renders # heading as h1', () => {
      const html = renderMarkdownToHtml('# Top Level');
      expect(html).toContain('<h1');
      expect(html).toContain('Top Level');
    });
  });

  describe('blockquote', () => {
    it('renders single-line blockquote', () => {
      const html = renderMarkdownToHtml('> This is a quote');
      expect(html).toContain('<blockquote');
      expect(html).toContain('This is a quote');
    });

    it('renders multi-line blockquote', () => {
      const html = renderMarkdownToHtml('> Line one\n> Line two');
      expect(html).toContain('<blockquote');
      expect(html).toContain('Line one');
      expect(html).toContain('Line two');
    });
  });

  describe('horizontal rule', () => {
    it('renders --- as hr', () => {
      const html = renderMarkdownToHtml('---');
      expect(html).toContain('<hr');
    });

    it('renders ---- (four dashes) as hr', () => {
      const html = renderMarkdownToHtml('----');
      expect(html).toContain('<hr');
    });
  });

  describe('ordered list', () => {
    it('renders numbered list as ol', () => {
      const html = renderMarkdownToHtml('1. First\n2. Second\n3. Third');
      expect(html).toContain('<ol');
      expect(html).toContain('<li>First</li>');
      expect(html).toContain('<li>Second</li>');
    });
  });

  describe('unordered list', () => {
    it('renders * bullets as ul', () => {
      const html = renderMarkdownToHtml('* item a\n* item b');
      expect(html).toContain('<ul');
      expect(html).toContain('<li>item a</li>');
    });

    it('renders - bullets as ul', () => {
      const html = renderMarkdownToHtml('- item x\n- item y');
      expect(html).toContain('<ul');
      expect(html).toContain('<li>item x</li>');
    });
  });

  describe('fenced code block', () => {
    it('renders fenced code block with language', () => {
      const html = renderMarkdownToHtml('```typescript\nconst x = 1;\n```');
      expect(html).toContain('<pre');
      expect(html).toContain('<code');
      expect(html).toContain('const x = 1;');
    });

    it('renders fenced code block without language', () => {
      const html = renderMarkdownToHtml('```\nplain code\n```');
      expect(html).toContain('<pre');
      expect(html).toContain('plain code');
    });

    it('escapes html inside code blocks', () => {
      const html = renderMarkdownToHtml('```\n<script>alert(1)</script>\n```');
      expect(html).not.toContain('<script>');
      expect(html).toContain('&lt;script&gt;');
    });

    it('handles unterminated fenced code block (reaches end of input)', () => {
      const html = renderMarkdownToHtml('```\nsome code without closing');
      expect(html).toContain('<pre');
      expect(html).toContain('some code without closing');
    });
  });

  describe('inline formatting', () => {
    it('renders **bold** as strong', () => {
      const html = renderMarkdownToHtml('This is **bold** text.');
      expect(html).toContain('<strong>bold</strong>');
    });

    it('renders *italic* as em', () => {
      const html = renderMarkdownToHtml('This is *italic* text.');
      expect(html).toContain('<em>italic</em>');
    });

    it('renders inline code', () => {
      const html = renderMarkdownToHtml('Run `pnpm test` now.');
      expect(html).toContain('<code');
      expect(html).toContain('pnpm test');
    });
  });

  describe('empty and whitespace-only input', () => {
    it('returns empty string for empty input', () => {
      const html = renderMarkdownToHtml('');
      expect(html).toBe('');
    });

    it('returns empty string for whitespace-only input', () => {
      const html = renderMarkdownToHtml('   \n\n   ');
      expect(html).toBe('');
    });
  });

  describe('paragraph accumulation', () => {
    it('merges consecutive non-special lines into one paragraph', () => {
      const html = renderMarkdownToHtml('Line one\nLine two\nLine three');
      expect(html).toContain('<p');
      expect(html).toContain('Line one');
      expect(html).toContain('Line two');
      expect(html).toContain('Line three');
    });

    it('stops paragraph at a heading line', () => {
      const html = renderMarkdownToHtml('Some text\n## Heading');
      expect(html).toContain('<p');
      expect(html).toContain('<h2');
    });
  });

  describe('isTrustedImageUrl edge cases', () => {
    it('renders http:// image from trusted host as img', () => {
      const html = renderMarkdownToHtml(
        '![img](http://raw.githubusercontent.com/o/r/sha/file.png)',
      );
      expect(html).toContain('<img');
    });
  });

  describe('special HTML characters in heading content', () => {
    it('escapes & < > in heading content', () => {
      const html = renderMarkdownToHtml('# A & B < C > D');
      expect(html).toContain('&amp;');
      expect(html).toContain('&lt;');
      expect(html).toContain('&gt;');
    });
  });

  describe('CRLF line endings', () => {
    it('handles CRLF line endings correctly', () => {
      const html = renderMarkdownToHtml('# Title\r\n\r\nA paragraph.');
      expect(html).toContain('<h1');
      expect(html).toContain('<p');
    });
  });

  describe('isTrustedImageUrl catch branch (line 35-36)', () => {
    it('treats image with URL that causes URL constructor to throw as untrusted (renders as link)', () => {
      // An IPv6 bracket URL that passes the https?:// regex but fails new URL()
      // e.g. https://[invalid parses to a valid regex match but URL() throws
      const md = '![test](https://[invalid-ipv6/path)';
      const html = renderMarkdownToHtml(md);
      // isTrustedImageUrl returns false (catch block), so renders as plain link
      expect(html).not.toContain('<img');
    });
  });

  describe('inline link rendering', () => {
    it('renders a link with http:// scheme', () => {
      const html = renderMarkdownToHtml('[click here](http://example.com/path)');
      expect(html).toContain('<a href="http://example.com/path"');
      expect(html).toContain('click here');
    });
  });
});
