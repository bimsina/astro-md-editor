/// <reference types="node" />

const COLLECTIONS_JSON_B64_ENV_KEY = 'APP_COLLECTIONS_JSON_B64';
const COLLECTIONS_FILE_ENV_KEY = 'APP_COLLECTIONS_FILE';

type ObjectRecord = Record<string, {}>;

let cachedCollectionsRaw: string | undefined;
let cachedCollectionsData: unknown;
let hasParsedCollectionsData = false;

function requireEnvValue(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(
      `[collections] Missing ${key}. Start the app with the bootstrap launcher.`,
    );
  }

  return value;
}

export function getCollectionsRaw(): string {
  if (cachedCollectionsRaw !== undefined) {
    return cachedCollectionsRaw;
  }

  const encoded = requireEnvValue(COLLECTIONS_JSON_B64_ENV_KEY);
  cachedCollectionsRaw = Buffer.from(encoded, 'base64').toString('utf8');
  return cachedCollectionsRaw;
}

type CollectionsData = {
  collections: {
    hasSchema?: boolean;
    schema?: ObjectRecord;
    name: string;
    files?: {
      id: string;
      filePath: string;
      data: ObjectRecord;
      content: string;
    }[];
  }[];
};

function asObjectRecord(value: unknown): ObjectRecord | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined;
  }

  return value as ObjectRecord;
}

function cloneObjectRecord(value: ObjectRecord): ObjectRecord {
  return JSON.parse(JSON.stringify(value)) as ObjectRecord;
}

function getParsedCollectionsData(): CollectionsData {
  if (hasParsedCollectionsData) {
    return cachedCollectionsData as CollectionsData;
  }

  const raw = getCollectionsRaw();
  cachedCollectionsData = JSON.parse(raw) as CollectionsData;
  hasParsedCollectionsData = true;
  return cachedCollectionsData as CollectionsData;
}

export function getCollectionsData(): {
  name: string;
  hasSchema?: boolean;
  schema?: ObjectRecord;
  files: {
    id: string;
    filePath: string;
    data: ObjectRecord;
    content: string;
  }[];
}[] {
  const data = getParsedCollectionsData();

  return data.collections.map((collection) => ({
    name: collection.name,
    hasSchema: collection.hasSchema,
    schema: asObjectRecord(collection.schema),
    files: (collection.files ?? []).map((file) => ({
      ...file,
      data: cloneObjectRecord(asObjectRecord(file.data) ?? {}),
    })),
  }));
}

export function updateCollectionsFileCache(params: {
  collectionName: string;
  fileId: string;
  data: ObjectRecord;
  content: string;
}): boolean {
  const parsed = getParsedCollectionsData();
  const targetCollection = parsed.collections.find(
    (collection) => collection.name === params.collectionName,
  );
  if (!targetCollection?.files) {
    return false;
  }

  const targetFile = targetCollection.files.find(
    (file) => file.id === params.fileId,
  );
  if (!targetFile) {
    return false;
  }

  targetFile.data = cloneObjectRecord(params.data);
  targetFile.content = params.content;
  cachedCollectionsRaw = JSON.stringify(parsed);
  cachedCollectionsData = parsed;
  hasParsedCollectionsData = true;
  return true;
}

export function getCollectionsFilePath(): string {
  return requireEnvValue(COLLECTIONS_FILE_ENV_KEY);
}
