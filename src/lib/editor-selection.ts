import type { getCollectionsData } from '#/lib/collections.server';
import type { ResolvedField } from '#/lib/schema-form';

export type EditorSearch = {
  collection?: string;
  file?: string;
};

export type CollectionData = ReturnType<typeof getCollectionsData>[number];
export type CollectionFileData = CollectionData['files'][number];

export type SortOption =
  | { kind: 'newest' }
  | { kind: 'oldest' }
  | { kind: 'titleAsc' }
  | { kind: 'titleDesc' }
  | { kind: 'frontmatter'; fieldKey: string; direction: 'asc' | 'desc' };

export const DEFAULT_SORT: SortOption = { kind: 'newest' };

export const PRESET_SORT_OPTIONS: { label: string; option: SortOption }[] = [
  { label: 'Newest first', option: { kind: 'newest' } },
  { label: 'Oldest first', option: { kind: 'oldest' } },
  { label: 'Title A-Z', option: { kind: 'titleAsc' } },
  { label: 'Title Z-A', option: { kind: 'titleDesc' } },
];

function getFileName(pathLike: string): string {
  const normalized = pathLike.replaceAll('\\', '/');
  const parts = normalized.split('/');
  return parts[parts.length - 1] ?? pathLike;
}

function stripExtension(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '');
}

export function getFileDisplayLabel(file: CollectionFileData): string {
  const title = file.data.title;
  if (typeof title === 'string' && title.trim().length > 0) {
    return title.trim();
  }

  const fileName = getFileName(file.filePath || file.id);
  return stripExtension(fileName);
}

function compareDates(a: string | undefined, b: string | undefined): number {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return new Date(a).getTime() - new Date(b).getTime();
}

function compareLabels(a: CollectionFileData, b: CollectionFileData): number {
  const labelCompare = getFileDisplayLabel(a).localeCompare(
    getFileDisplayLabel(b),
    undefined,
    { sensitivity: 'base' },
  );

  if (labelCompare !== 0) {
    return labelCompare;
  }

  return a.id.localeCompare(b.id, undefined, { sensitivity: 'base' });
}

function compareFrontmatterField(
  a: CollectionFileData,
  b: CollectionFileData,
  fieldKey: string,
  direction: 'asc' | 'desc',
): number {
  const aVal = a.data[fieldKey];
  const bVal = b.data[fieldKey];

  if (aVal == null && bVal == null) return 0;
  if (aVal == null) return 1;
  if (bVal == null) return -1;

  let result = 0;

  if (typeof aVal === 'string' && typeof bVal === 'string') {
    const aDate = Date.parse(aVal);
    const bDate = Date.parse(bVal);
    if (!Number.isNaN(aDate) && !Number.isNaN(bDate)) {
      result = aDate - bDate;
    } else {
      result = aVal.localeCompare(bVal, undefined, { sensitivity: 'base' });
    }
  } else if (typeof aVal === 'number' && typeof bVal === 'number') {
    result = aVal - bVal;
  } else {
    result = String(aVal).localeCompare(String(bVal), undefined, {
      sensitivity: 'base',
    });
  }

  return direction === 'desc' ? -result : result;
}

export function getSortedCollectionFiles(
  collection: CollectionData | undefined,
  sort: SortOption = DEFAULT_SORT,
): CollectionFileData[] {
  if (!collection) {
    return [];
  }

  return [...collection.files].sort((a, b) => {
    switch (sort.kind) {
      case 'newest':
        return compareDates(b.createdAt, a.createdAt);
      case 'oldest':
        return compareDates(a.createdAt, b.createdAt);
      case 'titleAsc':
        return compareLabels(a, b);
      case 'titleDesc':
        return compareLabels(b, a);
      case 'frontmatter':
        return compareFrontmatterField(a, b, sort.fieldKey, sort.direction);
    }
  });
}

export function getSortableFields(
  resolvedFields: ResolvedField[],
): { key: string; label: string }[] {
  return resolvedFields
    .filter(
      (f) =>
        f.kind === 'string' ||
        f.kind === 'number' ||
        f.kind === 'dateAnyOf' ||
        f.kind === 'enum',
    )
    .map((f) => ({ key: f.key, label: f.key }));
}

export function sortOptionToValue(option: SortOption): string {
  switch (option.kind) {
    case 'newest':
    case 'oldest':
    case 'titleAsc':
    case 'titleDesc':
      return option.kind;
    case 'frontmatter':
      return `field:${option.fieldKey}:${option.direction}`;
  }
}

export function valueToSortOption(value: string): SortOption {
  switch (value) {
    case 'newest':
      return { kind: 'newest' };
    case 'oldest':
      return { kind: 'oldest' };
    case 'titleAsc':
      return { kind: 'titleAsc' };
    case 'titleDesc':
      return { kind: 'titleDesc' };
    default: {
      const match = value.match(/^field:(.+):(asc|desc)$/);
      if (match) {
        return {
          kind: 'frontmatter',
          fieldKey: match[1],
          direction: match[2] as 'asc' | 'desc',
        };
      }
      return DEFAULT_SORT;
    }
  }
}

export function areEditorSearchEqual(
  a: EditorSearch,
  b: EditorSearch,
): boolean {
  return a.collection === b.collection && a.file === b.file;
}

export function resolveEditorSelection(
  collections: CollectionData[],
  search: EditorSearch,
): {
  selectedCollection: CollectionData | undefined;
  selectedFile: CollectionFileData | undefined;
  normalizedSearch: EditorSearch;
} {
  if (collections.length === 0) {
    return {
      selectedCollection: undefined,
      selectedFile: undefined,
      normalizedSearch: {},
    };
  }

  const bySearchCollection = collections.find(
    (collection) => collection.name === search.collection,
  );
  const selectedCollection = bySearchCollection ?? collections[0];
  const files = getSortedCollectionFiles(selectedCollection);
  const bySearchFile = files.find((file) => file.id === search.file);
  const firstFile = files.at(0);
  const selectedFile = bySearchFile ?? firstFile;

  return {
    selectedCollection,
    selectedFile,
    normalizedSearch: {
      collection: selectedCollection.name,
      file: selectedFile ? selectedFile.id : undefined,
    },
  };
}
