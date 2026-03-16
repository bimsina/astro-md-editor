import * as React from 'react';
import {
  ArrowUpDownIcon,
  Loader2Icon,
  SearchIcon,
  Trash2Icon,
} from 'lucide-react';
import { Button } from '#/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '#/components/ui/alert-dialog';
import { Badge } from '#/components/ui/badge';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandSeparator,
} from '#/components/ui/command';
import { Input } from '#/components/ui/input';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '#/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select';
import { cn } from '#/lib/utils';
import {
  DEFAULT_SORT,
  getFileDisplayLabel,
  getSortableFields,
  getSortedCollectionFiles,
  PRESET_SORT_OPTIONS,
  sortOptionToValue,
  valueToSortOption,
  type CollectionData,
  type SortOption,
} from '#/lib/editor-selection';
import {
  resolveAstroObjectSchema,
  resolveSchemaFields,
  type FieldUiMap,
} from '#/lib/schema-form';

const SORT_STORAGE_KEY = 'astro-md-editor:sort';

function loadSortOption(): SortOption {
  try {
    const stored = window.localStorage.getItem(SORT_STORAGE_KEY);
    if (stored) {
      return valueToSortOption(stored);
    }
  } catch {
    // ignore
  }
  return DEFAULT_SORT;
}

function saveSortOption(option: SortOption): void {
  try {
    window.localStorage.setItem(SORT_STORAGE_KEY, sortOptionToValue(option));
  } catch {
    // ignore
  }
}

type LeftSidebarProps = {
  collections: CollectionData[];
  selectedCollectionName?: string;
  selectedFileId?: string;
  onSelectCollection: (collectionName: string) => void;
  onSelectFile: (fileId: string) => void;
  onCreateFile: (slug: string) => void | Promise<void>;
  onDeleteFile: (fileId: string) => void | Promise<void>;
  isCreatingFile?: boolean;
  deletingFileId?: string;
  schema?: Record<string, {}>;
  fieldUi?: FieldUiMap;
};

