import * as React from 'react';
import { createServerFn } from '@tanstack/react-start';
import { ImageIcon, Loader2Icon, SearchIcon } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '#/components/ui/badge';
import { buttonVariants } from '#/components/ui/button';
import { Input } from '#/components/ui/input';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '#/components/ui/popover';
import {
  listImageAssetsForFile,
  readImageAssetPreviewById,
  type ImageAssetOption,
} from '#/lib/image-assets.server';
import type { ImageFieldSourceMode } from '#/lib/schema-form';
import { cn } from '#/lib/utils';

const MAX_ASSET_RESULTS = 120;

type ImageAssetBrowserProps = {
  currentFilePath: string;
  sourceMode: ImageFieldSourceMode;
  onSelectPath: (path: string) => void;
  onSourceModeChange?: (mode: ImageFieldSourceMode) => void;
  enabled?: boolean;
  className?: string;
  maxHeightClassName?: string;
};

type ImageAssetPickerPopoverProps = {
  currentFilePath: string;
  sourceMode: ImageFieldSourceMode;
  triggerLabel: string;
  onSelectPath: (path: string) => void;
};

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const listImageAssets = createServerFn({ method: 'POST' })
  .inputValidator(
    (
      payload: unknown,
    ): { currentFilePath: string; sourceMode: ImageFieldSourceMode } => {
      if (!isObjectRecord(payload)) {
        throw new Error('Invalid asset list payload.');
      }

      const currentFilePath = payload.currentFilePath;
      if (typeof currentFilePath !== 'string' || currentFilePath.length === 0) {
        throw new Error('Missing current file path.');
      }

      const sourceMode = payload.sourceMode;
      if (sourceMode !== 'asset' && sourceMode !== 'public') {
        throw new Error('Invalid image source mode.');
      }

      return {
        currentFilePath,
        sourceMode,
      };
    },
  )
  .handler(async ({ data }) => {
    return listImageAssetsForFile(data.currentFilePath, data.sourceMode);
  });

const getImageAssetPreview = createServerFn({ method: 'POST' })
  .inputValidator((payload: unknown): { assetId: string } => {
    if (!isObjectRecord(payload)) {
      throw new Error('Invalid asset preview payload.');
    }

    const assetId = payload.assetId;
    if (typeof assetId !== 'string' || assetId.length === 0) {
      throw new Error('Missing asset id.');
    }

    return {
      assetId,
    };
  })
  .handler(async ({ data }) => {
    const preview = await readImageAssetPreviewById(data.assetId);
    const bodyBytes = new Uint8Array(preview.bytes);
    return new Response(bodyBytes, {
      headers: {
        'Content-Type': preview.mimeType,
        'Cache-Control': 'public, max-age=300',
      },
    });
  });

