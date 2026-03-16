import { access, mkdir, unlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import matter from 'gray-matter';
import {
  appendCollectionsFileCache,
  getCollectionsData,
  getCollectionsRootPath,
  removeCollectionsFileCache,
  updateCollectionsFileCache,
} from '#/lib/collections.server';

type SaveEditorSelectionInput = {
  collectionName: string;
  fileId: string;
  draft: Record<string, unknown>;
  content: string;
};

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

export async function saveEditorSelection(
  input: SaveEditorSelectionInput,
): Promise<{ filePath: string }> {
  const collection = getCollectionsData().find(
    (item) => item.name === input.collectionName,
  );
  if (!collection) {
    throw new Error(`Collection not found: ${input.collectionName}`);
  }

  const file = collection.files.find((item) => item.id === input.fileId);
  if (!file) {
    throw new Error(`File not found: ${input.fileId}`);
  }

  const nextFileBody = matter.stringify(input.content, input.draft);

  try {
    await writeFile(file.filePath, nextFileBody, 'utf8');
  } catch (error) {
    throw new Error(
      `Unable to write file "${file.filePath}": ${getErrorMessage(error)}`,
    );
  }

  updateCollectionsFileCache({
    collectionName: input.collectionName,
    fileId: input.fileId,
    data: input.draft as Record<string, {}>,
    content: input.content,
  });

  return {
    filePath: file.filePath,
  };
}

export async function deleteEditorSelection(input: {
  collectionName: string;
  fileId: string;
}): Promise<{ filePath: string }> {
  const collection = getCollectionsData().find(
    (item) => item.name === input.collectionName,
  );
  if (!collection) {
    throw new Error(`Collection not found: ${input.collectionName}`);
  }

  const file = collection.files.find((item) => item.id === input.fileId);
  if (!file) {
    throw new Error(`File not found: ${input.fileId}`);
  }

  try {
    await unlink(file.filePath);
  } catch (error) {
    throw new Error(
      `Unable to delete file "${file.filePath}": ${getErrorMessage(error)}`,
    );
  }

  removeCollectionsFileCache({
    collectionName: input.collectionName,
    fileId: input.fileId,
  });

  return {
    filePath: file.filePath,
  };
}

function toSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '')
    .replace(/-{2,}/g, '-');
}

function inferFileExtension(
  files: Array<{
    filePath: string;
  }>,
): '.md' | '.mdx' {
  const mdxCount = files.filter((file) =>
    file.filePath.toLowerCase().endsWith('.mdx'),
  ).length;
  return mdxCount > files.length / 2 ? '.mdx' : '.md';
}

export async function createEditorSelection(input: {
  collectionName: string;
  slug: string;
}): Promise<{ fileId: string; filePath: string }> {
  const collection = getCollectionsData().find(
    (item) => item.name === input.collectionName,
  );
  if (!collection) {
    throw new Error(`Collection not found: ${input.collectionName}`);
  }

  const normalizedSlug = toSlug(input.slug);
  if (!normalizedSlug) {
    throw new Error('Invalid slug. Use letters, numbers, and hyphens.');
  }

  if (collection.files.some((file) => file.id === normalizedSlug)) {
    throw new Error(`A file with slug "${normalizedSlug}" already exists.`);
  }

  const extension = inferFileExtension(collection.files);
  const rootPath = getCollectionsRootPath();
  const collectionDir = resolve(
    rootPath,
    'src',
    'content',
    input.collectionName,
  );
  const nextFilePath = resolve(collectionDir, `${normalizedSlug}${extension}`);

  try {
    await access(nextFilePath);
    throw new Error(`A file already exists at "${nextFilePath}".`);
  } catch (error) {
    const code =
      typeof error === 'object' && error !== null && 'code' in error
        ? error.code
        : undefined;
    if (code && code !== 'ENOENT') {
      throw new Error(
        `Unable to check file "${nextFilePath}": ${getErrorMessage(error)}`,
      );
    }
  }

  const nextContent = '';
  const nextData: Record<string, unknown> = {};
  const nextFileBody = matter.stringify(nextContent, nextData);

  try {
    await mkdir(collectionDir, { recursive: true });
    await writeFile(nextFilePath, nextFileBody, 'utf8');
  } catch (error) {
    throw new Error(
      `Unable to create file "${nextFilePath}": ${getErrorMessage(error)}`,
    );
  }

  appendCollectionsFileCache({
    collectionName: input.collectionName,
    file: {
      id: normalizedSlug,
      filePath: nextFilePath,
      data: {},
      content: nextContent,
      createdAt: new Date().toISOString(),
    },
  });

  return {
    fileId: normalizedSlug,
    filePath: nextFilePath,
  };
}
