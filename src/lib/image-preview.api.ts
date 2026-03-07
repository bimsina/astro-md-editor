import { createServerFn } from '@tanstack/react-start';
import { readImagePreviewBySourcePath } from '#/lib/image-assets.server';

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export const getLocalImagePreviewServerFn = createServerFn({ method: 'POST' })
  .inputValidator(
    (
      payload: unknown,
    ): {
      currentFilePath: string;
      sourcePath: string;
    } => {
      if (!isObjectRecord(payload)) {
        throw new Error('Invalid local image preview payload.');
      }

      const currentFilePath = payload.currentFilePath;
      if (typeof currentFilePath !== 'string' || currentFilePath.length === 0) {
        throw new Error('Missing current file path.');
      }

      const sourcePath = payload.sourcePath;
      if (typeof sourcePath !== 'string' || sourcePath.length === 0) {
        throw new Error('Missing source path.');
      }

      return {
        currentFilePath,
        sourcePath,
      };
    },
  )
  .handler(async ({ data }) => {
    const preview = await readImagePreviewBySourcePath(data);
    return new Response(new Uint8Array(preview.bytes), {
      headers: {
        'Content-Type': preview.mimeType,
        'Cache-Control': 'public, max-age=300',
      },
    });
  });
