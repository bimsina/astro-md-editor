import { createServerFn } from '@tanstack/react-start';
import {
  listFileHistory,
  readFileRevision,
  type FileHistoryListResult,
  type FileRevisionPayload,
} from '#/lib/file-history.server';

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

type ListFileHistoryInput = {
  filePath: string;
  limit?: number;
  cursor?: string;
};

type ReadFileRevisionInput = {
  filePath: string;
  commitSha: string;
};

export const listFileHistoryServerFn = createServerFn({ method: 'POST' })
  .inputValidator((payload: unknown): ListFileHistoryInput => {
    if (!isObjectRecord(payload)) {
      throw new Error('Invalid history list payload.');
    }

    const filePath = payload.filePath;
    if (typeof filePath !== 'string' || filePath.length === 0) {
      throw new Error('Missing file path.');
    }

    const limit = payload.limit;
    if (
      limit !== undefined &&
      (typeof limit !== 'number' || !Number.isFinite(limit) || limit <= 0)
    ) {
      throw new Error('Invalid history limit.');
    }

    const cursor = payload.cursor;
    if (cursor !== undefined && typeof cursor !== 'string') {
      throw new Error('Invalid history cursor.');
    }

    return {
      filePath,
      limit,
      cursor,
    };
  })
  .handler(async ({ data }): Promise<FileHistoryListResult> => {
    return listFileHistory(data);
  });

export const readFileRevisionServerFn = createServerFn({ method: 'POST' })
  .inputValidator((payload: unknown): ReadFileRevisionInput => {
    if (!isObjectRecord(payload)) {
      throw new Error('Invalid revision payload.');
    }

    const filePath = payload.filePath;
    const commitSha = payload.commitSha;
    if (typeof filePath !== 'string' || filePath.length === 0) {
      throw new Error('Missing file path.');
    }
    if (typeof commitSha !== 'string' || commitSha.length === 0) {
      throw new Error('Missing commit SHA.');
    }

    return {
      filePath,
      commitSha,
    };
  })
  .handler(async ({ data }): Promise<FileRevisionPayload> => {
    return readFileRevision(data);
  });
