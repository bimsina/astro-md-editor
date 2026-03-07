import type { getCollectionsData } from '#/lib/collections.server';

export type EditorSearch = {
  collection?: string;
  file?: string;
};

export type CollectionData = ReturnType<typeof getCollectionsData>[number];
export type CollectionFileData = CollectionData['files'][number];

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

export function getSortedCollectionFiles(
  collection: CollectionData | undefined,
): CollectionFileData[] {
  if (!collection) {
    return [];
  }

  return [...collection.files].sort((a, b) => {
    const labelCompare = getFileDisplayLabel(a).localeCompare(
      getFileDisplayLabel(b),
      undefined,
      { sensitivity: 'base' },
    );

    if (labelCompare !== 0) {
      return labelCompare;
    }

    return a.id.localeCompare(b.id, undefined, { sensitivity: 'base' });
  });
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
