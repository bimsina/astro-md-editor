import * as React from 'react';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Image from '@tiptap/extension-image';
import {
  Code2Icon,
  Heading1Icon,
  Heading2Icon,
  ImageIcon,
  LinkIcon,
  ListChecksIcon,
  ListIcon,
  ListOrderedIcon,
  MinusIcon,
  QuoteIcon,
} from 'lucide-react';
import { Button } from '#/components/ui/button';
import { Input } from '#/components/ui/input';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '#/components/ui/popover';
import { ImageAssetBrowser } from '#/components/editor/ImageAssetBrowser';
import { getLocalImagePreviewServerFn } from '#/lib/image-preview.api';
import { htmlToMarkdown, markdownToHtml } from '#/lib/rich-markdown';
import type { ImageFieldSourceMode } from '#/lib/schema-form';
import { cn } from '#/lib/utils';

type RichEditorProps = {
  content: string;
  onChange: (content: string) => void;
  currentFilePath?: string;
};

type SlashQueryState = {
  query: string;
  from: number;
  to: number;
};

type SlashCommandContext = {
  openImagePanel: () => void;
};

type SlashCommand = {
  key: string;
  label: string;
  aliases: string[];
  run: (editor: Editor, context: SlashCommandContext) => void;
};

const IMAGE_ALT_PLACEHOLDER = 'image';
const LOCAL_IMAGE_SOURCE_ATTRIBUTE = 'data-original-src';

const RichImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      originalSrc: {
        default: null,
        parseHTML: (element) => {
          return element.getAttribute(LOCAL_IMAGE_SOURCE_ATTRIBUTE);
        },
        renderHTML: (attributes) => {
          const originalSrc = attributes.originalSrc;
          if (typeof originalSrc !== 'string' || originalSrc.length === 0) {
            return {};
          }

          return {
            [LOCAL_IMAGE_SOURCE_ATTRIBUTE]: originalSrc,
          };
        },
      },
    };
  },
});

function isPreviewableLocalImageSource(sourcePath: string): boolean {
  const normalized = sourcePath.trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  if (
    normalized.startsWith('http://') ||
    normalized.startsWith('https://') ||
    normalized.startsWith('data:') ||
    normalized.startsWith('blob:')
  ) {
    return false;
  }

  return true;
}

function resolveSlashQueryState(editor: Editor): SlashQueryState | undefined {
  const { selection } = editor.state;
  if (!selection.empty) {
    return undefined;
  }

  const { $from, from } = selection;
  if ($from.parent.type.name !== 'paragraph') {
    return undefined;
  }

  const textBeforeCursor = $from.parent.textBetween(
    0,
    $from.parentOffset,
    undefined,
    '\ufffc',
  );

  if (!textBeforeCursor.startsWith('/')) {
    return undefined;
  }

  if (textBeforeCursor.includes(' ')) {
    return undefined;
  }

  return {
    query: textBeforeCursor.slice(1).trim().toLowerCase(),
    from: from - textBeforeCursor.length,
    to: from,
  };
}

function ToolbarButton({
  active,
  label,
  onClick,
  children,
}: {
  active?: boolean;
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        'inline-flex h-7 items-center justify-center rounded-md border px-2 text-xs transition-colors',
        active
          ? 'border-ring/40 bg-background text-foreground shadow-sm'
          : 'text-muted-foreground hover:bg-muted/55 hover:text-foreground border-transparent',
      )}
    >
      {children}
    </button>
  );
}

