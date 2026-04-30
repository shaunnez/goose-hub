// Minimal HTML-escape + lightweight markdown renderer for issue bodies.
// We don't need a full CommonMark renderer for M2; issues are
// structured similarly across slices (headings, fenced code, lists,
// inline code, bold, italics, links, hr). Anything trickier (tables,
// HTML, footnotes) renders as plain text — acceptable for M2.

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderInline(value: string): string {
  let out = escapeHtml(value);
  out = out.replace(
    /`([^`\n]+)`/g,
    '<code class="font-mono text-[12px] bg-bg-elev px-1 py-0.5 rounded">$1</code>',
  );
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>');
  out = out.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    '<a href="$2" class="text-accent hover:underline" target="_blank" rel="noreferrer noopener">$1</a>',
  );
  // Auto-link bare GitHub-style #N references — leave inert for M2 (cross-link handled by detail page route).
  return out;
}

interface Block {
  kind: 'p' | 'h1' | 'h2' | 'h3' | 'pre' | 'ul' | 'ol' | 'hr' | 'blockquote';
  content?: string;
  items?: string[];
  code?: { lang?: string; body: string };
}

export function renderMarkdownToHtml(body: string): string {
  const blocks: Block[] = [];
  const lines = body.replace(/\r\n/g, '\n').split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.startsWith('```')) {
      const lang = line.slice(3).trim();
      const codeLines: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i]);
        i += 1;
      }
      i += 1;
      blocks.push({ kind: 'pre', code: { lang, body: codeLines.join('\n') } });
      continue;
    }

    if (/^---+\s*$/.test(line)) {
      blocks.push({ kind: 'hr' });
      i += 1;
      continue;
    }

    if (line.startsWith('### ')) {
      blocks.push({ kind: 'h3', content: line.slice(4) });
      i += 1;
      continue;
    }
    if (line.startsWith('## ')) {
      blocks.push({ kind: 'h2', content: line.slice(3) });
      i += 1;
      continue;
    }
    if (line.startsWith('# ')) {
      blocks.push({ kind: 'h1', content: line.slice(2) });
      i += 1;
      continue;
    }

    if (line.startsWith('> ')) {
      const quoteLines: string[] = [line.slice(2)];
      i += 1;
      while (i < lines.length && lines[i].startsWith('> ')) {
        quoteLines.push(lines[i].slice(2));
        i += 1;
      }
      blocks.push({ kind: 'blockquote', content: quoteLines.join('\n') });
      continue;
    }

    if (/^[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^[-*]\s+/, ''));
        i += 1;
      }
      blocks.push({ kind: 'ul', items });
      continue;
    }

    if (/^\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\d+\.\s+/, ''));
        i += 1;
      }
      blocks.push({ kind: 'ol', items });
      continue;
    }

    if (line.trim() === '') {
      i += 1;
      continue;
    }

    const paraLines: string[] = [line];
    i += 1;
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !/^(#|>|```|---|[-*]\s+|\d+\.\s+)/.test(lines[i])
    ) {
      paraLines.push(lines[i]);
      i += 1;
    }
    blocks.push({ kind: 'p', content: paraLines.join(' ') });
  }

  return blocks
    .map((b) => {
      switch (b.kind) {
        case 'h1':
          return `<h1 class="text-[22px] font-semibold mt-6 mb-3 tracking-tight">${renderInline(b.content ?? '')}</h1>`;
        case 'h2':
          return `<h2 class="text-[17px] font-semibold mt-5 mb-2 tracking-tight">${renderInline(b.content ?? '')}</h2>`;
        case 'h3':
          return `<h3 class="text-[14.5px] font-semibold mt-4 mb-2 tracking-tight">${renderInline(b.content ?? '')}</h3>`;
        case 'p':
          return `<p class="my-3 text-fg-2 leading-relaxed">${renderInline(b.content ?? '')}</p>`;
        case 'pre':
          return `<pre class="bg-bg-elev border border-line rounded-md px-3 py-2 my-3 overflow-x-auto"><code class="font-mono text-[12px]">${escapeHtml(b.code?.body ?? '')}</code></pre>`;
        case 'ul':
          return `<ul class="list-disc pl-6 my-3 space-y-1 text-fg-2">${(b.items ?? []).map((item) => `<li>${renderInline(item)}</li>`).join('')}</ul>`;
        case 'ol':
          return `<ol class="list-decimal pl-6 my-3 space-y-1 text-fg-2">${(b.items ?? []).map((item) => `<li>${renderInline(item)}</li>`).join('')}</ol>`;
        case 'hr':
          return '<hr class="my-4 border-line" />';
        case 'blockquote':
          return `<blockquote class="border-l-2 border-line pl-3 my-3 text-fg-3 italic">${renderInline(b.content ?? '')}</blockquote>`;
        default:
          return '';
      }
    })
    .join('\n');
}
