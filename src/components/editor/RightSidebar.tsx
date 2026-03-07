import * as React from 'react';
import { CalendarDaysIcon, Clock3Icon, Loader2Icon, XIcon } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '#/components/ui/badge';
import { Button, buttonVariants } from '#/components/ui/button';
import { Calendar } from '#/components/ui/calendar';
import { Input } from '#/components/ui/input';
import { Label } from '#/components/ui/label';
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
import { Switch } from '#/components/ui/switch';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '#/components/ui/tabs';
import { ImageAssetPickerPopover } from '#/components/editor/ImageAssetBrowser';
import { fromDateTimeLocalToIso, toDateTimeLocalValue } from '#/lib/datetime';
import type {
  CollectionData,
  CollectionFileData,
} from '#/lib/editor-selection';
import {
  listFileHistoryServerFn,
  readFileRevisionServerFn,
} from '#/lib/file-history.api';
import type { FileRevisionPayload, HistoryCommit } from '#/lib/file-history.server';
import { getLocalImagePreviewServerFn } from '#/lib/image-preview.api';
import { applyRevisionFrontmatter } from '#/lib/frontmatter-history-merge';
import {
  ROOT_VALIDATION_KEY,
  validateFrontmatterDraft,
} from '#/lib/frontmatter-validation';
import {
  resolveAstroObjectSchema,
  resolveSchemaFields,
  type ImageFieldSourceMode,
  type ResolvedField,
} from '#/lib/schema-form';
import { cn } from '#/lib/utils';
import { useFrontmatterEditorStore } from '#/stores/frontmatterEditorStore';

type RightSidebarProps = {
  selectedCollection: CollectionData | undefined;
  selectedFile: CollectionFileData | undefined;
};

const SUBTLE_FIELD_CLASS =
  'border-transparent bg-muted/50 shadow-none focus-visible:border-transparent focus-visible:ring-2 focus-visible:ring-ring/35';
const HEX_COLOR_REGEX = /^#[0-9a-fA-F]{6}$/;
const HISTORY_PAGE_SIZE = 50;

function toNormalCaseLabel(fieldName: string): string {
  const normalized = fieldName
    .replace(/[_-]+/g, ' ')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();

  if (normalized.length === 0) {
    return fieldName;
  }

  return normalized
    .split(' ')
    .map((word) => {
      if (word === word.toUpperCase() && word.length > 1) {
        return word;
      }

      return word[0]
        ? word[0].toUpperCase() + word.slice(1).toLowerCase()
        : word;
    })
    .join(' ');
}

function getStringArrayValue(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === 'string');
}

function getDateTimeParts(value: unknown): {
  date: string;
  time: string;
} {
  const localValue = toDateTimeLocalValue(value);
  if (!localValue) {
    return {
      date: '',
      time: '00:00',
    };
  }

  const [date = '', time = '00:00'] = localValue.split('T');
  return {
    date,
    time,
  };
}

function padTwo(value: number): string {
  return value.toString().padStart(2, '0');
}

function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = padTwo(date.getMonth() + 1);
  const day = padTwo(date.getDate());

  return `${year}-${month}-${day}`;
}

function getIsoFromDateAndTime(
  dateValue: string,
  timeValue: string,
): string | undefined {
  if (!dateValue) {
    return undefined;
  }

  return fromDateTimeLocalToIso(`${dateValue}T${timeValue || '00:00'}`);
}

function normalizeHexColor(value: string): string {
  return value.trim().toUpperCase();
}

function isHexColor(value: string): boolean {
  return HEX_COLOR_REGEX.test(value);
}

const HOUR_OPTIONS = Array.from({ length: 24 }, (_, index) => padTwo(index));
const MINUTE_OPTIONS = Array.from({ length: 60 }, (_, index) => padTwo(index));

type FrontmatterImagePreviewItem = {
  sourcePath: string;
  previewUrl?: string;
  loading: boolean;
  error?: string;
};

function isDirectImagePreviewSourcePath(sourcePath: string): boolean {
  const normalized = sourcePath.trim().toLowerCase();
  return (
    normalized.startsWith('http://') ||
    normalized.startsWith('https://') ||
    normalized.startsWith('data:') ||
    normalized.startsWith('blob:')
  );
}

