import { Textarea } from '#/components/ui/textarea';
import RichEditor from '#/components/editor/RichEditor';
import { useFrontmatterEditorStore } from '#/stores/frontmatterEditorStore';

type EditorProps = {
  currentFilePath?: string;
};

function Editor({ currentFilePath }: EditorProps) {
  const contentDraft = useFrontmatterEditorStore((state) => state.contentDraft);
  const setContentDraft = useFrontmatterEditorStore(
    (state) => state.setContentDraft,
  );
  const editorMode = useFrontmatterEditorStore((state) => state.editorMode);
  const richModeAvailability = useFrontmatterEditorStore(
    (state) => state.richModeAvailability,
  );
  const richModeBlockReason = useFrontmatterEditorStore(
    (state) => state.richModeBlockReason,
  );
  const showRichFallbackNotice =
    editorMode === 'basic' &&
    richModeAvailability === 'blocked' &&
    !!richModeBlockReason;

  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden">
      {showRichFallbackNotice ? (
        <div className="text-muted-foreground border-border/40 mx-auto mb-2 w-full max-w-3xl rounded-md border border-dashed px-3 py-2 text-xs">
          Rich mode is unavailable for this file because it{' '}
          {richModeBlockReason}.
        </div>
      ) : null}

      <div className="flex h-full min-h-0 w-full overflow-hidden">
        {editorMode === 'rich' && richModeAvailability === 'supported' ? (
          <RichEditor
            content={contentDraft}
            currentFilePath={currentFilePath}
            onChange={setContentDraft}
          />
        ) : (
          <div className="mx-auto flex h-full min-h-0 w-full max-w-3xl flex-col overflow-hidden">
            <Textarea
              id="editor-content"
              className="placeholder:text-muted-foreground/65 field-sizing-fixed h-full min-h-0 flex-1 resize-none overflow-auto rounded-none border-0 bg-transparent! px-8 py-6 text-[16px] leading-8 shadow-none focus-visible:border-transparent focus-visible:ring-0"
              value={contentDraft}
              onChange={(event) => {
                setContentDraft(event.target.value);
              }}
              placeholder="Start writing your article..."
            />
          </div>
        )}
      </div>
    </div>
  );
}

export default Editor;
