import { marked } from 'marked';
import TurndownService from 'turndown/lib/turndown.cjs.js';
import { gfm } from 'turndown-plugin-gfm';

const turndownService = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
  emDelimiter: '*',
  strongDelimiter: '**',
});

turndownService.use(gfm);

turndownService.addRule('imageWithOriginalSource', {
  filter: 'img',
  replacement: (_, node) => {
    const alt = node.getAttribute('alt') ?? '';
    const originalSource =
      node.getAttribute('data-original-src') ?? node.getAttribute('src') ?? '';
    if (!originalSource) {
      return '';
    }

    return `![${alt}](${originalSource})`;
  },
});

turndownService.addRule('tiptapTaskItem', {
  filter: (node) => {
    return (
      node.nodeName === 'LI' && node.getAttribute('data-type') === 'taskItem'
    );
  },
  replacement: (content, node) => {
    const checked = node.getAttribute('data-checked') === 'true';
    const normalized = content.trim().replace(/\n/g, '\n  ');
    return `\n- [${checked ? 'x' : ' '}] ${normalized}\n`;
  },
});

export function markdownToHtml(markdown: string): string {
  const rendered = marked.parse(markdown, {
    gfm: true,
    breaks: false,
  });

  if (typeof rendered !== 'string') {
    return '';
  }

  return rendered.replace(
    /<img\b([^>]*?)\bsrc=(["'])([^"']+)\2([^>]*)>/gi,
    (fullMatch, before, quote, source, after) => {
      if (/data-original-src=/i.test(fullMatch)) {
        return fullMatch;
      }

      const escapedSource = String(source).replace(/"/g, '&quot;');
      return `<img${before}src=${quote}${source}${quote} data-original-src="${escapedSource}"${after}>`;
    },
  );
}

export function htmlToMarkdown(html: string): string {
  const markdown = turndownService.turndown(html);
  return markdown.replace(/\n{3,}/g, '\n\n').trimEnd();
}