export default function LeftSidebar({
  collections,
  selectedCollectionName,
  selectedFileId,
  onSelectCollection,
  onSelectFile,
  onCreateFile,
  onDeleteFile,
  isCreatingFile,
  deletingFileId,
  schema,
  fieldUi,
}: LeftSidebarProps) {
  const [deleteCandidate, setDeleteCandidate] = React.useState<{
    id: string;
    label: string;
  } | null>(null);
  const [searchQuery, setSearchQuery] = React.useState('');
  const [sortOption, setSortOption] = React.useState<SortOption>(DEFAULT_SORT);

  React.useEffect(() => {
    setSortOption(loadSortOption());
  }, []);

  React.useEffect(() => {
    setSearchQuery('');
  }, [selectedCollectionName]);

  const selectedCollection = collections.find(
    (collection) => collection.name === selectedCollectionName,
  );

  const allFiles = getSortedCollectionFiles(selectedCollection, sortOption);
  const files = searchQuery.trim()
    ? allFiles.filter((file) => {
        const q = searchQuery.toLowerCase();
        return (
          getFileDisplayLabel(file).toLowerCase().includes(q) ||
          file.id.toLowerCase().includes(q)
        );
      })
    : allFiles;

  const sortableFields = React.useMemo(() => {
    if (!schema) return [];
    const objectSchema = resolveAstroObjectSchema(
      schema as Record<string, unknown>,
    );
    if (!objectSchema) return [];
    const resolved = resolveSchemaFields(objectSchema, fieldUi);
    return getSortableFields(resolved);
  }, [schema, fieldUi]);

  const [sortOpen, setSortOpen] = React.useState(false);

  const handleSortSelect = React.useCallback((value: string) => {
    const next = valueToSortOption(value);
    setSortOption(next);
    saveSortOption(next);
    setSortOpen(false);
  }, []);

  const sortValue = sortOptionToValue(sortOption);

  return (
    <div className="flex h-full flex-col gap-3">
      <Select
        value={selectedCollectionName}
        onValueChange={(nextCollectionName) => {
          if (!nextCollectionName) {
            return;
          }

          onSelectCollection(nextCollectionName);
        }}
      >
        <SelectTrigger className="bg-muted/50 focus-visible:ring-ring/35 w-full border-transparent shadow-none focus-visible:border-transparent focus-visible:ring-2">
          <SelectValue placeholder="Select a collection" />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {collections.map((collection) => (
              <SelectItem key={collection.name} value={collection.name}>
                {collection.name}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>

      <div className="relative">
        <SearchIcon className="text-muted-foreground pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2" />
        <Input
          id="file-search-input"
          placeholder="Search files..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="h-7 pr-7 pl-7 text-xs"
        />
        <Popover open={sortOpen} onOpenChange={setSortOpen}>
          <PopoverTrigger
            className="text-muted-foreground hover:text-foreground absolute top-1/2 right-0.5 flex size-6 -translate-y-1/2 cursor-pointer items-center justify-center rounded-md"
            aria-label="Sort files"
          >
            <ArrowUpDownIcon className="size-3.5" />
          </PopoverTrigger>
          <PopoverContent align="end" className="w-52 p-0">
            <Command>
              <CommandInput placeholder="Search sort..." />
              <CommandEmpty>No sort option found.</CommandEmpty>
              <CommandGroup heading="Sort">
                {PRESET_SORT_OPTIONS.map((preset) => {
                  const val = sortOptionToValue(preset.option);
                  return (
                    <CommandItem
                      key={val}
                      value={val}
                      data-checked={sortValue === val}
                      onSelect={handleSortSelect}
                    >
                      {preset.label}
                    </CommandItem>
                  );
                })}
              </CommandGroup>
              {sortableFields.length > 0 ? (
                <>
                  <CommandSeparator />
                  <CommandGroup heading="Frontmatter fields">
                    {sortableFields.map((field) => {
                      const ascVal = `field:${field.key}:asc`;
                      const descVal = `field:${field.key}:desc`;
                      return (
                        <React.Fragment key={field.key}>
                          <CommandItem
                            value={ascVal}
                            data-checked={sortValue === ascVal}
                            onSelect={handleSortSelect}
                          >
                            {field.label} (asc)
                          </CommandItem>
                          <CommandItem
                            value={descVal}
                            data-checked={sortValue === descVal}
                            onSelect={handleSortSelect}
                          >
                            {field.label} (desc)
                          </CommandItem>
                        </React.Fragment>
                      );
                    })}
                  </CommandGroup>
                </>
              ) : null}
            </Command>
          </PopoverContent>
        </Popover>
      </div>

      <div className="bg-background/35 min-h-0 flex-1 overflow-auto rounded-md p-1">
        {files.length === 0 ? (
          <p className="text-muted-foreground px-2 py-2 text-sm">
            {searchQuery.trim()
              ? 'No matching files.'
              : 'No files in this collection.'}
          </p>
        ) : (
          <div className="space-y-0.5">
            {files.map((file) => {
              const isActive = file.id === selectedFileId;
              const title = getFileDisplayLabel(file);
              const slug = file.id;
              const isMdxFile = /\.mdx$/i.test(file.filePath);
              const isDraft = file.data.draft === true;

              const isDeleting = deletingFileId === file.id;

              return (
                <div key={file.id} className="group/item relative">
                  <Button
                    type="button"
                    variant="ghost"
                    className={cn(
                      'h-auto w-full justify-start border-0 px-2.5 py-3 pr-9 text-left shadow-none',
                      'hover:bg-background/70',
                      isActive && 'bg-muted text-foreground hover:bg-muted/55',
                    )}
                    onClick={() => onSelectFile(file.id)}
                    title={file.filePath}
                  >
                    <span className="flex w-full min-w-0 flex-col items-start gap-0.5">
                      <span className={'w-full truncate text-sm font-normal'}>
                        {title}
                      </span>
                      <span className="flex w-full min-w-0 items-center gap-1.5">
                        <span className="text-muted-foreground min-w-0 flex-1 truncate text-xs">
                          {slug}
                        </span>
                        {isMdxFile ? (
                          <Badge
                            variant="secondary"
                            className="bg-muted h-4 border-transparent px-1.5 text-[10px] leading-none"
                          >
                            MDX
                          </Badge>
                        ) : null}
                        {isDraft ? (
                          <Badge
                            variant="outline"
                            className="h-4 border-transparent bg-amber-100 px-1.5 text-[10px] leading-none text-amber-900 dark:bg-amber-900/40 dark:text-amber-200"
                          >
                            Draft
                          </Badge>
                        ) : null}
                      </span>
                    </span>
                  </Button>

                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className={cn(
                      'absolute top-2 right-1.5 size-7 border-0 opacity-0 transition-opacity',
                      'group-hover/item:opacity-100 focus-visible:opacity-100',
                      'text-muted-foreground hover:text-destructive',
                    )}
                    aria-label={`Delete ${title}`}
                    disabled={isDeleting}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      setDeleteCandidate({
                        id: file.id,
                        label: title,
                      });
                    }}
                  >
                    {isDeleting ? (
                      <Loader2Icon className="size-4 animate-spin" />
                    ) : (
                      <Trash2Icon className="size-4" />
                    )}
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <Button
        type="button"
        variant="outline"
        className="w-full"
        disabled={!selectedCollection || isCreatingFile}
        onClick={async () => {
          const rawSlug = window.prompt('Enter slug (e.g. my-new-post)');
          if (!rawSlug) {
            return;
          }

          await onCreateFile(rawSlug);
        }}
      >
        {isCreatingFile ? (
          <Loader2Icon className="size-4 animate-spin" />
        ) : null}
        New file
      </Button>

      <AlertDialog
        open={deleteCandidate !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteCandidate(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete file?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete "{deleteCandidate?.label}" from disk.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={!!deletingFileId}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              variant={'destructive'}
              disabled={!deleteCandidate || !!deletingFileId}
              onClick={async () => {
                if (!deleteCandidate) {
                  return;
                }

                await onDeleteFile(deleteCandidate.id);
                setDeleteCandidate(null);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