const SLASH_COMMANDS: SlashCommand[] = [
  {
    key: 'h1',
    label: 'Heading 1',
    aliases: ['title', 'heading'],
    run: (editor) => {
      editor.chain().focus().toggleHeading({ level: 1 }).run();
    },
  },
  {
    key: 'h2',
    label: 'Heading 2',
    aliases: ['heading'],
    run: (editor) => {
      editor.chain().focus().toggleHeading({ level: 2 }).run();
    },
  },
  {
    key: 'bullet-list',
    label: 'Bullet List',
    aliases: ['list', 'ul'],
    run: (editor) => {
      editor.chain().focus().toggleBulletList().run();
    },
  },
  {
    key: 'ordered-list',
    label: 'Numbered List',
    aliases: ['list', 'ol'],
    run: (editor) => {
      editor.chain().focus().toggleOrderedList().run();
    },
  },
  {
    key: 'task-list',
    label: 'Checklist',
    aliases: ['todo', 'tasks'],
    run: (editor) => {
      editor.chain().focus().toggleTaskList().run();
    },
  },
  {
    key: 'blockquote',
    label: 'Quote',
    aliases: ['quote'],
    run: (editor) => {
      editor.chain().focus().toggleBlockquote().run();
    },
  },
  {
    key: 'code-block',
    label: 'Code Block',
    aliases: ['code', 'snippet'],
    run: (editor) => {
      editor.chain().focus().toggleCodeBlock().run();
    },
  },
  {
    key: 'divider',
    label: 'Divider',
    aliases: ['hr', 'line'],
    run: (editor) => {
      editor.chain().focus().setHorizontalRule().run();
    },
  },
  {
    key: 'image',
    label: 'Image',
    aliases: ['photo', 'media'],
    run: (_, context) => {
      context.openImagePanel();
    },
  },
];

