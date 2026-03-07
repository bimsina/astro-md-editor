import { marked } from 'marked';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';

const turndownService = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
  emDelimiter: '*',
  strongDelimiter: '**',
});

turndownService.use(gfm);

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

  return typeof rendered === 'string' ? rendered : '';
}

export function htmlToMarkdown(html: string): string {
  const markdown = turndownService.turndown(html);
  return markdown.replace(/\n{3,}/g, '\n\n').trimEnd();
}
