import { execFile as execFileCallback } from 'node:child_process';
import { isAbsolute, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import matter from 'gray-matter';
import { getCollectionsRootPath } from '#/lib/collections.server';

const execFile = promisify(execFileCallback);
const GIT_FIELD_SEPARATOR = '\u001f';
const GIT_RECORD_SEPARATOR = '\u001e';
const DEFAULT_HISTORY_LIMIT = 50;
const MAX_HISTORY_LIMIT = 200;
const GIT_COMMAND_MAX_BUFFER = 10 * 1024 * 1024;

export type HistoryCommit = {
  sha: string;
  shortSha: string;
  author: string;
  dateIso: string;
  message: string;
};

export type FileRevisionPayload = {
  content: string;
  frontmatter: Record<string, {}>;
  parseWarnings: string[];
};

type HistoryCommitWithTreePath = HistoryCommit & {
  treePath: string;
};

type ParsedHistoryResult = {
  commits: HistoryCommitWithTreePath[];
};

export type FileHistoryListResult = {
  commits: HistoryCommit[];
  nextCursor?: string;
  unavailableReason?: string;
};

function isObjectRecord(value: unknown): value is Record<string, {}> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function toPosixPath(pathLike: string): string {
  return pathLike.replaceAll('\\', '/');
}

function normalizePathWithinRoot(rootDir: string, filePath: string): string {
  const absolutePath = isAbsolute(filePath)
    ? resolve(filePath)
    : resolve(rootDir, filePath);
  const relativePath = toPosixPath(relative(rootDir, absolutePath));

  if (
    relativePath.length === 0 ||
    relativePath.startsWith('..') ||
    relativePath.includes('/../')
  ) {
    throw new Error('File path is outside the configured project root.');
  }

  return relativePath;
}

async function runGitCommand(params: {
  rootDir: string;
  args: string[];
}): Promise<string> {
  try {
    const result = await execFile('git', params.args, {
      cwd: params.rootDir,
      encoding: 'utf8',
      maxBuffer: GIT_COMMAND_MAX_BUFFER,
    });

    return result.stdout;
  } catch (error) {
    const baseMessage = getErrorMessage(error);
    throw new Error(`Git command failed: ${baseMessage}`);
  }
}

async function isGitRepository(rootDir: string): Promise<boolean> {
  try {
    await runGitCommand({
      rootDir,
      args: ['rev-parse', '--is-inside-work-tree'],
    });

    return true;
  } catch {
    return false;
  }
}

function parseNameStatusTreePath(params: {
  lines: string[];
  fallbackPath: string;
}): string {
  for (const line of params.lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    const parts = trimmed.split('\t');
    if (parts.length < 2) {
      continue;
    }

    const status = parts[0] ?? '';
    if (
      (status.startsWith('R') || status.startsWith('C')) &&
      parts.length >= 3
    ) {
      const renamedPath = parts[2];
      if (renamedPath) {
        return renamedPath;
      }
      continue;
    }

    const path = parts[1];
    if (path) {
      return path;
    }
  }

  return params.fallbackPath;
}

export function parseGitHistoryOutput(params: {
  stdout: string;
  fallbackPath: string;
}): ParsedHistoryResult {
  const metadataRegex = new RegExp(
    `([^${GIT_RECORD_SEPARATOR}\\r\\n]*${GIT_FIELD_SEPARATOR}[^${GIT_RECORD_SEPARATOR}\\r\\n]*${GIT_FIELD_SEPARATOR}[^${GIT_RECORD_SEPARATOR}\\r\\n]*${GIT_FIELD_SEPARATOR}[^${GIT_RECORD_SEPARATOR}\\r\\n]*${GIT_FIELD_SEPARATOR}[^${GIT_RECORD_SEPARATOR}\\r\\n]*)${GIT_RECORD_SEPARATOR}`,
    'g',
  );
  const matches = Array.from(params.stdout.matchAll(metadataRegex));

  const commits: HistoryCommitWithTreePath[] = [];

  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    if (!match[1]) {
      continue;
    }

    const metadata = match[1];
    const blockStart = match.index + match[0].length;
    const blockEnd = matches[index + 1]?.index ?? params.stdout.length;
    const statusBlock = params.stdout.slice(blockStart, blockEnd);
    const lines = statusBlock
      .split(/\r?\n/)
      .map((line) => line.trimEnd())
      .filter((line) => line.length > 0);

    const parts = metadata.split(GIT_FIELD_SEPARATOR);
    if (parts.length < 5) {
      continue;
    }

    const [
      sha = '',
      shortSha = '',
      author = '',
      dateIso = '',
      ...messageParts
    ] = parts;
    if (!sha || !shortSha || !dateIso) {
      continue;
    }

    commits.push({
      sha,
      shortSha,
      author,
      dateIso,
      message: messageParts.join(GIT_FIELD_SEPARATOR).trim(),
      treePath: parseNameStatusTreePath({
        lines,
        fallbackPath: params.fallbackPath,
      }),
    });
  }

  return { commits };
}