export default function RichEditor({
  content,
  onChange,
  currentFilePath,
}: RichEditorProps) {
  const [slashState, setSlashState] = React.useState<SlashQueryState>();
  const [slashSelectionIndex, setSlashSelectionIndex] = React.useState(0);
  const [imagePopoverOpen, setImagePopoverOpen] = React.useState(false);
  const [imageTab, setImageTab] = React.useState<'assets' | 'url'>('assets');
  const [imageSourceMode, setImageSourceMode] =
    React.useState<ImageFieldSourceMode>('asset');
  const [imageUrl, setImageUrl] = React.useState('');

  const skipOnUpdateRef = React.useRef(false);
  const syncedMarkdownRef = React.useRef(content);
  const localImagePreviewUrlsRef = React.useRef<Map<string, string>>(new Map());
  const localImagePreviewPendingRef = React.useRef<Set<string>>(new Set());

  const syncSlashState = React.useCallback((instance: Editor) => {
    const nextSlashState = resolveSlashQueryState(instance);
    setSlashState(nextSlashState);
    setSlashSelectionIndex(0);
  }, []);

  const applyLocalImagePreviews = React.useCallback(
    (instance: Editor) => {
      if (!currentFilePath) {
        return;
      }

      const imageNodes = Array.from(instance.view.dom.querySelectorAll('img'));
      for (const node of imageNodes) {
        const originalSource =
          node.getAttribute(LOCAL_IMAGE_SOURCE_ATTRIBUTE) ??
          node.getAttribute('src') ??
          '';
        const normalizedSource = originalSource.trim();
        if (!isPreviewableLocalImageSource(normalizedSource)) {
          continue;
        }

        const previewKey = `${currentFilePath}::${normalizedSource}`;
        const cachedPreviewUrl =
          localImagePreviewUrlsRef.current.get(previewKey);
        if (cachedPreviewUrl) {
          if (node.getAttribute('src') !== cachedPreviewUrl) {
            node.setAttribute('src', cachedPreviewUrl);
          }
          continue;
        }

        if (localImagePreviewPendingRef.current.has(previewKey)) {
          continue;
        }

        localImagePreviewPendingRef.current.add(previewKey);
        void getLocalImagePreviewServerFn({
          data: {
            currentFilePath,
            sourcePath: normalizedSource,
          },
        })
          .then(async (response) => {
            if (!response.ok) {
              throw new Error(`Preview request failed (${response.status})`);
            }

            const blob = await response.blob();
            const objectUrl = URL.createObjectURL(blob);
            localImagePreviewUrlsRef.current.set(previewKey, objectUrl);

            const refreshedNodes = Array.from(
              instance.view.dom.querySelectorAll('img'),
            );
            for (const refreshedNode of refreshedNodes) {
              const refreshedOriginalSource =
                refreshedNode.getAttribute(LOCAL_IMAGE_SOURCE_ATTRIBUTE) ??
                refreshedNode.getAttribute('src') ??
                '';
              if (refreshedOriginalSource.trim() !== normalizedSource) {
                continue;
              }

              refreshedNode.setAttribute('src', objectUrl);
            }
          })
          .catch(() => {
            // Keep the original src when local preview resolution fails.
          })
          .finally(() => {
            localImagePreviewPendingRef.current.delete(previewKey);
          });
      }
    },
    [currentFilePath],
  );

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: {
          levels: [1, 2, 3],
        },
      }),
      Link.configure({
        openOnClick: false,
        linkOnPaste: true,
        autolink: true,
      }),
      Placeholder.configure({
        placeholder: 'Start writing your article...',
      }),
      TaskList,
      TaskItem.configure({
        nested: true,
      }),
      RichImage.configure({
        inline: false,
        allowBase64: false,
      }),
    ],
    content: markdownToHtml(content),
    editorProps: {
      attributes: {
        class:
          'focus:outline-none min-h-full [&_a]:text-primary [&_a]:underline [&_blockquote]:border-l [&_blockquote]:border-border/70 [&_blockquote]:pl-4 [&_code]:bg-muted/65 [&_code]:rounded-sm [&_code]:px-1 [&_code]:py-0.5 [&_h1]:mb-3 [&_h1]:mt-6 [&_h1]:text-[1.95rem] [&_h1]:font-semibold [&_h2]:mb-2 [&_h2]:mt-5 [&_h2]:text-[1.45rem] [&_h2]:font-semibold [&_h3]:mb-2 [&_h3]:mt-4 [&_h3]:text-[1.15rem] [&_h3]:font-semibold [&_hr]:my-6 [&_hr]:border-border/70 [&_li[data-checked=true]>p]:line-through [&_ol]:list-decimal [&_ol]:pl-6 [&_p]:my-3 [&_pre]:bg-muted/70 [&_pre]:rounded-lg [&_pre]:p-3 [&_ul]:list-disc [&_ul]:pl-6 [&_ul[data-type=taskList]]:list-none [&_ul[data-type=taskList]]:pl-0',
      },
    },
    onUpdate: ({ editor: instance }) => {
      syncSlashState(instance);
      applyLocalImagePreviews(instance);
      if (skipOnUpdateRef.current) {
        return;
      }

      const markdown = htmlToMarkdown(instance.getHTML());
      if (markdown === syncedMarkdownRef.current) {
        return;
      }

      syncedMarkdownRef.current = markdown;
      onChange(markdown);
    },
    onSelectionUpdate: ({ editor: instance }) => {
      syncSlashState(instance);
    },
  });

  React.useEffect(() => {
    return () => {
      for (const url of localImagePreviewUrlsRef.current.values()) {
        URL.revokeObjectURL(url);
      }
      localImagePreviewUrlsRef.current.clear();
      localImagePreviewPendingRef.current.clear();
    };
  }, []);

  React.useEffect(() => {
    for (const url of localImagePreviewUrlsRef.current.values()) {
      URL.revokeObjectURL(url);
    }
    localImagePreviewUrlsRef.current.clear();
    localImagePreviewPendingRef.current.clear();
  }, [currentFilePath]);

  React.useEffect(() => {
    if (!editor) {
      return;
    }

    if (content === syncedMarkdownRef.current) {
      return;
    }

    skipOnUpdateRef.current = true;
    try {
      editor.commands.setContent(markdownToHtml(content), {
        emitUpdate: false,
      });
      syncedMarkdownRef.current = content;
      syncSlashState(editor);
      applyLocalImagePreviews(editor);
    } finally {
      skipOnUpdateRef.current = false;
    }
  }, [applyLocalImagePreviews, content, editor, syncSlashState]);

  React.useEffect(() => {
    if (!editor) {
      return;
    }

    applyLocalImagePreviews(editor);
  }, [applyLocalImagePreviews, editor]);

  const filteredSlashCommands = React.useMemo(() => {
    if (!slashState) {
      return [];
    }

    if (slashState.query.length === 0) {
      return SLASH_COMMANDS;
    }

    return SLASH_COMMANDS.filter((command) => {
      if (command.label.toLowerCase().includes(slashState.query)) {
        return true;
      }

      return command.aliases.some((alias) => alias.includes(slashState.query));
    });
  }, [slashState]);

  const insertImageFromSource = React.useCallback(
    (sourcePath: string) => {
      const normalizedPath = sourcePath.trim();
      if (!editor || normalizedPath.length === 0) {
        return;
      }

      editor
        .chain()
        .focus()
        .setImage({
          src: normalizedPath,
          alt: IMAGE_ALT_PLACEHOLDER,
        })
        .run();

      setImageUrl('');
      setImagePopoverOpen(false);
    },
    [editor],
  );

  const applySlashCommand = React.useCallback(
    (command: SlashCommand) => {
      if (!editor) {
        return;
      }

      if (slashState) {
        editor
          .chain()
          .focus()
          .deleteRange({ from: slashState.from, to: slashState.to })
          .run();
      }

      command.run(editor, {
        openImagePanel: () => {
          setImagePopoverOpen(true);
        },
      });
      setSlashState(undefined);
    },
    [editor, slashState],
  );

  const handleLinkInsert = React.useCallback(() => {
    if (!editor) {
      return;
    }

    const previousUrl = editor.getAttributes('link').href as string | undefined;
    const nextUrl = window.prompt('Enter link URL', previousUrl ?? 'https://');
    if (nextUrl === null) {
      return;
    }

    const normalizedUrl = nextUrl.trim();
    if (normalizedUrl.length === 0) {
      editor.chain().focus().unsetLink().run();
      return;
    }

    editor
      .chain()
      .focus()
      .extendMarkRange('link')
      .setLink({ href: normalizedUrl })
      .run();
  }, [editor]);

  const handleEditorKeyDownCapture = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (!slashState || filteredSlashCommands.length === 0) {
        return;
      }

      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setSlashSelectionIndex((current) => {
          return (current + 1) % filteredSlashCommands.length;
        });
        return;
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setSlashSelectionIndex((current) => {
          return current <= 0 ? filteredSlashCommands.length - 1 : current - 1;
        });
        return;
      }

      if (event.key === 'Escape') {
        event.preventDefault();
        setSlashState(undefined);
        return;
      }

      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
        const command =
          filteredSlashCommands[
            slashSelectionIndex % filteredSlashCommands.length
          ];
        applySlashCommand(command);
      }
    },
    [applySlashCommand, filteredSlashCommands, slashSelectionIndex, slashState],
  );

  if (!editor) {
    return (
      <div className="text-muted-foreground px-8 py-6 text-sm">
        Loading editor...
      </div>
    );
  }

  return (
    <div
      className="relative flex h-full min-h-0 w-full flex-col overflow-hidden"
      onKeyDownCapture={handleEditorKeyDownCapture}
    >
      <div className="border-border/45 bg-background/70 sticky top-0 z-20 flex flex-wrap items-center gap-1 rounded-lg border px-2 py-1.5 backdrop-blur">
        <ToolbarButton
          label="Heading 1"
          active={editor.isActive('heading', { level: 1 })}
          onClick={() =>
            editor.chain().focus().toggleHeading({ level: 1 }).run()
          }
        >
          <Heading1Icon className="size-3.5" />
        </ToolbarButton>
        <ToolbarButton
          label="Heading 2"
          active={editor.isActive('heading', { level: 2 })}
          onClick={() =>
            editor.chain().focus().toggleHeading({ level: 2 }).run()
          }
        >
          <Heading2Icon className="size-3.5" />
        </ToolbarButton>
        <ToolbarButton
          label="Bullet list"
          active={editor.isActive('bulletList')}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
        >
          <ListIcon className="size-3.5" />
        </ToolbarButton>
        <ToolbarButton
          label="Numbered list"
          active={editor.isActive('orderedList')}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
        >
          <ListOrderedIcon className="size-3.5" />
        </ToolbarButton>
        <ToolbarButton
          label="Checklist"
          active={editor.isActive('taskList')}
          onClick={() => editor.chain().focus().toggleTaskList().run()}
        >
          <ListChecksIcon className="size-3.5" />
        </ToolbarButton>
        <ToolbarButton
          label="Quote"
          active={editor.isActive('blockquote')}
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
        >
          <QuoteIcon className="size-3.5" />
        </ToolbarButton>
        <ToolbarButton
          label="Code block"
          active={editor.isActive('codeBlock')}
          onClick={() => editor.chain().focus().toggleCodeBlock().run()}
        >
          <Code2Icon className="size-3.5" />
        </ToolbarButton>
        <ToolbarButton
          label="Divider"
          onClick={() => editor.chain().focus().setHorizontalRule().run()}
        >
          <MinusIcon className="size-3.5" />
        </ToolbarButton>
        <ToolbarButton
          label="Bold"
          active={editor.isActive('bold')}
          onClick={() => editor.chain().focus().toggleBold().run()}
        >
          B
        </ToolbarButton>
        <ToolbarButton
          label="Italic"
          active={editor.isActive('italic')}
          onClick={() => editor.chain().focus().toggleItalic().run()}
        >
          <span className="italic">I</span>
        </ToolbarButton>
        <ToolbarButton
          label="Inline code"
          active={editor.isActive('code')}
          onClick={() => editor.chain().focus().toggleCode().run()}
        >
          {'</>'}
        </ToolbarButton>
        <ToolbarButton
          label="Link"
          active={editor.isActive('link')}
          onClick={handleLinkInsert}
        >
          <LinkIcon className="size-3.5" />
        </ToolbarButton>

        <Popover open={imagePopoverOpen} onOpenChange={setImagePopoverOpen}>
          <PopoverTrigger
            className={cn(
              'inline-flex h-7 items-center justify-center rounded-md border px-2 text-xs transition-colors',
              'text-muted-foreground hover:bg-muted/55 hover:text-foreground border-transparent',
            )}
            aria-label="Insert image"
            title="Insert image"
          >
            <ImageIcon className="size-3.5" />
          </PopoverTrigger>
          <PopoverContent className="w-xl max-w-[calc(100vw-2rem)] p-3">
            <div className="space-y-2">
              <div className="bg-muted/50 inline-flex rounded-md p-0.5">
                <button
                  type="button"
                  className={cn(
                    'rounded-sm px-2 py-1 text-[11px] font-medium transition-colors',
                    imageTab === 'assets'
                      ? 'bg-background text-foreground'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                  onClick={() => setImageTab('assets')}
                >
                  Assets
                </button>
                <button
                  type="button"
                  className={cn(
                    'rounded-sm px-2 py-1 text-[11px] font-medium transition-colors',
                    imageTab === 'url'
                      ? 'bg-background text-foreground'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                  onClick={() => setImageTab('url')}
                >
                  URL
                </button>
              </div>

              {imageTab === 'assets' ? (
                currentFilePath ? (
                  <ImageAssetBrowser
                    currentFilePath={currentFilePath}
                    sourceMode={imageSourceMode}
                    onSourceModeChange={setImageSourceMode}
                    onSelectPath={insertImageFromSource}
                  />
                ) : (
                  <p className="text-muted-foreground text-xs">
                    Select a file to browse project assets.
                  </p>
                )
              ) : (
                <div className="space-y-2">
                  <Input
                    value={imageUrl}
                    onChange={(event) => setImageUrl(event.target.value)}
                    className="bg-muted/50"
                    placeholder="Paste image URL or path"
                    aria-label="Image URL"
                  />
                  <div className="flex justify-end">
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        if (imageUrl.trim().length === 0) {
                          return;
                        }

                        insertImageFromSource(imageUrl);
                      }}
                    >
                      Insert image
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </PopoverContent>
        </Popover>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <div className="mx-auto w-full max-w-3xl px-8 py-6">
          <EditorContent editor={editor} />
        </div>
      </div>

      {slashState && filteredSlashCommands.length > 0 ? (
        <div className="border-border/45 bg-background/90 absolute top-14 left-8 z-30 w-64 rounded-lg border p-1 shadow-xl backdrop-blur-sm">
          {filteredSlashCommands.map((command, index) => (
            <button
              key={command.key}
              type="button"
              className={cn(
                'w-full rounded-md px-2 py-1.5 text-left text-xs transition-colors',
                index === slashSelectionIndex
                  ? 'bg-muted text-foreground'
                  : 'text-muted-foreground hover:bg-muted/70 hover:text-foreground',
              )}
              onMouseDown={(event) => {
                event.preventDefault();
                applySlashCommand(command);
              }}
            >
              {command.label}
            </button>
          ))}
        </div>
      ) : null}

      {slashState && filteredSlashCommands.length === 0 ? (
        <div className="text-muted-foreground border-border/45 bg-background/90 absolute top-14 left-8 z-30 rounded-lg border px-2 py-1 text-xs shadow-xl backdrop-blur-sm">
          No slash commands found.
        </div>
      ) : null}
    </div>
  );
}