function AssetThumbnail({
  assetId,
  label,
}: {
  assetId: string;
  label: string;
}) {
  const [previewUrl, setPreviewUrl] = React.useState<string | undefined>();
  const [hasFailed, setHasFailed] = React.useState(false);
  const requestIdRef = React.useRef(0);

  React.useEffect(() => {
    requestIdRef.current += 1;
    const requestId = requestIdRef.current;
    let objectUrl: string | undefined;

    void (async () => {
      try {
        setHasFailed(false);
        const response = await getImageAssetPreview({
          data: {
            assetId,
          },
        });
        if (!response.ok) {
          throw new Error(`Preview request failed (${response.status})`);
        }

        const blob = await response.blob();
        if (requestIdRef.current !== requestId) {
          return;
        }

        objectUrl = URL.createObjectURL(blob);
        setPreviewUrl(objectUrl);
      } catch {
        if (requestIdRef.current !== requestId) {
          return;
        }
        setHasFailed(true);
        setPreviewUrl(undefined);
      }
    })();

    return () => {
      requestIdRef.current += 1;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [assetId]);

  if (previewUrl) {
    return (
      <img
        src={previewUrl}
        alt={label}
        className="h-24 w-full rounded-md object-cover"
      />
    );
  }

  return (
    <div className="bg-muted/55 text-muted-foreground flex h-24 w-full items-center justify-center rounded-md">
      {hasFailed ? (
        <ImageIcon className="size-5" />
      ) : (
        <Loader2Icon className="size-5 animate-spin" />
      )}
    </div>
  );
}

export function ImageAssetBrowser({
  currentFilePath,
  sourceMode,
  onSelectPath,
  onSourceModeChange,
  enabled = true,
  className,
  maxHeightClassName,
}: ImageAssetBrowserProps) {
  const [query, setQuery] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | undefined>();
  const [assets, setAssets] = React.useState<ImageAssetOption[]>([]);
  const [loadedForKey, setLoadedForKey] = React.useState<string | undefined>();

  React.useEffect(() => {
    const requestKey = `${currentFilePath}::${sourceMode}`;
    if (!enabled || loadedForKey === requestKey) {
      return;
    }

    let isCancelled = false;
    setLoading(true);
    setError(undefined);

    void listImageAssets({
      data: {
        currentFilePath,
        sourceMode,
      },
    })
      .then((nextAssets) => {
        if (isCancelled) {
          return;
        }
        setAssets(nextAssets);
        setLoadedForKey(requestKey);
      })
      .catch((fetchError: unknown) => {
        if (isCancelled) {
          return;
        }
        const message =
          fetchError instanceof Error ? fetchError.message : String(fetchError);
        setError(message);
        toast.error(`Unable to load image assets: ${message}`);
      })
      .finally(() => {
        if (!isCancelled) {
          setLoading(false);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [currentFilePath, enabled, loadedForKey, sourceMode]);

  const filteredAssets = React.useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return assets.filter((asset) => {
      if (normalizedQuery.length === 0) {
        return true;
      }

      return (
        asset.displayPath.toLowerCase().includes(normalizedQuery) ||
        asset.value.toLowerCase().includes(normalizedQuery)
      );
    });
  }, [assets, query]);

  const visibleAssets = filteredAssets.slice(0, MAX_ASSET_RESULTS);

  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        {onSourceModeChange ? (
          <div className="bg-muted/50 inline-flex rounded-md p-0.5">
            <button
              type="button"
              className={cn(
                'rounded-sm px-2 py-1 text-[11px] font-medium transition-colors',
                sourceMode === 'asset'
                  ? 'bg-background text-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
              onClick={() => onSourceModeChange('asset')}
            >
              src
            </button>
            <button
              type="button"
              className={cn(
                'rounded-sm px-2 py-1 text-[11px] font-medium transition-colors',
                sourceMode === 'public'
                  ? 'bg-background text-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
              onClick={() => onSourceModeChange('public')}
            >
              public
            </button>
          </div>
        ) : (
          <Badge
            variant="secondary"
            className="bg-muted text-foreground/75 rounded-md border-transparent text-[11px] normal-case"
          >
            source: {sourceMode === 'public' ? 'public' : 'src'}
          </Badge>
        )}

        <div className="relative w-60 max-w-full">
          <SearchIcon className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
          <Input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
            }}
            className="bg-muted/50 focus-visible:ring-ring/35 h-8 border-transparent pl-8 text-xs shadow-none focus-visible:border-transparent focus-visible:ring-2"
            placeholder="Search assets..."
            aria-label="Search assets"
          />
        </div>
      </div>

      {loading ? (
        <div className="text-muted-foreground flex h-32 items-center justify-center gap-2 text-sm">
          <Loader2Icon className="size-4 animate-spin" />
          Loading assets...
        </div>
      ) : null}

      {error ? (
        <div className="text-destructive rounded-md bg-red-500/10 px-3 py-2 text-xs">
          {error}
        </div>
      ) : null}

      {!loading && !error ? (
        <>
          <div
            className={cn(
              'grid grid-cols-3 gap-2 overflow-auto pr-1',
              maxHeightClassName ?? 'max-h-88',
            )}
          >
            {visibleAssets.map((asset) => (
              <button
                key={asset.id}
                type="button"
                className="border-border/40 hover:border-ring/35 bg-muted/25 hover:bg-muted/35 space-y-1.5 rounded-lg border p-1.5 text-left transition-colors"
                onClick={() => {
                  onSelectPath(asset.value);
                  toast.success(`Selected image: ${asset.displayPath}`);
                }}
                title={asset.value}
              >
                <AssetThumbnail assetId={asset.id} label={asset.displayPath} />
                <p className="text-foreground/85 truncate text-[11px]">
                  {asset.displayPath}
                </p>
              </button>
            ))}
          </div>

          {filteredAssets.length === 0 ? (
            <p className="text-muted-foreground text-xs">No assets found.</p>
          ) : null}

          {filteredAssets.length > MAX_ASSET_RESULTS ? (
            <p className="text-muted-foreground text-xs">
              Showing first {MAX_ASSET_RESULTS} assets. Refine search for more.
            </p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

export function ImageAssetPickerPopover({
  currentFilePath,
  sourceMode,
  triggerLabel,
  onSelectPath,
}: ImageAssetPickerPopoverProps) {
  const [open, setOpen] = React.useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className={cn(
          buttonVariants({ variant: 'outline' }),
          'h-8 border-dashed text-xs',
        )}
      >
        <ImageIcon className="size-3.5" />
        {triggerLabel}
      </PopoverTrigger>
      <PopoverContent className="w-136 max-w-[calc(100vw-2rem)] p-3">
        <ImageAssetBrowser
          enabled={open}
          currentFilePath={currentFilePath}
          sourceMode={sourceMode}
          onSelectPath={(path) => {
            onSelectPath(path);
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
