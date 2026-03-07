import { readFile, stat } from 'node:fs/promises';
import { basename, isAbsolute, relative, resolve } from 'node:path';
import { config as dotenvConfig } from 'dotenv';
import matter from 'gray-matter';
import { fileURLToPath } from 'node:url';

const ROOT_ENV_KEY = 'APP_ROOT_PATH';
const COLLECTIONS_RELATIVE_PATH_PREFIX = '.astro/collections/';
const COLLECTIONS_RELATIVE_PATH =
  COLLECTIONS_RELATIVE_PATH_PREFIX + 'collections.json';
const CONTENT_RELATIVE_PATH_PREFIX = 'src/content/';

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseFileUrlPath(value) {
  if (!value.startsWith('file://')) {
    return undefined;
  }

  try {
    return fileURLToPath(new URL(value));
  } catch {
    return undefined;
  }
}

function extractContentRelativePath(pathLike) {
  const normalized = pathLike.replaceAll('\\', '/');
  const marker = CONTENT_RELATIVE_PATH_PREFIX.toLowerCase();
  const startIndex = normalized.toLowerCase().lastIndexOf(marker);
  if (startIndex === -1) {
    return undefined;
  }

  const relativePath = normalized
    .slice(startIndex + CONTENT_RELATIVE_PATH_PREFIX.length)
    .replace(/^\/+/, '');

  return relativePath.length > 0 ? relativePath : undefined;
}

function toPosix(pathLike) {
  return pathLike.replaceAll('\\', '/');
}

function stripExtension(pathLike) {
  return pathLike.replace(/\.[^.]+$/, '');
}

function slugifySegment(value) {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');

  return normalized;
}

function buildEntrySlug(rootDir, collectionName, candidatePath, entryKey) {
  const collectionDir = resolve(
    rootDir,
    CONTENT_RELATIVE_PATH_PREFIX + collectionName,
  );

  const relativeFromCollection = toPosix(
    relative(collectionDir, candidatePath),
  );
  let sourcePath;
  if (
    relativeFromCollection.length > 0 &&
    !relativeFromCollection.startsWith('..')
  ) {
    sourcePath = relativeFromCollection;
  } else {
    sourcePath =
      extractContentRelativePath(candidatePath) ??
      extractContentRelativePath(entryKey) ??
      basename(candidatePath);
  }

  const withoutExtension = stripExtension(toPosix(sourcePath));
  const segments = withoutExtension
    .split('/')
    .map((segment) => slugifySegment(segment))
    .filter(Boolean);
  const normalizedCollectionSlug = slugifySegment(collectionName);

  if (segments.length === 0) {
    return 'entry';
  }

  if (segments[0] === normalizedCollectionSlug && segments.length > 1) {
    segments.shift();
  }

  return segments.join('-');
}

function makeUniqueSlug(baseSlug, usedSlugs) {
  const seenCount = usedSlugs.get(baseSlug) ?? 0;
  const nextCount = seenCount + 1;
  usedSlugs.set(baseSlug, nextCount);

  if (nextCount === 1) {
    return baseSlug;
  }

  return `${baseSlug}-${nextCount}`;
}

function getEntryResolutionCandidates(rootDir, entryKey) {
  const candidates = [];
  const seen = new Set();
  const addCandidate = (candidatePath) => {
    if (!candidatePath || seen.has(candidatePath)) {
      return;
    }
    seen.add(candidatePath);
    candidates.push(candidatePath);
  };

  const parsedFileUrlPath = parseFileUrlPath(entryKey);
  const entryPath = parsedFileUrlPath ?? entryKey;
  const relativeContentPath =
    extractContentRelativePath(entryPath) ??
    extractContentRelativePath(entryKey);

  addCandidate(resolve(rootDir, entryPath));

  if (!isAbsolute(entryPath)) {
    addCandidate(resolve(rootDir, CONTENT_RELATIVE_PATH_PREFIX + entryPath));
  }

  if (relativeContentPath) {
    addCandidate(
      resolve(rootDir, CONTENT_RELATIVE_PATH_PREFIX + relativeContentPath),
    );
  }

  return candidates;
}

