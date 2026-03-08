/// <reference types="node" />

const COLLECTIONS_JSON_B64_ENV_KEY = 'APP_COLLECTIONS_JSON_B64';
const COLLECTIONS_ROOT_ENV_KEY = 'APP_COLLECTIONS_ROOT';

type ObjectRecord = Record<string, {}>;
type ImageFieldUiMode = 'asset' | 'public';
type FieldUiConfig =
  | {
      kind: 'image' | 'imageArray';
      mode: ImageFieldUiMode;
    }
  | {
      kind: 'color';
    }
  | {
      kind: 'icon';
      iconLibraries?: string[];
    };
type FieldUiMap = Record<string, FieldUiConfig>;

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
    fieldUi?: FieldUiMap;
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

function asFieldUiMap(value: unknown): FieldUiMap | undefined {
  const record = asObjectRecord(value);
  if (!record) {
    return undefined;
  }

  const parsed: FieldUiMap = {};
  for (const [key, rawValue] of Object.entries(record)) {
    if (
      rawValue === 'image' ||
      rawValue === 'imageArray' ||
      rawValue === 'color' ||
      rawValue === 'icon'
    ) {
      if (rawValue === 'color') {
        parsed[key] = { kind: 'color' };
        continue;
      }

      if (rawValue === 'icon') {
        parsed[key] = { kind: 'icon' };
        continue;
      }

      parsed[key] = {
        kind: rawValue,
        mode: 'asset',
      };
      continue;
    }

    const rawConfig = asObjectRecord(rawValue);
    if (!rawConfig || typeof rawConfig.kind !== 'string') {
      continue;
    }

    if (rawConfig.kind === 'image' || rawConfig.kind === 'imageArray') {
      parsed[key] = {
        kind: rawConfig.kind,
        mode: rawConfig.mode === 'public' ? 'public' : 'asset',
      };
      continue;
    }

    if (rawConfig.kind === 'color') {
      parsed[key] = {
        kind: 'color',
      };
      continue;
    }

    if (rawConfig.kind === 'icon') {
      const iconLibraries =
        asStringArray(rawConfig.iconLibraries) ??
        asStringArray(rawConfig.icon_libraries);
      parsed[key] = {
        kind: 'icon',
        iconLibraries,
      };
    }
  }

  return Object.keys(parsed).length > 0 ? parsed : undefined;
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const parsed = [
    ...new Set(
      value
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim().toLowerCase())
        .filter((item) => item.length > 0),
    ),
  ];

  return parsed.length > 0 ? parsed : undefined;
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
  fieldUi?: FieldUiMap;
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
    fieldUi: asFieldUiMap(collection.fieldUi),
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

export function removeCollectionsFileCache(params: {
  collectionName: string;
  fileId: string;
}): boolean {
  const parsed = getParsedCollectionsData();
  const targetCollection = parsed.collections.find(
    (collection) => collection.name === params.collectionName,
  );
  if (!targetCollection?.files) {
    return false;
  }

  const nextFiles = targetCollection.files.filter(
    (file) => file.id !== params.fileId,
  );
  if (nextFiles.length === targetCollection.files.length) {
    return false;
  }

  targetCollection.files = nextFiles;
  cachedCollectionsRaw = JSON.stringify(parsed);
  cachedCollectionsData = parsed;
  hasParsedCollectionsData = true;
  return true;
}

export function appendCollectionsFileCache(params: {
  collectionName: string;
  file: {
    id: string;
    filePath: string;
    data: ObjectRecord;
    content: string;
  };
}): boolean {
  const parsed = getParsedCollectionsData();
  const targetCollection = parsed.collections.find(
    (collection) => collection.name === params.collectionName,
  );
  if (!targetCollection) {
    return false;
  }

  if (!targetCollection.files) {
    targetCollection.files = [];
  }

  targetCollection.files.push({
    id: params.file.id,
    filePath: params.file.filePath,
    data: cloneObjectRecord(params.file.data),
    content: params.file.content,
  });
  cachedCollectionsRaw = JSON.stringify(parsed);
  cachedCollectionsData = parsed;
  hasParsedCollectionsData = true;
  return true;
}

export function getCollectionsRootPath(): string {
  return requireEnvValue(COLLECTIONS_ROOT_ENV_KEY);
}
