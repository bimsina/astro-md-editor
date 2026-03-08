import * as React from 'react';
import { createServerFn } from '@tanstack/react-start';
import { CheckIcon, Loader2Icon, SearchIcon } from 'lucide-react';
import { toast } from 'sonner';
import { buttonVariants } from '#/components/ui/button';
import { Input } from '#/components/ui/input';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '#/components/ui/popover';
import { cn } from '#/lib/utils';

type IconPickerPopoverProps = {
  triggerLabel?: string;
  triggerClassName?: string;
  triggerAriaLabel?: string;
  triggerContent?: React.ReactNode;
  selectedIcon?: string;
  allowedLibraries?: string[];
  onSelectIcon: (iconifyName: string) => void;
};

type IconifyCollectionOption = {
  prefix: string;
  name: string;
  total: number;
  category?: string;
};

const ICON_ROW_HEIGHT = 36;
const ICON_VIEWPORT_HEIGHT = 288;
const OVERSCAN_ROWS = 8;

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeLibraryPrefixes(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const normalized = [
    ...new Set(
      value
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim().toLowerCase())
        .filter((item) => item.length > 0),
    ),
  ];
  return normalized.length > 0 ? normalized : undefined;
}

function parseIconifyValue(value: string | undefined): {
  prefix?: string;
  name?: string;
} {
  if (!value) {
    return {};
  }

  const normalized = value.trim();
  const separatorIndex = normalized.indexOf(':');
  if (separatorIndex <= 0 || separatorIndex === normalized.length - 1) {
    return {};
  }

  const prefix = normalized.slice(0, separatorIndex).toLowerCase();
  const name = normalized.slice(separatorIndex + 1);
  return {
    prefix,
    name,
  };
}

function buildIconSvgUrl(prefix: string, name: string): string {
  return `https://api.iconify.design/${encodeURIComponent(prefix)}/${encodeURIComponent(name)}.svg?width=20&height=20`;
}

function getIconMaskStyle(iconUrl: string): React.CSSProperties {
  return {
    maskImage: `url("${iconUrl}")`,
    maskRepeat: 'no-repeat',
    maskPosition: 'center',
    maskSize: 'contain',
    WebkitMaskImage: `url("${iconUrl}")`,
    WebkitMaskRepeat: 'no-repeat',
    WebkitMaskPosition: 'center',
    WebkitMaskSize: 'contain',
  };
}

const listIconifyCollectionsServerFn = createServerFn({
  method: 'GET',
}).handler(async (): Promise<IconifyCollectionOption[]> => {
  const response = await fetch(
    'https://api.iconify.design/collections?pretty=0',
  );
  if (!response.ok) {
    throw new Error(`Iconify collections request failed (${response.status})`);
  }

  const payload = (await response.json()) as unknown;
  if (!isObjectRecord(payload)) {
    throw new Error('Invalid Iconify collections response.');
  }

  const collections: IconifyCollectionOption[] = [];
  for (const [prefix, rawValue] of Object.entries(payload)) {
    if (!isObjectRecord(rawValue)) {
      continue;
    }

    const name =
      typeof rawValue.name === 'string' && rawValue.name.trim().length > 0
        ? rawValue.name.trim()
        : prefix;
    const total =
      typeof rawValue.total === 'number' && Number.isFinite(rawValue.total)
        ? rawValue.total
        : 0;
    const category =
      typeof rawValue.category === 'string' &&
      rawValue.category.trim().length > 0
        ? rawValue.category.trim()
        : undefined;

    collections.push({
      prefix,
      name,
      total,
      category,
    });
  }

  return collections.sort((a, b) => {
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  });
});

const listCollectionIconsServerFn = createServerFn({ method: 'POST' })
  .inputValidator((payload: unknown): { prefix: string } => {
    if (!isObjectRecord(payload)) {
      throw new Error('Invalid icon collection payload.');
    }

    const prefix = payload.prefix;
    if (typeof prefix !== 'string' || prefix.trim().length === 0) {
      throw new Error('Missing icon collection prefix.');
    }

    return {
      prefix: prefix.trim().toLowerCase(),
    };
  })
  .handler(async ({ data }): Promise<string[]> => {
    const response = await fetch(
      `https://api.iconify.design/collection?prefix=${encodeURIComponent(data.prefix)}&pretty=0`,
    );
    if (!response.ok) {
      throw new Error(`Iconify collection request failed (${response.status})`);
    }

    const payload = (await response.json()) as unknown;
    if (!isObjectRecord(payload)) {
      throw new Error('Invalid Iconify collection response.');
    }

    const iconNames = new Set<string>();
    const uncategorized = payload.uncategorized;
    if (Array.isArray(uncategorized)) {
      for (const item of uncategorized) {
        if (typeof item === 'string' && item.length > 0) {
          iconNames.add(item);
        }
      }
    }

    const categories = payload.categories;
    if (isObjectRecord(categories)) {
      for (const categoryItems of Object.values(categories)) {
        if (!Array.isArray(categoryItems)) {
          continue;
        }

        for (const item of categoryItems) {
          if (typeof item === 'string' && item.length > 0) {
            iconNames.add(item);
          }
        }
      }
    }

    return [...iconNames].sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: 'base' }),
    );
  });