async function parseCollectionEntry(rootDir, collectionName, entryKey) {
  const candidates = getEntryResolutionCandidates(rootDir, entryKey);

  for (const candidatePath of candidates) {
    let source;
    try {
      source = await readFile(candidatePath, 'utf8');
    } catch (error) {
      const code =
        typeof error === 'object' && error !== null && 'code' in error
          ? error.code
          : undefined;
      if (code === 'ENOENT') {
        continue;
      }

      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Collection entry read failed for "${entryKey}" at ${candidatePath}: ${message}`,
      );
    }

    const parsed = matter(source);
    return {
      slugBase: buildEntrySlug(
        rootDir,
        collectionName,
        candidatePath,
        entryKey,
      ),
      filePath: candidatePath,
      data: parsed.data,
      content: parsed.content,
    };
  }

  throw new Error(
    `Collection entry file not found for "${entryKey}". Tried: ${candidates.join(', ')}`,
  );
}

function normalizePathInput(value) {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parseModeArg(argv) {
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === '--mode') {
      const value = argv[i + 1];
      return normalizePathInput(value);
    }

    if (arg.startsWith('--mode=')) {
      return normalizePathInput(arg.slice('--mode='.length));
    }
  }

  return undefined;
}

function getDotenvCandidates(mode) {
  const files = ['.env.local', '.env'];

  if (mode) {
    files.unshift(`.env.${mode}.local`);
    files.splice(2, 0, `.env.${mode}`);
  }

  return files;
}

function loadDotenv(cwd, mode, env) {
  for (const dotenvFile of getDotenvCandidates(mode)) {
    const dotenvPath = resolve(cwd, dotenvFile);
    const result = dotenvConfig({
      path: dotenvPath,
      quiet: true,
      processEnv: env,
    });
    const error = result.error;

    // Missing dotenv files are optional; any other parse/read error should fail startup.
    if (error && error.code !== 'ENOENT') {
      throw new Error(`Failed to load ${dotenvPath}: ${error.message}`);
    }
  }
}

function parseRootPathArg(argv) {
  let cliPath;
  const forwardArgs = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === '--path') {
      const value = argv[i + 1];
      if (!value) {
        throw new Error('Missing value for --path.');
      }
      cliPath = value;
      i += 1;
      continue;
    }

    if (arg.startsWith('--path=')) {
      const value = arg.slice('--path='.length);
      if (!value) {
        throw new Error('Missing value for --path.');
      }
      cliPath = value;
      continue;
    }

    forwardArgs.push(arg);
  }

  return { cliPath, forwardArgs };
}

export async function bootstrapCollections(argv = [], options = {}) {
  const { env = process.env, cwd = process.cwd(), mode: defaultMode } = options;
  const mode =
    parseModeArg(argv) ??
    normalizePathInput(env.NODE_ENV) ??
    normalizePathInput(defaultMode);
  loadDotenv(cwd, mode, env);
  const { cliPath, forwardArgs } = parseRootPathArg(argv);
  const rootInput =
    normalizePathInput(cliPath) ?? normalizePathInput(env[ROOT_ENV_KEY]);

  if (!rootInput) {
    throw new Error(
      `Missing root path. Provide --path=<root> or set ${ROOT_ENV_KEY}.`,
    );
  }

  const rootDir = resolve(cwd, rootInput);

  let rootStats;
  try {
    rootStats = await stat(rootDir);
  } catch {
    throw new Error(`Root directory not found: ${rootDir}`);
  }

  if (!rootStats.isDirectory()) {
    throw new Error(`Root path is not a directory: ${rootDir}`);
  }

  const collectionsFilePath = resolve(rootDir, COLLECTIONS_RELATIVE_PATH);

  let collectionsRaw;
  try {
    collectionsRaw = await readFile(collectionsFilePath, 'utf8');
  } catch {
    throw new Error(
      `Collections file not found or unreadable: ${collectionsFilePath}`,
    );
  }

  let collectionsParsed;
  try {
    collectionsParsed = JSON.parse(collectionsRaw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Collections JSON parse failed for ${collectionsFilePath}: ${message}`,
    );
  }

  if (
    !isRecord(collectionsParsed) ||
    !Array.isArray(collectionsParsed.collections)
  ) {
    throw new Error(
      `Invalid collections shape in ${collectionsFilePath}: expected "collections" array.`,
    );
  }

  for (const collection of collectionsParsed.collections) {
    if (
      typeof collection === 'object' &&
      'hasSchema' in collection &&
      collection.hasSchema
    ) {
      const schemaFilePath = resolve(
        rootDir,
        COLLECTIONS_RELATIVE_PATH_PREFIX + collection.name + '.schema.json',
      );
      let schemaRaw;
      try {
        schemaRaw = await readFile(schemaFilePath, 'utf8');
      } catch {
        throw new Error(
          `Schema file not found or unreadable: ${schemaFilePath}`,
        );
      }

      let schemaParsed;
      try {
        schemaParsed = JSON.parse(schemaRaw);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(
          `Schema JSON parse failed for ${schemaFilePath}: ${message}`,
        );
      }

      collection.schema = schemaParsed;
    } else {
      collection.schema = undefined;
    }
  }

  const filesByCollection = new Map();
  const usedSlugsByCollection = new Map();
  if (isRecord(collectionsParsed.entries)) {
    for (const [entryKey, collectionName] of Object.entries(
      collectionsParsed.entries,
    )) {
      if (typeof collectionName !== 'string') {
        continue;
      }

      const parsedEntry = await parseCollectionEntry(
        rootDir,
        collectionName,
        entryKey,
      );
      const { slugBase, ...entryWithoutSlug } = parsedEntry;
      const existing = filesByCollection.get(collectionName) ?? [];
      const usedSlugs = usedSlugsByCollection.get(collectionName) ?? new Map();
      const id = makeUniqueSlug(slugBase, usedSlugs);
      usedSlugsByCollection.set(collectionName, usedSlugs);
      existing.push({
        ...entryWithoutSlug,
        id,
      });
      filesByCollection.set(collectionName, existing);
    }
  }

  for (const collection of collectionsParsed.collections) {
    if (!isRecord(collection) || typeof collection.name !== 'string') {
      continue;
    }

    collection.files = filesByCollection.get(collection.name) ?? [];
  }

  return {
    rootDir,
    collectionsFilePath,
    collectionsRaw,
    collectionsParsed,
    forwardArgs,
  };
}

export function applyCollectionsEnv(targetEnv, bootstrapResult) {
  targetEnv.APP_COLLECTIONS_ROOT = bootstrapResult.rootDir;
  targetEnv.APP_COLLECTIONS_FILE = bootstrapResult.collectionsFilePath;
  const collectionsJsonWithSchema = JSON.stringify(
    bootstrapResult.collectionsParsed,
  );
  targetEnv.APP_COLLECTIONS_JSON_B64 = Buffer.from(
    collectionsJsonWithSchema,
    'utf8',
  ).toString('base64');
}
