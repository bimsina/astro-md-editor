import { Textarea } from '#/components/ui/textarea';
import { useFrontmatterEditorStore } from '#/stores/frontmatterEditorStore';

function Editor() {
  const contentDraft = useFrontmatterEditorStore((state) => state.contentDraft);
  const setContentDraft = useFrontmatterEditorStore(
    (state) => state.setContentDraft,
  );

  return (
    <div className="flex h-full min-h-0 w-full overflow-hidden">
      <div className="mx-auto flex h-full min-h-0 w-full max-w-3xl flex-col overflow-hidden">
        <Textarea
          id="editor-content"
          className="placeholder:text-muted-foreground/65 field-sizing-fixed h-full min-h-0 flex-1 resize-none overflow-auto rounded-none border-0 bg-transparent px-8 py-6 text-[16px] leading-8 shadow-none focus-visible:border-transparent focus-visible:ring-0"
          value={contentDraft}
          onChange={(event) => {
            setContentDraft(event.target.value);
          }}
          placeholder="Start writing your article..."
        />
      </div>
    </div>
  );
}

export default Editor;
