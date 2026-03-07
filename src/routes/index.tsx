import { createFileRoute } from '@tanstack/react-router';
import { createServerFn } from '@tanstack/react-start';
import * as React from 'react';
import { toast } from 'sonner';
import {
  Loader2Icon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
  PanelRightCloseIcon,
  PanelRightOpenIcon,
  SaveIcon,
} from 'lucide-react';
import { Button } from '#/components/ui/button';
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '#/components/ui/resizable';
import { useCollectionsData } from '#/hooks/useCollectionsData';
import LeftSidebar from '#/components/editor/LeftSidebar';
import Editor from '#/components/editor';
import RightSidebar from '#/components/editor/RightSidebar';
import ThemeToggle from '#/components/ThemeToggle';
import {
  areEditorSearchEqual,
  type CollectionData,
  getFileDisplayLabel,
  getSortedCollectionFiles,
  resolveEditorSelection,
  type EditorSearch,
} from '#/lib/editor-selection';
import {
  createEditorSelection,
  deleteEditorSelection,
  saveEditorSelection,
} from '#/lib/file-save.server';
import { cn } from '#/lib/utils';
import { useFrontmatterEditorStore } from '#/stores/frontmatterEditorStore';
import type { PanelImperativeHandle } from 'react-resizable-panels';

type SaveSelectionPayload = {
  collectionName: string;
  fileId: string;
  draft: Record<string, unknown>;
  content: string;
};
type DeleteSelectionPayload = {
  collectionName: string;
  fileId: string;
};
type CreateSelectionPayload = {
  collectionName: string;
  slug: string;
};

const EDITOR_MODE_STORAGE_KEY = 'astro-md-editor:editor-mode';

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const saveSelectionToFile = createServerFn({ method: 'POST' })
  .inputValidator((payload: unknown): SaveSelectionPayload => {
    if (!isObjectRecord(payload)) {
      throw new Error('Invalid save payload.');
    }

    const collectionName = payload.collectionName;
    const fileId = payload.fileId;
    const draft = payload.draft;
    const content = payload.content;

    if (typeof collectionName !== 'string' || collectionName.length === 0) {
      throw new Error('Missing collection name.');
    }

    if (typeof fileId !== 'string' || fileId.length === 0) {
      throw new Error('Missing file id.');
    }

    if (!isObjectRecord(draft)) {
      throw new Error('Invalid frontmatter draft.');
    }

    if (typeof content !== 'string') {
      throw new Error('Invalid markdown content.');
    }

    return {
      collectionName,
      fileId,
      draft,
      content,
    };
  })
  .handler(async ({ data }) => {
    return saveEditorSelection(data);
  });

const deleteSelectionFromFile = createServerFn({ method: 'POST' })
  .inputValidator((payload: unknown): DeleteSelectionPayload => {
    if (!isObjectRecord(payload)) {
      throw new Error('Invalid delete payload.');
    }

    const collectionName = payload.collectionName;
    const fileId = payload.fileId;
    if (typeof collectionName !== 'string' || collectionName.length === 0) {
      throw new Error('Missing collection name.');
    }
    if (typeof fileId !== 'string' || fileId.length === 0) {
      throw new Error('Missing file id.');
    }

    return {
      collectionName,
      fileId,
    };
  })
  .handler(async ({ data }) => {
    return deleteEditorSelection(data);
  });

const createSelectionFile = createServerFn({ method: 'POST' })
  .inputValidator((payload: unknown): CreateSelectionPayload => {
    if (!isObjectRecord(payload)) {
      throw new Error('Invalid create payload.');
    }

    const collectionName = payload.collectionName;
    const slug = payload.slug;
    if (typeof collectionName !== 'string' || collectionName.length === 0) {
      throw new Error('Missing collection name.');
    }
    if (typeof slug !== 'string' || slug.length === 0) {
      throw new Error('Missing slug.');
    }

    return {
      collectionName,
      slug,
    };
  })
  .handler(async ({ data }) => {
    return createEditorSelection(data);
  });

export const Route = createFileRoute('/')({
  validateSearch: (search: Record<string, unknown>): EditorSearch => {
    const record = search;
    const collection =
      typeof record.collection === 'string' && record.collection.length > 0
        ? record.collection
        : undefined;
    const file =
      typeof record.file === 'string' && record.file.length > 0
        ? record.file
        : undefined;

    return {
      collection,
      file,
    };
  },
  component: App,
});

