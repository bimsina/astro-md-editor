import { Button } from '#/components/ui/button';
import { Badge } from '#/components/ui/badge';
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
  getFileDisplayLabel,
  getSortedCollectionFiles,
  type CollectionData,
} from '#/lib/editor-selection';

type LeftSidebarProps = {
  collections: CollectionData[];
  selectedCollectionName?: string;
  selectedFileId?: string;
  onSelectCollection: (collectionName: string) => void;
  onSelectFile: (fileId: string) => void;
};

export default function LeftSidebar({
  collections,
  selectedCollectionName,
  selectedFileId,
  onSelectCollection,
  onSelectFile,
}: LeftSidebarProps) {
  const selectedCollection = collections.find(
    (collection) => collection.name === selectedCollectionName,
  );
  const files = getSortedCollectionFiles(selectedCollection);

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

      <div className="bg-background/35 min-h-0 flex-1 overflow-auto rounded-md p-1">
        {files.length === 0 ? (
          <p className="text-muted-foreground px-2 py-2 text-sm">
            No files in this collection.
          </p>
        ) : (
          <div className="space-y-0.5">
            {files.map((file) => {
              const isActive = file.id === selectedFileId;
              const title = getFileDisplayLabel(file);
              const slug = file.id;
              const isMdxFile = /\.mdx$/i.test(file.filePath);
              const isDraft = file.data.draft === true;

              return (
                <Button
                  key={file.id}
                  type="button"
                  variant="ghost"
                  className={cn(
                    'h-auto w-full justify-start border-0 px-2.5 py-3 text-left shadow-none',
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
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
