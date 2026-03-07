import { writeFile } from 'node:fs/promises';
import matter from 'gray-matter';
import {
  getCollectionsData,
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