function App() {
  const data = useCollectionsData();
  const [collections, setCollections] = React.useState<CollectionData[]>(data);
  const search = Route.useSearch();
  const [leftOpen, setLeftOpen] = React.useState(true);
  const [rightOpen, setRightOpen] = React.useState(true);
  const [isSaving, setIsSaving] = React.useState(false);
  const [isCreatingFile, setIsCreatingFile] = React.useState(false);
  const [deletingFileId, setDeletingFileId] = React.useState<
    string | undefined
  >();
  const [saveError, setSaveError] = React.useState<string | undefined>();
  const leftPanelRef = React.useRef<PanelImperativeHandle | null>(null);
  const rightPanelRef = React.useRef<PanelImperativeHandle | null>(null);
  const navigate = Route.useNavigate();
  const draft = useFrontmatterEditorStore((state) => state.draft);
  const contentDraft = useFrontmatterEditorStore((state) => state.contentDraft);
  const dirty = useFrontmatterEditorStore((state) => state.dirty);
  const editorMode = useFrontmatterEditorStore((state) => state.editorMode);
  const setEditorMode = useFrontmatterEditorStore(
    (state) => state.setEditorMode,
  );
  const richModeAvailability = useFrontmatterEditorStore(
    (state) => state.richModeAvailability,
  );
  const richModeBlockReason = useFrontmatterEditorStore(
    (state) => state.richModeBlockReason,
  );
  const loadSelection = useFrontmatterEditorStore(
    (state) => state.loadSelection,
  );
  const clearSelection = useFrontmatterEditorStore(
    (state) => state.clearSelection,
  );
  const commitSavedState = useFrontmatterEditorStore(
    (state) => state.commitSavedState,
  );

  React.useEffect(() => {
    setCollections(data);
  }, [data]);

  const { selectedCollection, selectedFile, normalizedSearch } = React.useMemo(
    () => resolveEditorSelection(collections, search),
    [collections, search],
  );

  React.useEffect(() => {
    if (areEditorSearchEqual(search, normalizedSearch)) {
      return;
    }

    void navigate({
      search: normalizedSearch,
      replace: true,
    });
  }, [navigate, normalizedSearch, search]);

  React.useEffect(() => {
    if (!selectedCollection || !selectedFile) {
      clearSelection();
      return;
    }

    loadSelection({
      collectionName: selectedCollection.name,
      fileId: selectedFile.id,
      data: selectedFile.data,
      content: selectedFile.content,
    });
  }, [clearSelection, loadSelection, selectedCollection, selectedFile]);

  React.useEffect(() => {
    if (!dirty) {
      return;
    }

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [dirty]);

  React.useEffect(() => {
    const storedMode = window.localStorage.getItem(EDITOR_MODE_STORAGE_KEY);
    if (storedMode === 'basic' || storedMode === 'rich') {
      setEditorMode(storedMode);
    }
  }, [setEditorMode]);

  React.useEffect(() => {
    window.localStorage.setItem(EDITOR_MODE_STORAGE_KEY, editorMode);
  }, [editorMode]);

  const canNavigateAway = React.useCallback(() => {
    if (!dirty) {
      return true;
    }

    return window.confirm(
      'You have unsaved changes. Discard changes and continue?',
    );
  }, [dirty]);

  const selectCollection = React.useCallback(
    (collectionName: string) => {
      const nextCollection = collections.find(
        (collection) => collection.name === collectionName,
      );
      if (!nextCollection) {
        return;
      }

      const nextFile = getSortedCollectionFiles(nextCollection).at(0);
      const nextSearch: EditorSearch = {
        collection: nextCollection.name,
        file: nextFile?.id,
      };

      if (areEditorSearchEqual(normalizedSearch, nextSearch)) {
        return;
      }

      if (!canNavigateAway()) {
        return;
      }

      void navigate({
        search: nextSearch,
      });
    },
    [canNavigateAway, collections, navigate, normalizedSearch],
  );

  const selectFile = React.useCallback(
    (fileId: string) => {
      if (!selectedCollection) {
        return;
      }

      const nextSearch: EditorSearch = {
        collection: selectedCollection.name,
        file: fileId,
      };

      if (areEditorSearchEqual(normalizedSearch, nextSearch)) {
        return;
      }

      if (!canNavigateAway()) {
        return;
      }

      void navigate({
        search: nextSearch,
      });
    },
    [canNavigateAway, navigate, normalizedSearch, selectedCollection],
  );

  const toggleLeftSidebar = React.useCallback(() => {
    const panel = leftPanelRef.current;
    if (!panel) {
      setLeftOpen((open) => !open);
      return;
    }

    if (panel.isCollapsed()) {
      panel.expand();
      setLeftOpen(true);
      return;
    }

    panel.collapse();
    setLeftOpen(false);
  }, []);

  const toggleRightSidebar = React.useCallback(() => {
    const panel = rightPanelRef.current;
    if (!panel) {
      setRightOpen((open) => !open);
      return;
    }

    if (panel.isCollapsed()) {
      panel.expand();
      setRightOpen(true);
      return;
    }

    panel.collapse();
    setRightOpen(false);
  }, []);

  const syncSidebarState = React.useCallback(() => {
    const nextLeftOpen = !(leftPanelRef.current?.isCollapsed() ?? false);
    const nextRightOpen = !(rightPanelRef.current?.isCollapsed() ?? false);

    setLeftOpen((current) =>
      current === nextLeftOpen ? current : nextLeftOpen,
    );
    setRightOpen((current) =>
      current === nextRightOpen ? current : nextRightOpen,
    );
  }, []);

  const handleSave = React.useCallback(async () => {
    if (!selectedCollection || !selectedFile || !dirty || isSaving) {
      return;
    }

    setIsSaving(true);
    setSaveError(undefined);

    try {
      await saveSelectionToFile({
        data: {
          collectionName: selectedCollection.name,
          fileId: selectedFile.id,
          draft,
          content: contentDraft,
        },
      });
      commitSavedState();
      toast.success(`Saved ${getFileDisplayLabel(selectedFile)}.`);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to save file.';
      setSaveError(message);
      toast.error(message);
    } finally {
      setIsSaving(false);
    }
  }, [
    commitSavedState,
    contentDraft,
    dirty,
    draft,
    isSaving,
    selectedCollection,
    selectedFile,
  ]);

  const handleDeleteFile = React.useCallback(
    async (fileId: string) => {
      if (!selectedCollection || deletingFileId) {
        return;
      }

      const fileToDelete = selectedCollection.files.find(
        (file) => file.id === fileId,
      );
      if (!fileToDelete) {
        return;
      }

      if (dirty && selectedFile?.id === fileId) {
        const discardConfirmed = window.confirm(
          'This file has unsaved changes. Delete it anyway?',
        );
        if (!discardConfirmed) {
          return;
        }
      }

      setDeletingFileId(fileId);
      setSaveError(undefined);

      try {
        await deleteSelectionFromFile({
          data: {
            collectionName: selectedCollection.name,
            fileId,
          },
        });

        setCollections((current) =>
          current.map((collection) => {
            if (collection.name !== selectedCollection.name) {
              return collection;
            }

            return {
              ...collection,
              files: collection.files.filter((file) => file.id !== fileId),
            };
          }),
        );

        toast.success(`Deleted ${getFileDisplayLabel(fileToDelete)}.`);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unable to delete file.';
        toast.error(message);
      } finally {
        setDeletingFileId(undefined);
      }
    },
    [deletingFileId, dirty, selectedCollection, selectedFile?.id],
  );

  const handleCreateFile = React.useCallback(
    async (slug: string) => {
      if (!selectedCollection || isCreatingFile) {
        return;
      }

      setIsCreatingFile(true);
      setSaveError(undefined);

      try {
        const result = await createSelectionFile({
          data: {
            collectionName: selectedCollection.name,
            slug,
          },
        });

        const fileLabel = result.fileId;
        setCollections((current) =>
          current.map((collection) => {
            if (collection.name !== selectedCollection.name) {
              return collection;
            }

            return {
              ...collection,
              files: [
                ...collection.files,
                {
                  id: result.fileId,
                  filePath: result.filePath,
                  data: {},
                  content: '',
                },
              ],
            };
          }),
        );

        await navigate({
          search: {
            collection: selectedCollection.name,
            file: result.fileId,
          },
        });

        toast.success(`Created ${fileLabel}.`);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unable to create file.';
        toast.error(message);
      } finally {
        setIsCreatingFile(false);
      }
    },
    [isCreatingFile, navigate, selectedCollection],
  );

  React.useEffect(() => {
    setSaveError(undefined);
  }, [selectedCollection?.name, selectedFile?.id]);

  const selectedFileLabel = selectedFile
    ? getFileDisplayLabel(selectedFile)
    : 'No file selected';

  return (
    <div className="h-svh w-screen overflow-hidden p-2">
      <ResizablePanelGroup
        orientation="horizontal"
        onLayoutChanged={syncSidebarState}
        defaultLayout={{
          'editor-left-sidebar': 18,
          'editor-main-panel': 64,
          'editor-right-sidebar': 18,
        }}
      >
        <ResizablePanel
          id="editor-left-sidebar"
          panelRef={leftPanelRef}
          collapsible
          collapsedSize={0}
          defaultSize="18%"
          minSize="14%"
          maxSize="40%"
          className="min-w-0"
        >
          <aside className="bg-background/55 flex h-full flex-col overflow-hidden rounded-xl px-2.5 py-3 backdrop-blur-sm">
            <LeftSidebar
              collections={collections}
              selectedCollectionName={selectedCollection?.name}
              selectedFileId={selectedFile?.id}
              onSelectCollection={selectCollection}
              onSelectFile={selectFile}
              onCreateFile={handleCreateFile}
              onDeleteFile={handleDeleteFile}
              isCreatingFile={isCreatingFile}
              deletingFileId={deletingFileId}
            />
          </aside>
        </ResizablePanel>

        <ResizableHandle
          withHandle
          className={cn(
            leftOpen ? 'mx-1 w-2 bg-transparent' : 'mx-0 w-0',
            !leftOpen && 'pointer-events-none opacity-0',
          )}
        />

        <ResizablePanel
          id="editor-main-panel"
          minSize="30%"
          className="min-w-0"
        >
          <main className="bg-background/75 flex h-full w-full min-w-0 flex-1 flex-col overflow-hidden rounded-xl px-3 py-2 backdrop-blur-sm">
            <header className="border-border/45 flex items-center justify-between gap-3 border-b pb-2">
              <div className="flex shrink-0 items-center gap-1.5">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={toggleLeftSidebar}
                  aria-label={
                    leftOpen ? 'Hide left sidebar' : 'Show left sidebar'
                  }
                  className="text-muted-foreground hover:bg-background/65 hover:text-foreground size-8 border-0"
                >
                  {leftOpen ? <PanelLeftCloseIcon /> : <PanelLeftOpenIcon />}
                </Button>
                <ThemeToggle />
              </div>

              <p
                className="text-foreground/85 min-w-0 flex-1 truncate text-center text-sm font-medium"
                title={selectedFile?.id}
              >
                {selectedFileLabel}
              </p>

              <div className="flex shrink-0 items-center justify-end gap-2">
                <div className="bg-muted/55 inline-flex rounded-md p-0.5">
                  <button
                    type="button"
                    className={cn(
                      'rounded-sm px-2 py-1 text-xs font-medium transition-colors',
                      editorMode === 'basic'
                        ? 'bg-background text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                    onClick={() => setEditorMode('basic')}
                    aria-label="Use basic editor mode"
                  >
                    Basic
                  </button>
                  <button
                    type="button"
                    className={cn(
                      'rounded-sm px-2 py-1 text-xs font-medium transition-colors',
                      editorMode === 'rich'
                        ? 'bg-background text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                    onClick={() => setEditorMode('rich')}
                    disabled={richModeAvailability === 'blocked'}
                    aria-label="Use rich editor mode"
                    title={
                      richModeAvailability === 'blocked'
                        ? `Rich mode unavailable: ${richModeBlockReason ?? 'unsupported syntax detected'}`
                        : 'Use rich editor mode'
                    }
                  >
                    Rich
                  </button>
                </div>
                {dirty ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={handleSave}
                    disabled={isSaving || !selectedCollection || !selectedFile}
                    className="border-0"
                  >
                    {isSaving ? (
                      <Loader2Icon className="animate-spin" />
                    ) : (
                      <SaveIcon />
                    )}
                    Save
                  </Button>
                ) : null}
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={toggleRightSidebar}
                  aria-label={
                    rightOpen ? 'Hide right sidebar' : 'Show right sidebar'
                  }
                  className="text-muted-foreground hover:bg-background/65 hover:text-foreground size-8 border-0"
                >
                  {rightOpen ? <PanelRightCloseIcon /> : <PanelRightOpenIcon />}
                </Button>
              </div>
            </header>

            {saveError ? (
              <p className="text-destructive/90 pt-2 text-xs">{saveError}</p>
            ) : null}

            <div className="flex min-h-0 flex-1 overflow-hidden pt-1">
              <Editor currentFilePath={selectedFile?.filePath} />
            </div>
          </main>
        </ResizablePanel>

        <ResizableHandle
          withHandle
          className={cn(
            rightOpen ? 'mx-1 w-2 bg-transparent' : 'mx-0 w-0',
            !rightOpen && 'pointer-events-none opacity-0',
          )}
        />

        <ResizablePanel
          id="editor-right-sidebar"
          panelRef={rightPanelRef}
          collapsible
          collapsedSize={0}
          defaultSize="18%"
          minSize="14%"
          maxSize="40%"
          className="min-w-0"
        >
          <aside className="bg-background/55 flex h-full flex-col overflow-hidden rounded-xl px-2.5 py-3 backdrop-blur-sm">
            <RightSidebar
              selectedCollection={selectedCollection}
              selectedFile={selectedFile}
            />
          </aside>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}