function useFrontmatterImagePreviews(params: {
  currentFilePath: string;
  sourcePaths: string[];
}): FrontmatterImagePreviewItem[] {
  const normalizedSources = React.useMemo(() => {
    return params.sourcePaths
      .map((sourcePath) => sourcePath.trim())
      .filter((sourcePath) => sourcePath.length > 0);
  }, [params.sourcePaths]);

  const [items, setItems] = React.useState<FrontmatterImagePreviewItem[]>([]);

  React.useEffect(() => {
    if (normalizedSources.length === 0) {
      setItems([]);
      return;
    }

    let cancelled = false;
    const createdObjectUrls: string[] = [];
    setItems(
      normalizedSources.map((sourcePath) => ({
        sourcePath,
        loading: true,
      })),
    );

    void Promise.all(
      normalizedSources.map(
        async (sourcePath): Promise<FrontmatterImagePreviewItem> => {
          if (isDirectImagePreviewSourcePath(sourcePath)) {
            return {
              sourcePath,
              previewUrl: sourcePath,
              loading: false,
            };
          }

          try {
            const response = await getLocalImagePreviewServerFn({
              data: {
                currentFilePath: params.currentFilePath,
                sourcePath,
              },
            });
            if (!response.ok) {
              throw new Error(`Preview request failed (${response.status})`);
            }

            const blob = await response.blob();
            const previewUrl = URL.createObjectURL(blob);
            createdObjectUrls.push(previewUrl);
            return {
              sourcePath,
              previewUrl,
              loading: false,
            };
          } catch (error) {
            const message =
              error instanceof Error ? error.message : 'Preview unavailable';
            return {
              sourcePath,
              loading: false,
              error: message,
            };
          }
        },
      ),
    )
      .then((nextItems) => {
        if (cancelled) {
          return;
        }
        setItems(nextItems);
      })
      .catch(() => {
        if (!cancelled) {
          setItems([]);
        }
      });

    return () => {
      cancelled = true;
      for (const objectUrl of createdObjectUrls) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [normalizedSources, params.currentFilePath]);

  return items;
}

function FrontmatterImagePreviewGrid({
  currentFilePath,
  sourcePaths,
  columns,
  onRemoveAt,
}: {
  currentFilePath: string;
  sourcePaths: string[];
  columns: 1 | 2;
  onRemoveAt?: (index: number) => void;
}) {
  const items = useFrontmatterImagePreviews({
    currentFilePath,
    sourcePaths,
  });
  if (items.length === 0) {
    return null;
  }

  return (
    <div
      className={cn('grid gap-2', columns === 1 ? 'grid-cols-1' : 'grid-cols-2')}
    >
      {items.map((item, index) => (
        <div
          key={`${item.sourcePath}-${index}`}
          className="bg-muted/50 group relative overflow-hidden rounded-md"
        >
          {item.previewUrl ? (
            <img
              src={item.previewUrl}
              alt={item.sourcePath}
              className={cn('w-full object-cover', columns === 1 ? 'h-44' : 'h-28')}
            />
          ) : item.loading ? (
            <div
              className={cn(
                'text-muted-foreground flex items-center justify-center text-[11px]',
                columns === 1 ? 'h-44' : 'h-28',
              )}
            >
              <Loader2Icon className="size-3.5 animate-spin" />
            </div>
          ) : (
            <div
              className={cn(
                'text-muted-foreground flex items-center justify-center px-2 text-center text-[11px]',
                columns === 1 ? 'h-44' : 'h-28',
              )}
            >
              Preview unavailable
            </div>
          )}

          {onRemoveAt ? (
            <button
              type="button"
              className="bg-background/85 text-foreground absolute top-2 right-2 inline-flex size-6 items-center justify-center rounded-full opacity-0 shadow-sm transition-opacity hover:opacity-100 group-hover:opacity-100"
              onClick={() => onRemoveAt(index)}
              aria-label={`Remove image ${item.sourcePath}`}
            >
              <XIcon className="size-3.5" />
            </button>
          ) : null}

        </div>
      ))}
    </div>
  );
}

function NumberField({
  fieldKey,
  value,
  onChange,
  onBlur,
}: {
  fieldKey: string;
  value: unknown;
  onChange: (value: unknown) => void;
  onBlur: () => void;
}) {
  return (
    <Input
      id={fieldKey}
      type="number"
      className={SUBTLE_FIELD_CLASS}
      value={
        typeof value === 'number' || typeof value === 'string'
          ? String(value)
          : ''
      }
      onChange={(event) => {
        const nextRaw = event.target.value;
        if (nextRaw.trim() === '') {
          onChange(undefined);
          return;
        }

        const parsed = Number(nextRaw);
        onChange(Number.isFinite(parsed) ? parsed : nextRaw);
      }}
      onBlur={onBlur}
    />
  );
}

function BooleanField({
  fieldKey,
  value,
  onChange,
  onBlur,
}: {
  fieldKey: string;
  value: unknown;
  onChange: (value: boolean) => void;
  onBlur: () => void;
}) {
  const isChecked = value === true;

  return (
    <div className="bg-muted/50 flex h-9 items-center justify-between rounded-md px-3">
      <span className="text-muted-foreground text-sm">
        {isChecked ? 'Enabled' : 'Disabled'}
      </span>
      <Switch
        id={fieldKey}
        checked={isChecked}
        onCheckedChange={(checked) => onChange(checked)}
        onBlur={onBlur}
        aria-label={fieldKey}
      />
    </div>
  );
}

function DateAnyOfField({
  fieldKey,
  value,
  onChange,
  onBlur,
}: {
  fieldKey: string;
  value: unknown;
  onChange: (value: string | undefined) => void;
  onBlur: () => void;
}) {
  const { date, time } = getDateTimeParts(value);
  const [hour = '00', minute = '00'] = time.split(':');
  const selectedDate = date ? new Date(`${date}T00:00:00`) : undefined;

  const handleDateSelect = (nextDate: Date | undefined) => {
    if (!nextDate) {
      onChange(undefined);
      onBlur();
      return;
    }

    const nextDatePart = formatLocalDate(nextDate);
    onChange(getIsoFromDateAndTime(nextDatePart, `${hour}:${minute}`));
    onBlur();
  };

  const handleTimeSelect = (nextHour: string, nextMinute: string) => {
    onChange(getIsoFromDateAndTime(date, `${nextHour}:${nextMinute}`));
    onBlur();
  };

  return (
    <div className="space-y-2">
      <Popover>
        <PopoverTrigger
          className={cn(
            buttonVariants({ variant: 'ghost' }),
            'bg-muted/50 hover:bg-muted/65 h-9 w-full justify-start border-0 px-3 text-sm font-normal shadow-none',
          )}
          aria-label={`${fieldKey} date`}
        >
          <CalendarDaysIcon className="text-muted-foreground size-4" />
          {selectedDate
            ? selectedDate.toLocaleDateString(undefined, {
                month: 'short',
                day: '2-digit',
                year: 'numeric',
              })
            : 'Pick a date'}
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0">
          <Calendar
            mode="single"
            selected={selectedDate}
            onSelect={handleDateSelect}
          />
        </PopoverContent>
      </Popover>

      <div className="grid grid-cols-2 gap-2">
        <div className="relative">
          <Clock3Icon className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
          <Select
            value={hour}
            onValueChange={(nextHour) => {
              if (!nextHour) {
                return;
              }

              handleTimeSelect(nextHour, minute);
            }}
            disabled={!date}
          >
            <SelectTrigger className="bg-muted/50 focus-visible:ring-ring/35 w-full border-transparent pl-8 shadow-none focus-visible:border-transparent focus-visible:ring-2">
              <SelectValue placeholder="HH" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {HOUR_OPTIONS.map((hourOption) => (
                  <SelectItem key={`hour-${hourOption}`} value={hourOption}>
                    {hourOption}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>

        <Select
          value={minute}
          onValueChange={(nextMinute) => {
            if (!nextMinute) {
              return;
            }

            handleTimeSelect(hour, nextMinute);
          }}
          disabled={!date}
        >
          <SelectTrigger className="bg-muted/50 focus-visible:ring-ring/35 w-full border-transparent shadow-none focus-visible:border-transparent focus-visible:ring-2">
            <SelectValue placeholder="MM" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {MINUTE_OPTIONS.map((minuteOption) => (
                <SelectItem key={`minute-${minuteOption}`} value={minuteOption}>
                  {minuteOption}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

function EnumField({
  fieldKey,
  value,
  options,
  onChange,
}: {
  fieldKey: string;
  value: unknown;
  options: string[];
  onChange: (value: string) => void;
}) {
  return (
    <Select
      value={typeof value === 'string' ? value : undefined}
      onValueChange={(nextValue) => {
        if (!nextValue) {
          return;
        }

        onChange(nextValue);
      }}
    >
      <SelectTrigger className="bg-muted/50 focus-visible:ring-ring/35 w-full border-transparent shadow-none focus-visible:border-transparent focus-visible:ring-2">
        <SelectValue placeholder="Select a value" />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {options.map((option) => {
            return (
              <SelectItem key={`${fieldKey}-${option}`} value={option}>
                {option}
              </SelectItem>
            );
          })}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}

function StringArrayField({
  fieldKey,
  values,
  chipInput,
  onChipInputChange,
  onAddChip,
  onRemoveChip,
  onBackspaceEmpty,
  onBlur,
  placeholder,
}: {
  fieldKey: string;
  values: string[];
  chipInput: string;
  onChipInputChange: (value: string) => void;
  onAddChip: () => void;
  onRemoveChip: (index: number) => void;
  onBackspaceEmpty: () => void;
  onBlur: () => void;
  placeholder?: string;
}) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {values.map((chip, index) => (
          <Badge
            key={`${fieldKey}-${chip}-${index}`}
            variant="secondary"
            className="bg-muted gap-1 border-transparent tracking-normal normal-case"
          >
            {chip}
            <button
              type="button"
              className="text-muted-foreground hover:bg-accent hover:text-foreground inline-flex size-4 items-center justify-center rounded-full"
              onClick={() => onRemoveChip(index)}
              aria-label={`Remove ${chip}`}
            >
              <XIcon className="size-3" />
            </button>
          </Badge>
        ))}
      </div>

      <Input
        id={fieldKey}
        className={SUBTLE_FIELD_CLASS}
        value={chipInput}
        onChange={(event) => onChipInputChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ',') {
            event.preventDefault();
            onAddChip();
            return;
          }

          if (event.key === 'Backspace' && chipInput.trim().length === 0) {
            event.preventDefault();
            onBackspaceEmpty();
          }
        }}
        onBlur={onBlur}
        placeholder={placeholder ?? 'Type and press Enter'}
      />
    </div>
  );
}

function ImageField({
  fieldKey,
  currentFilePath,
  sourceMode,
  value,
  onChange,
  onBlur,
}: {
  fieldKey: string;
  currentFilePath: string;
  sourceMode: ImageFieldSourceMode;
  value: unknown;
  onChange: (value: string | undefined) => void;
  onBlur: () => void;
}) {
  const sourcePath = typeof value === 'string' ? value.trim() : '';

  return (
    <div className="space-y-2">
      <Input
        id={fieldKey}
        className={SUBTLE_FIELD_CLASS}
        value={typeof value === 'string' ? value : ''}
        onChange={(event) => {
          onChange(event.target.value || undefined);
        }}
        onBlur={onBlur}
      />
      {sourcePath ? (
        <FrontmatterImagePreviewGrid
          currentFilePath={currentFilePath}
          sourcePaths={[sourcePath]}
          columns={1}
          onRemoveAt={() => {
            onChange(undefined);
            onBlur();
          }}
        />
      ) : null}
      <ImageAssetPickerPopover
        currentFilePath={currentFilePath}
        sourceMode={sourceMode}
        triggerLabel="Browse assets"
        onSelectPath={(selectedPath) => {
          onChange(selectedPath);
          onBlur();
        }}
      />
    </div>
  );
}

function ImageArrayField({
  fieldKey,
  currentFilePath,
  sourceMode,
  values,
  chipInput,
  onChipInputChange,
  onAddChip,
  onRemoveChip,
  onBlur,
  onSelectAsset,
}: {
  fieldKey: string;
  currentFilePath: string;
  sourceMode: ImageFieldSourceMode;
  values: string[];
  chipInput: string;
  onChipInputChange: (value: string) => void;
  onAddChip: () => void;
  onRemoveChip: (index: number) => void;
  onBlur: () => void;
  onSelectAsset: (value: string) => void;
}) {
  const normalizedValues = values
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Input
          id={fieldKey}
          className={SUBTLE_FIELD_CLASS}
          value={chipInput}
          onChange={(event) => onChipInputChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ',') {
              event.preventDefault();
              onAddChip();
              onBlur();
            }
          }}
          onBlur={onBlur}
          placeholder="Type image path and press Enter"
        />
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="h-9"
          onClick={() => {
            onAddChip();
            onBlur();
          }}
        >
          Add
        </Button>
      </div>
      {normalizedValues.length > 0 ? (
        <FrontmatterImagePreviewGrid
          currentFilePath={currentFilePath}
          sourcePaths={normalizedValues}
          columns={2}
          onRemoveAt={(index) => {
            onRemoveChip(index);
            onBlur();
          }}
        />
      ) : null}
      <ImageAssetPickerPopover
        currentFilePath={currentFilePath}
        sourceMode={sourceMode}
        triggerLabel="Add from assets"
        onSelectPath={onSelectAsset}
      />
    </div>
  );
}

function ColorField({
  fieldKey,
  value,
  onChange,
  onBlur,
}: {
  fieldKey: string;
  value: unknown;
  onChange: (value: string | undefined) => void;
  onBlur: () => void;
}) {
  const stringValue = typeof value === 'string' ? value : '';
  const normalizedValue = normalizeHexColor(stringValue);
  const hasValue = normalizedValue.length > 0;
  const hasValidValue = hasValue && isHexColor(normalizedValue);
  const pickerValue = hasValidValue ? normalizedValue : '#000000';

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Input
          id={fieldKey}
          className={SUBTLE_FIELD_CLASS}
          value={stringValue}
          onChange={(event) => {
            const nextRaw = event.target.value;
            onChange(nextRaw.length > 0 ? nextRaw : undefined);
          }}
          onBlur={onBlur}
          placeholder="#RRGGBB"
        />
        <input
          id={`${fieldKey}-picker`}
          type="color"
          className="border-border/50 h-9 w-12 cursor-pointer rounded-md border bg-transparent p-1"
          value={pickerValue}
          onChange={(event) => {
            onChange(normalizeHexColor(event.target.value));
            onBlur();
          }}
          aria-label={`${fieldKey} color picker`}
        />
      </div>

      {hasValue && !hasValidValue ? (
        <p className="text-destructive/85 text-xs">
          Use a hex color in #RRGGBB format.
        </p>
      ) : null}
    </div>
  );
}

function FieldErrorList({
  fieldKey,
  errors,
}: {
  fieldKey: string;
  errors: string[] | undefined;
}) {
  if (!errors || errors.length === 0) {
    return null;
  }

  return (
    <div className="space-y-1">
      {errors.map((error, index) => (
        <p
          key={`${fieldKey}-error-${index}`}
          className="text-destructive/85 text-xs"
        >
          {error}
        </p>
      ))}
    </div>
  );
}

function formatHistoryDateTime(dateIso: string): string {
  const parsedDate = new Date(dateIso);
  if (Number.isNaN(parsedDate.getTime())) {
    return dateIso;
  }

  return parsedDate.toLocaleString(undefined, {
    month: 'short',
    day: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function RightSidebar({
  selectedCollection,
  selectedFile,
}: RightSidebarProps) {
  const draft = useFrontmatterEditorStore((state) => state.draft);
  const dirty = useFrontmatterEditorStore((state) => state.dirty);
  const errors = useFrontmatterEditorStore((state) => state.errors);
  const chipInputs = useFrontmatterEditorStore((state) => state.chipInputs);
  const setFieldValue = useFrontmatterEditorStore(
    (state) => state.setFieldValue,
  );
  const setFieldTouched = useFrontmatterEditorStore(
    (state) => state.setFieldTouched,
  );
  const setValidationErrors = useFrontmatterEditorStore(
    (state) => state.setValidationErrors,
  );
  const setChipInput = useFrontmatterEditorStore((state) => state.setChipInput);
  const addChipValue = useFrontmatterEditorStore((state) => state.addChipValue);
  const removeChipValue = useFrontmatterEditorStore(
    (state) => state.removeChipValue,
  );
  const removeLastChipValue = useFrontmatterEditorStore(
    (state) => state.removeLastChipValue,
  );
  const applyRevisionSnapshot = useFrontmatterEditorStore(
    (state) => state.applyRevisionSnapshot,
  );
  const [historyCommits, setHistoryCommits] = React.useState<HistoryCommit[]>(
    [],
  );
  const [historyNextCursor, setHistoryNextCursor] = React.useState<
    string | undefined
  >();
  const [historyUnavailableReason, setHistoryUnavailableReason] = React.useState<
    string | undefined
  >();
  const [historyError, setHistoryError] = React.useState<string | undefined>();
  const [historyLoading, setHistoryLoading] = React.useState(false);
  const [historyLoadingMore, setHistoryLoadingMore] = React.useState(false);
  const [selectedCommitSha, setSelectedCommitSha] = React.useState<
    string | undefined
  >();
  const [selectedRevision, setSelectedRevision] = React.useState<
    FileRevisionPayload | undefined
  >();
  const [revisionLoading, setRevisionLoading] = React.useState(false);
  const [revisionError, setRevisionError] = React.useState<string | undefined>();
  const [applySummary, setApplySummary] = React.useState<string | undefined>();
  const [activeTab, setActiveTab] = React.useState<'frontmatter' | 'history'>(
    'frontmatter',
  );
  const historyRequestIdRef = React.useRef(0);
  const revisionRequestIdRef = React.useRef(0);
  const selectedFilePath = selectedFile?.filePath;

  const objectSchema = React.useMemo(() => {
    return resolveAstroObjectSchema(selectedCollection?.schema);
  }, [selectedCollection?.schema]);

  const resolvedFields = React.useMemo(() => {
    if (!objectSchema) {
      return [];
    }

    return resolveSchemaFields(objectSchema, selectedCollection?.fieldUi);
  }, [objectSchema, selectedCollection?.fieldUi]);

  const runValidation = React.useCallback(() => {
    if (!selectedCollection?.schema) {
      setValidationErrors({});
      return;
    }

    const result = validateFrontmatterDraft(selectedCollection.schema, draft);
    setValidationErrors(result.errors);
  }, [selectedCollection?.schema, draft, setValidationErrors]);

  const handleFieldBlur = React.useCallback(
    (fieldKey: string) => {
      setFieldTouched(fieldKey);
      runValidation();
    },
    [runValidation, setFieldTouched],
  );

  React.useEffect(() => {
    runValidation();
  }, [runValidation]);

  const loadHistory = React.useCallback(
    async (cursor: string | undefined, append: boolean) => {
      if (!selectedFilePath) {
        return;
      }

      historyRequestIdRef.current += 1;
      const requestId = historyRequestIdRef.current;
      if (append) {
        setHistoryLoadingMore(true);
      } else {
        setHistoryLoading(true);
      }
      setHistoryError(undefined);
      setApplySummary(undefined);

      try {
        const result = await listFileHistoryServerFn({
          data: {
            filePath: selectedFilePath,
            limit: HISTORY_PAGE_SIZE,
            cursor,
          },
        });
        if (historyRequestIdRef.current !== requestId) {
          return;
        }

        setHistoryUnavailableReason(result.unavailableReason);
        setHistoryNextCursor(result.nextCursor);
        setHistoryCommits((current) => {
          if (!append) {
            return result.commits;
          }

          const existing = new Set(current.map((commit) => commit.sha));
          const nextCommits = result.commits.filter((commit) => {
            return !existing.has(commit.sha);
          });

          return [...current, ...nextCommits];
        });

        if (!append) {
          setSelectedCommitSha((current) => {
            if (!current) {
              return undefined;
            }

            const includesCurrent = result.commits.some((commit) => {
              return commit.sha === current;
            });

            return includesCurrent ? current : undefined;
          });
        }
      } catch (error) {
        if (historyRequestIdRef.current !== requestId) {
          return;
        }

        const message = error instanceof Error ? error.message : String(error);
        setHistoryError(message);
      } finally {
        if (historyRequestIdRef.current === requestId) {
          setHistoryLoading(false);
          setHistoryLoadingMore(false);
        }
      }
    },
    [selectedFilePath],
  );

  React.useEffect(() => {
    setHistoryCommits([]);
    setHistoryNextCursor(undefined);
    setHistoryUnavailableReason(undefined);
    setHistoryError(undefined);
    setHistoryLoading(false);
    setHistoryLoadingMore(false);
    setSelectedCommitSha(undefined);
    setSelectedRevision(undefined);
    setRevisionError(undefined);
    setRevisionLoading(false);
    setApplySummary(undefined);

    if (!selectedFilePath) {
      return;
    }

    void loadHistory(undefined, false);
  }, [loadHistory, selectedFilePath]);

  React.useEffect(() => {
    if (!selectedFilePath || !selectedCommitSha) {
      setSelectedRevision(undefined);
      setRevisionError(undefined);
      setRevisionLoading(false);
      return;
    }

    revisionRequestIdRef.current += 1;
    const requestId = revisionRequestIdRef.current;
    setRevisionLoading(true);
    setRevisionError(undefined);
    setSelectedRevision(undefined);

    void readFileRevisionServerFn({
      data: {
        filePath: selectedFilePath,
        commitSha: selectedCommitSha,
      },
    })
      .then((payload) => {
        if (revisionRequestIdRef.current !== requestId) {
          return;
        }

        setSelectedRevision(payload);
      })
      .catch((error: unknown) => {
        if (revisionRequestIdRef.current !== requestId) {
          return;
        }

        const message = error instanceof Error ? error.message : String(error);
        setRevisionError(message);
      })
      .finally(() => {
        if (revisionRequestIdRef.current === requestId) {
          setRevisionLoading(false);
        }
      });
  }, [selectedCommitSha, selectedFilePath]);

  const handleApplyHistoryRevision = React.useCallback(() => {
    if (!selectedRevision || !selectedCollection) {
      return;
    }

    if (dirty) {
      const confirmed = window.confirm(
        'This file has unsaved changes. Discard changes and apply this revision?',
      );
      if (!confirmed) {
        return;
      }
    }

    const applyResult = applyRevisionFrontmatter({
      currentDraft: draft,
      revisionFrontmatter: selectedRevision.frontmatter,
      schema: selectedCollection.schema,
      fieldUi: selectedCollection.fieldUi,
    });

    applyRevisionSnapshot({
      draft: applyResult.nextDraft,
      content: selectedRevision.content,
    });

    const commitLabel = selectedCommitSha?.slice(0, 7) ?? '';
    setApplySummary(
      `Applied ${applyResult.appliedKeys.length} frontmatter field${applyResult.appliedKeys.length === 1 ? '' : 's'} and skipped ${applyResult.skippedKeys.length}.`,
    );
    toast.success(
      commitLabel
        ? `Applied revision ${commitLabel}.`
        : 'Applied selected revision.',
    );
  }, [
    applyRevisionSnapshot,
    dirty,
    draft,
    selectedCollection,
    selectedCommitSha,
    selectedRevision,
  ]);

  if (!selectedCollection || !selectedFile) {
    return (
      <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
        Select a file to edit frontmatter.
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Tabs
        value={activeTab}
        onValueChange={(value) => {
          if (value === 'frontmatter' || value === 'history') {
            setActiveTab(value);
          }
        }}
        className="h-full min-h-0 gap-3 w-full"
      >
        <TabsList className={"w-full"}>
          <TabsTrigger value="frontmatter" className={"text-xs"}>Frontmatter</TabsTrigger>
          <TabsTrigger value="history" className={"text-xs"}>History</TabsTrigger>
        </TabsList>

        <TabsContent value="frontmatter" className="min-h-0 overflow-auto pr-1">
          {!objectSchema ? (
            <div className="bg-muted/40 text-muted-foreground rounded-md px-3 py-2 text-sm">
              This collection has no object schema available.
            </div>
          ) : null}

          {resolvedFields.map((field: ResolvedField) => {
            const fieldErrors = errors[field.key];
            const label = toNormalCaseLabel(field.key);
            const value = draft[field.key];

            return (
              <div
                key={field.key}
                className="bg-background/45 space-y-2 rounded-lg px-2.5 py-2.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <Label
                    htmlFor={field.key}
                    className="text-muted-foreground text-xs font-medium tracking-wide"
                  >
                    {label}
                    {field.required ? ' *' : ''}
                  </Label>
                </div>

                {field.kind === 'string' && (
                  <Input
                    id={field.key}
                    className={SUBTLE_FIELD_CLASS}
                    value={typeof value === 'string' ? value : ''}
                    onChange={(event) => {
                      setFieldValue(field.key, event.target.value || undefined);
                    }}
                    onBlur={() => handleFieldBlur(field.key)}
                  />
                )}

                {field.kind === 'image' && (
                  <ImageField
                    fieldKey={field.key}
                    currentFilePath={selectedFile.filePath}
                    sourceMode={field.sourceMode}
                    value={value}
                    onChange={(nextValue) => {
                      setFieldValue(field.key, nextValue);
                    }}
                    onBlur={() => handleFieldBlur(field.key)}
                  />
                )}

                {field.kind === 'color' && (
                  <ColorField
                    fieldKey={field.key}
                    value={value}
                    onChange={(nextValue) => {
                      setFieldValue(field.key, nextValue);
                    }}
                    onBlur={() => handleFieldBlur(field.key)}
                  />
                )}

                {field.kind === 'number' && (
                  <NumberField
                    fieldKey={field.key}
                    value={value}
                    onChange={(nextValue) => {
                      setFieldValue(field.key, nextValue);
                    }}
                    onBlur={() => handleFieldBlur(field.key)}
                  />
                )}

                {field.kind === 'boolean' && (
                  <BooleanField
                    fieldKey={field.key}
                    value={value}
                    onChange={(nextValue) => {
                      setFieldValue(field.key, nextValue);
                    }}
                    onBlur={() => handleFieldBlur(field.key)}
                  />
                )}

                {field.kind === 'enum' && (
                  <EnumField
                    fieldKey={field.key}
                    value={value}
                    options={field.options}
                    onChange={(nextValue) => {
                      setFieldValue(field.key, nextValue);
                      handleFieldBlur(field.key);
                    }}
                  />
                )}

                {field.kind === 'stringArray' && (
                  <StringArrayField
                    fieldKey={field.key}
                    values={getStringArrayValue(value)}
                    chipInput={chipInputs[field.key] ?? ''}
                    onChipInputChange={(nextValue) => {
                      setChipInput(field.key, nextValue);
                    }}
                    onAddChip={() => {
                      addChipValue(field.key, chipInputs[field.key] ?? '');
                      handleFieldBlur(field.key);
                    }}
                    onRemoveChip={(index) => {
                      removeChipValue(field.key, index);
                      handleFieldBlur(field.key);
                    }}
                    onBackspaceEmpty={() => {
                      removeLastChipValue(field.key);
                      handleFieldBlur(field.key);
                    }}
                    onBlur={() => handleFieldBlur(field.key)}
                  />
                )}

                {field.kind === 'imageArray' && (
                  <ImageArrayField
                    fieldKey={field.key}
                    currentFilePath={selectedFile.filePath}
                    sourceMode={field.sourceMode}
                    values={getStringArrayValue(value)}
                    chipInput={chipInputs[field.key] ?? ''}
                    onChipInputChange={(nextValue) => {
                      setChipInput(field.key, nextValue);
                    }}
                    onAddChip={() => {
                      addChipValue(field.key, chipInputs[field.key] ?? '');
                      handleFieldBlur(field.key);
                    }}
                    onRemoveChip={(index) => {
                      removeChipValue(field.key, index);
                      handleFieldBlur(field.key);
                    }}
                    onBlur={() => handleFieldBlur(field.key)}
                    onSelectAsset={(nextValue) => {
                      addChipValue(field.key, nextValue);
                      handleFieldBlur(field.key);
                    }}
                  />
                )}

                {field.kind === 'dateAnyOf' && (
                  <DateAnyOfField
                    fieldKey={field.key}
                    value={value}
                    onChange={(nextValue) => {
                      setFieldValue(field.key, nextValue);
                    }}
                    onBlur={() => handleFieldBlur(field.key)}
                  />
                )}

                {field.kind === 'unsupported' && (
                  <div className="bg-muted/40 text-muted-foreground rounded-md px-3 py-2 text-sm">
                    Not yet supported: {field.reason}
                  </div>
                )}

                <FieldErrorList fieldKey={field.key} errors={fieldErrors} />
              </div>
            );
          })}

          {errors[ROOT_VALIDATION_KEY]?.length ? (
            <FieldErrorList
              fieldKey={ROOT_VALIDATION_KEY}
              errors={errors[ROOT_VALIDATION_KEY]}
            />
          ) : null}
        </TabsContent>

        <TabsContent value="history" className="min-h-0 space-y-2 overflow-auto pr-1">
          <div className="flex justify-end">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs"
              disabled={historyLoading || historyLoadingMore || !selectedFilePath}
              onClick={() => {
                void loadHistory(undefined, false);
              }}
            >
              Refresh
            </Button>
          </div>

          {historyUnavailableReason ? (
            <p className="bg-muted/40 text-muted-foreground rounded-md px-3 py-2 text-xs">
              {historyUnavailableReason}
            </p>
          ) : null}

          {!historyUnavailableReason && historyError ? (
            <p className="text-destructive/90 rounded-md px-1 py-1 text-xs">
              {historyError}
            </p>
          ) : null}

          {!historyUnavailableReason && !historyError && historyLoading && historyCommits.length === 0 ? (
            <p className="text-muted-foreground flex items-center gap-1.5 px-1 py-1 text-xs">
              <Loader2Icon className="size-3.5 animate-spin" />
              Loading history...
            </p>
          ) : null}

          {!historyUnavailableReason &&
          !historyError &&
          !historyLoading &&
          historyCommits.length === 0 ? (
            <p className="text-muted-foreground rounded-md px-1 py-1 text-xs">
              No Git history found for this file.
            </p>
          ) : null}

          {!historyUnavailableReason && historyCommits.length > 0 ? (
            <div className="divide-border/40 divide-y rounded-md border">
              {historyCommits.map((commit) => {
                const isExpanded = selectedCommitSha === commit.sha;
                const commitTitle =
                  commit.message.trim().length > 0
                    ? commit.message
                    : 'No commit message';

                return (
                  <div key={commit.sha} className="px-2.5 py-2">
                    <button
                      type="button"
                      className="w-full text-left"
                      onClick={() => {
                        setApplySummary(undefined);
                        setSelectedCommitSha((current) =>
                          current === commit.sha ? undefined : commit.sha,
                        );
                      }}
                    >
                      <p className="text-foreground/90 text-xs font-medium">
                        {commitTitle}
                      </p>
                      <p className="text-muted-foreground mt-0.5 text-[11px]">
                        {commit.author} · {formatHistoryDateTime(commit.dateIso)}
                      </p>
                    </button>

                    {isExpanded ? (
                      <div className="mt-2 space-y-2">
                        {revisionLoading ? (
                          <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
                            <Loader2Icon className="size-3.5 animate-spin" />
                            Loading frontmatter...
                          </p>
                        ) : null}

                        {revisionError ? (
                          <p className="text-destructive/90 text-xs">
                            {revisionError}
                          </p>
                        ) : null}

                        {!revisionLoading && !revisionError && selectedRevision ? (
                          <div className="space-y-2">
                            {selectedRevision.parseWarnings.length > 0 ? (
                              <div className="bg-amber-100/70 text-amber-900 dark:bg-amber-900/30 dark:text-amber-200 rounded-md px-2 py-1.5 text-[11px]">
                                {selectedRevision.parseWarnings[0]}
                              </div>
                            ) : null}
                            <pre className="bg-muted/55 max-h-40 overflow-auto rounded-md px-2 py-1.5 text-[11px] leading-relaxed whitespace-pre-wrap">
                              {Object.keys(selectedRevision.frontmatter).length > 0
                                ? JSON.stringify(selectedRevision.frontmatter, null, 2)
                                : '[No frontmatter]'}
                            </pre>
                            <Button
                              type="button"
                              size="sm"
                              variant={"outline"}
                              className="h-7 w-full text-xs"
                              onClick={handleApplyHistoryRevision}
                            >
                              Apply
                            </Button>
                            {applySummary ? (
                              <p className="text-muted-foreground text-[11px]">
                                {applySummary}
                              </p>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : null}

          {historyNextCursor ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 w-full text-xs"
              disabled={historyLoadingMore || historyLoading}
              onClick={() => {
                void loadHistory(historyNextCursor, true);
              }}
            >
              {historyLoadingMore ? (
                <>
                  <Loader2Icon className="size-3.5 animate-spin" />
                  Loading...
                </>
              ) : (
                'Load older revisions'
              )}
            </Button>
          ) : null}
        </TabsContent>
      </Tabs>
    </div>
  );
}