export function parseRevisionSource(source: string): FileRevisionPayload {
  const parseWarnings: string[] = [];

  try {
    const parsed = matter(source);
    if (!isObjectRecord(parsed.data)) {
      parseWarnings.push(
        'Frontmatter was not an object; body was applied and frontmatter was skipped.',
      );
      return {
        content: parsed.content,
        frontmatter: {},
        parseWarnings,
      };
    }

    return {
      content: parsed.content,
      frontmatter: parsed.data,
      parseWarnings,
    };
  } catch (error) {
    parseWarnings.push(
      `Frontmatter parse failed; applied body only. ${getErrorMessage(error)}`,
    );

    return {
      content: source,
      frontmatter: {},
      parseWarnings,
    };
  }
}

async function resolveFileTreePathAtCommit(params: {
  rootDir: string;
  relativePath: string;
  commitSha: string;
}): Promise<string> {
  const logOutput = await runGitCommand({
    rootDir: params.rootDir,
    args: [
      'log',
      '--follow',
      '--name-status',
      '--format=',
      '-n',
      '1',
      params.commitSha,
      '--',
      params.relativePath,
    ],
  });

  const statusLines = logOutput
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);

  return parseNameStatusTreePath({
    lines: statusLines,
    fallbackPath: params.relativePath,
  });
}

function sanitizeHistoryLimit(limit: number | undefined): number {
  if (!limit || !Number.isFinite(limit) || limit <= 0) {
    return DEFAULT_HISTORY_LIMIT;
  }

  return Math.min(Math.floor(limit), MAX_HISTORY_LIMIT);
}

function sanitizeCursor(cursor: string | undefined): number {
  if (!cursor) {
    return 0;
  }

  const parsed = Number(cursor);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return 0;
  }

  return parsed;
}

function normalizeCommitSha(value: string): string {
  const normalized = value.trim();
  if (!/^[0-9a-f]{7,40}$/i.test(normalized)) {
    throw new Error('Invalid commit SHA.');
  }

  return normalized;
}

export async function listFileHistory(params: {
  filePath: string;
  limit?: number;
  cursor?: string;
}): Promise<FileHistoryListResult> {
  const rootDir = getCollectionsRootPath();
  const isGit = await isGitRepository(rootDir);
  if (!isGit) {
    return {
      commits: [],
      unavailableReason:
        'Git history is unavailable because the selected project is not a Git repository.',
    };
  }

  const relativePath = normalizePathWithinRoot(rootDir, params.filePath);
  const limit = sanitizeHistoryLimit(params.limit);
  const skip = sanitizeCursor(params.cursor);

  const stdout = await runGitCommand({
    rootDir,
    args: [
      'log',
      '--follow',
      '--name-status',
      `--format=%H%x1f%h%x1f%an%x1f%aI%x1f%s%x1e`,
      '--skip',
      String(skip),
      '-n',
      String(limit + 1),
      '--',
      relativePath,
    ],
  });

  const parsed = parseGitHistoryOutput({
    stdout,
    fallbackPath: relativePath,
  });
  const hasMore = parsed.commits.length > limit;
  const visibleCommits = hasMore
    ? parsed.commits.slice(0, limit)
    : parsed.commits;

  return {
    commits: visibleCommits.map((commit) => ({
      sha: commit.sha,
      shortSha: commit.shortSha,
      author: commit.author,
      dateIso: commit.dateIso,
      message: commit.message,
    })),
    nextCursor: hasMore ? String(skip + limit) : undefined,
  };
}

export async function readFileRevision(params: {
  filePath: string;
  commitSha: string;
}): Promise<FileRevisionPayload> {
  const rootDir = getCollectionsRootPath();
  const isGit = await isGitRepository(rootDir);
  if (!isGit) {
    throw new Error('Git history is unavailable for this project.');
  }

  const relativePath = normalizePathWithinRoot(rootDir, params.filePath);
  const commitSha = normalizeCommitSha(params.commitSha);

  let pathAtCommit = relativePath;
  try {
    pathAtCommit = await resolveFileTreePathAtCommit({
      rootDir,
      relativePath,
      commitSha,
    });
  } catch {
    pathAtCommit = relativePath;
  }

  let source: string;
  try {
    source = await runGitCommand({
      rootDir,
      args: ['show', `${commitSha}:${pathAtCommit}`],
    });
  } catch {
    source = await runGitCommand({
      rootDir,
      args: ['show', `${commitSha}:${relativePath}`],
    });
  }

  return parseRevisionSource(source);
}