const collectionsCache: {
  data?: IconifyCollectionOption[];
  promise?: Promise<IconifyCollectionOption[]>;
} = {};
const collectionIconsCache = new Map<
  string,
  {
    data?: string[];
    promise?: Promise<string[]>;
  }
>();

function readCollections(): Promise<IconifyCollectionOption[]> {
  if (collectionsCache.data) {
    return Promise.resolve(collectionsCache.data);
  }

  if (collectionsCache.promise) {
    return collectionsCache.promise;
  }

  collectionsCache.promise = listIconifyCollectionsServerFn()
    .then((collections) => {
      collectionsCache.data = collections;
      return collections;
    })
    .finally(() => {
      collectionsCache.promise = undefined;
    });

  return collectionsCache.promise;
}

function readCollectionIcons(prefix: string): Promise<string[]> {
  const cacheKey = prefix.trim().toLowerCase();
  const cached = collectionIconsCache.get(cacheKey);
  if (cached?.data) {
    return Promise.resolve(cached.data);
  }

  if (cached?.promise) {
    return cached.promise;
  }

  const promise = listCollectionIconsServerFn({
    data: {
      prefix: cacheKey,
    },
  })
    .then((icons) => {
      collectionIconsCache.set(cacheKey, {
        data: icons,
      });
      return icons;
    })
    .finally(() => {
      const nextCached = collectionIconsCache.get(cacheKey);
      if (nextCached) {
        delete nextCached.promise;
      }
    });

  collectionIconsCache.set(cacheKey, {
    data: cached?.data,
    promise,
  });
  return promise;
}

function getVirtualWindow(params: {
  scrollTop: number;
  viewportHeight: number;
  rowHeight: number;
  itemCount: number;
  overscan: number;
}): {
  startIndex: number;
  endIndex: number;
  offsetY: number;
  totalHeight: number;
} {
  const startIndex = Math.max(
    0,
    Math.floor(params.scrollTop / params.rowHeight) - params.overscan,
  );
  const visibleCount = Math.ceil(params.viewportHeight / params.rowHeight);
  const endIndex = Math.min(
    params.itemCount,
    startIndex + visibleCount + params.overscan * 2,
  );

  return {
    startIndex,
    endIndex,
    offsetY: startIndex * params.rowHeight,
    totalHeight: params.itemCount * params.rowHeight,
  };
}

export function IconPickerPopover({
  triggerLabel,
  triggerClassName,
  triggerAriaLabel,
  triggerContent,
  selectedIcon,
  allowedLibraries,
  onSelectIcon,
}: IconPickerPopoverProps) {
  const [open, setOpen] = React.useState(false);
  const [collections, setCollections] = React.useState<
    IconifyCollectionOption[]
  >([]);
  const [collectionsLoading, setCollectionsLoading] = React.useState(false);
  const [collectionsError, setCollectionsError] = React.useState<string>();
  const [selectedPrefix, setSelectedPrefix] = React.useState<string>();
  const [iconNames, setIconNames] = React.useState<string[]>([]);
  const [iconsLoading, setIconsLoading] = React.useState(false);
  const [iconsError, setIconsError] = React.useState<string>();
  const [iconQuery, setIconQuery] = React.useState('');
  const [iconScrollTop, setIconScrollTop] = React.useState(0);

  const parsedSelected = React.useMemo(() => {
    return parseIconifyValue(selectedIcon);
  }, [selectedIcon]);

  const normalizedAllowedLibraries = React.useMemo(() => {
    return normalizeLibraryPrefixes(allowedLibraries);
  }, [allowedLibraries]);

  React.useEffect(() => {
    if (!open) {
      return;
    }

    let cancelled = false;
    setCollectionsLoading(true);
    setCollectionsError(undefined);
    void readCollections()
      .then((nextCollections) => {
        if (cancelled) {
          return;
        }
        setCollections(nextCollections);
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }
        const message = error instanceof Error ? error.message : String(error);
        setCollectionsError(message);
        toast.error(`Unable to load Iconify collections: ${message}`);
      })
      .finally(() => {
        if (!cancelled) {
          setCollectionsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [open]);

  const filteredCollections = React.useMemo(() => {
    const allowed = normalizedAllowedLibraries
      ? new Set(normalizedAllowedLibraries)
      : undefined;

    return collections.filter((collection) => {
      return allowed ? allowed.has(collection.prefix) : true;
    });
  }, [collections, normalizedAllowedLibraries]);

  React.useEffect(() => {
    if (filteredCollections.length === 0) {
      setSelectedPrefix(undefined);
      return;
    }

    if (
      selectedPrefix &&
      filteredCollections.some(
        (collection) => collection.prefix === selectedPrefix,
      )
    ) {
      return;
    }

    const preferredByValue = parsedSelected.prefix
      ? filteredCollections.find(
          (collection) => collection.prefix === parsedSelected.prefix,
        )
      : undefined;
    setSelectedPrefix(
      preferredByValue?.prefix ?? filteredCollections[0].prefix,
    );
  }, [filteredCollections, parsedSelected.prefix, selectedPrefix]);

  React.useEffect(() => {
    if (!open || !selectedPrefix) {
      setIconNames([]);
      return;
    }

    let cancelled = false;
    setIconsLoading(true);
    setIconsError(undefined);
    setIconNames([]);
    void readCollectionIcons(selectedPrefix)
      .then((nextIcons) => {
        if (cancelled) {
          return;
        }
        setIconNames(nextIcons);
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }
        const message = error instanceof Error ? error.message : String(error);
        setIconsError(message);
        toast.error(`Unable to load icons for ${selectedPrefix}: ${message}`);
      })
      .finally(() => {
        if (!cancelled) {
          setIconsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [open, selectedPrefix]);

  const filteredIcons = React.useMemo(() => {
    const query = iconQuery.trim().toLowerCase();
    if (query.length === 0) {
      return iconNames;
    }

    return iconNames.filter((iconName) =>
      iconName.toLowerCase().includes(query),
    );
  }, [iconNames, iconQuery]);

  React.useEffect(() => {
    setIconScrollTop(0);
  }, [iconQuery, selectedPrefix]);

  const iconVirtualWindow = React.useMemo(() => {
    return getVirtualWindow({
      scrollTop: iconScrollTop,
      viewportHeight: ICON_VIEWPORT_HEIGHT,
      rowHeight: ICON_ROW_HEIGHT,
      itemCount: filteredIcons.length,
      overscan: OVERSCAN_ROWS,
    });
  }, [filteredIcons.length, iconScrollTop]);

  const selectedIconifyName =
    parsedSelected.prefix && parsedSelected.name
      ? `${parsedSelected.prefix}:${parsedSelected.name}`
      : undefined;
  const selectedCollection = React.useMemo(() => {
    if (!selectedPrefix) {
      return undefined;
    }

    return filteredCollections.find((collection) => {
      return collection.prefix === selectedPrefix;
    });
  }, [filteredCollections, selectedPrefix]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className={cn(
          buttonVariants({ variant: 'outline' }),
          'h-8 border-dashed text-xs',
          triggerClassName,
        )}
        aria-label={triggerAriaLabel}
      >
        {triggerContent ?? triggerLabel ?? 'Pick icon'}
      </PopoverTrigger>
      <PopoverContent className="w-96 max-w-[calc(100vw-2rem)] p-3">
        <div className="space-y-2">
          {collectionsLoading ? (
            <div className="text-muted-foreground flex items-center gap-2 px-1 text-xs">
              <Loader2Icon className="size-3.5 animate-spin" />
              Loading libraries...
            </div>
          ) : null}

          {!collectionsLoading && collectionsError ? (
            <div className="text-destructive/90 rounded-md px-1 text-xs">
              {collectionsError}
            </div>
          ) : null}

          {!collectionsLoading &&
          !collectionsError &&
          filteredCollections.length === 0 ? (
            <p className="text-muted-foreground px-1 text-xs">
              No icon libraries found.
            </p>
          ) : null}

          {!collectionsLoading &&
          !collectionsError &&
          filteredCollections.length > 0 ? (
            <div className="overflow-x-auto pb-1">
              <div className="flex w-max min-w-full gap-1">
                {filteredCollections.map((collection) => {
                  const isSelected = collection.prefix === selectedPrefix;
                  return (
                    <button
                      key={collection.prefix}
                      type="button"
                      className={cn(
                        'rounded-md px-2 py-1 text-xs whitespace-nowrap transition-colors',
                        isSelected
                          ? 'bg-foreground text-background'
                          : 'bg-muted/55 text-muted-foreground hover:bg-muted/75 hover:text-foreground',
                      )}
                      onClick={() => {
                        setSelectedPrefix(collection.prefix);
                      }}
                    >
                      {collection.prefix}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          <div className="text-muted-foreground px-1 text-[11px]">
            {selectedCollection
              ? `${selectedCollection.name} (${selectedCollection.prefix}) · ${selectedCollection.total} icons`
              : 'Select a library to browse icons.'}
          </div>

          <div className="space-y-2">
            <div className="relative">
              <SearchIcon className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
              <Input
                value={iconQuery}
                onChange={(event) => {
                  setIconQuery(event.target.value);
                }}
                className="bg-muted/50 focus-visible:ring-ring/35 h-8 border-transparent pl-8 text-xs shadow-none focus-visible:border-transparent focus-visible:ring-2"
                placeholder="Search icons..."
                aria-label="Search icons"
                disabled={!selectedPrefix}
              />
            </div>

            <div className="border-border/50 rounded-md border">
              {!selectedPrefix ? (
                <div
                  className="text-muted-foreground flex items-center justify-center px-2 text-xs"
                  style={{ height: ICON_VIEWPORT_HEIGHT }}
                >
                  Select a library to browse icons.
                </div>
              ) : null}

              {selectedPrefix && iconsLoading ? (
                <div
                  className="text-muted-foreground flex items-center justify-center gap-2 text-xs"
                  style={{ height: ICON_VIEWPORT_HEIGHT }}
                >
                  <Loader2Icon className="size-3.5 animate-spin" />
                  Loading icons...
                </div>
              ) : null}

              {selectedPrefix && !iconsLoading && iconsError ? (
                <div
                  className="text-destructive/90 px-2 py-2 text-xs"
                  style={{ height: ICON_VIEWPORT_HEIGHT }}
                >
                  {iconsError}
                </div>
              ) : null}

              {selectedPrefix &&
              !iconsLoading &&
              !iconsError &&
              filteredIcons.length === 0 ? (
                <div
                  className="text-muted-foreground flex items-center justify-center px-2 text-xs"
                  style={{ height: ICON_VIEWPORT_HEIGHT }}
                >
                  No icons found.
                </div>
              ) : null}

              {selectedPrefix &&
              !iconsLoading &&
              !iconsError &&
              filteredIcons.length > 0 ? (
                <div
                  className="overflow-auto"
                  style={{ height: ICON_VIEWPORT_HEIGHT }}
                  onScroll={(event) => {
                    setIconScrollTop(event.currentTarget.scrollTop);
                  }}
                >
                  <div style={{ height: iconVirtualWindow.totalHeight }}>
                    <div
                      style={{
                        transform: `translateY(${iconVirtualWindow.offsetY}px)`,
                      }}
                    >
                      {filteredIcons
                        .slice(
                          iconVirtualWindow.startIndex,
                          iconVirtualWindow.endIndex,
                        )
                        .map((iconName) => {
                          const iconifyName = `${selectedPrefix}:${iconName}`;
                          const isSelected =
                            iconifyName === selectedIconifyName;
                          return (
                            <button
                              key={iconName}
                              type="button"
                              className={cn(
                                'hover:bg-muted/65 flex h-9 w-full items-center gap-2 px-2 text-left text-xs transition-colors',
                                isSelected ? 'bg-muted/70' : '',
                              )}
                              onClick={() => {
                                onSelectIcon(iconifyName);
                                setOpen(false);
                              }}
                            >
                              <span
                                aria-hidden="true"
                                className="text-foreground size-4 shrink-0 bg-current"
                                style={getIconMaskStyle(
                                  buildIconSvgUrl(selectedPrefix, iconName),
                                )}
                              />
                              <span className="text-foreground/90 flex-1 truncate">
                                {iconName}
                              </span>
                              {isSelected ? (
                                <CheckIcon className="size-3.5 shrink-0" />
                              ) : null}
                            </button>
                          );
                        })}
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
