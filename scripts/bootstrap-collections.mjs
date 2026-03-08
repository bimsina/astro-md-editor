import { access, readFile, readdir, stat } from 'node:fs/promises';
import { basename, isAbsolute, relative, resolve } from 'node:path';
import { config as dotenvConfig } from 'dotenv';
import matter from 'gray-matter';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { z } from 'zod';

const ROOT_ENV_KEY = 'APP_ROOT_PATH';
const DEFAULT_ROOT_PATH = '.';
const COLLECTIONS_RELATIVE_PATH_PREFIX = '.astro/collections/';
const CONTENT_RELATIVE_PATH_PREFIX = 'src/content/';
const CONTENT_CONFIG_CANDIDATES = [
  'src/content.config.ts',
  'src/content.config.mjs',
  'src/content.config.js',
  'src/content/config.ts',
  'src/content/config.mjs',
  'src/content/config.js',
];
const FIELD_OVERRIDES_FILE = 'astro-md-editor.fields.json';
const ASTRO_DEFINITION_PREFIX = '#/definitions/';
const CONTENT_FILE_EXTENSIONS = new Set(['.md', '.mdx', '.markdown']);

const imageModeSchema = z.enum(['asset', 'public']);
const fieldOverrideSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('image'),
      multiple: z.boolean().optional(),
      mode: imageModeSchema.optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('color'),
    })
    .strict(),
  z
    .object({
      type: z.literal('icon'),
      icon_libraries: z.array(z.string()).optional(),
    })
    .strict(),
]);

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
  let positionalPath;
  let flagPath;
  const forwardArgs = [];

  let startIndex = 0;
  const firstArg = argv[0];
  if (typeof firstArg === 'string' && !firstArg.startsWith('-')) {
    positionalPath = firstArg;
    startIndex = 1;
  }

  for (let i = startIndex; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === '--path') {
      const value = argv[i + 1];
      if (!value) {
        throw new Error('Missing value for --path.');
      }
      flagPath = value;
      i += 1;
      continue;
    }

    if (arg.startsWith('--path=')) {
      const value = arg.slice('--path='.length);
      if (!value) {
        throw new Error('Missing value for --path.');
      }
      flagPath = value;
      continue;
    }

    forwardArgs.push(arg);
  }

  return {
    cliPath: positionalPath ?? flagPath,
    forwardArgs,
  };
}

function hasSupportedContentExtension(filePath) {
  const lowercasePath = filePath.toLowerCase();
  for (const extension of CONTENT_FILE_EXTENSIONS) {
    if (lowercasePath.endsWith(extension)) {
      return true;
    }
  }

  return false;
}

function getPropertyNameText(node, ts) {
  if (!node) {
    return undefined;
  }

  if (ts.isIdentifier(node) || ts.isStringLiteral(node)) {
    return node.text;
  }

  return undefined;
}

function getReturnExpression(body, ts) {
  if (!body) {
    return undefined;
  }

  if (!ts.isBlock(body)) {
    return body;
  }

  for (const statement of body.statements) {
    if (ts.isReturnStatement(statement)) {
      return statement.expression;
    }
  }

  return undefined;
}

function unwrapCallWrappers(expression, ts) {
  let current = expression;
  while (
    ts.isCallExpression(current) &&
    ts.isPropertyAccessExpression(current.expression) &&
    ts.isCallExpression(current.expression.expression)
  ) {
    current = current.expression.expression;
  }

  return current;
}

function isNamedCall(node, names, ts) {
  return ts.isCallExpression(node) && ts.isIdentifier(node.expression)
    ? names.has(node.expression.text)
    : false;
}

function isZArrayCall(node, zNames, ts) {
  if (
    !ts.isCallExpression(node) ||
    !ts.isPropertyAccessExpression(node.expression)
  ) {
    return false;
  }

  return (
    ts.isIdentifier(node.expression.expression) &&
    zNames.has(node.expression.expression.text) &&
    node.expression.name.text === 'array'
  );
}

function parseSchemaFieldKindsFromFunction(functionNode, ts, zNames) {
  const schemaExpression = getReturnExpression(functionNode.body, ts);
  if (!schemaExpression) {
    return {};
  }

  const unwrappedSchemaExpression = unwrapCallWrappers(schemaExpression, ts);
  if (
    !ts.isCallExpression(unwrappedSchemaExpression) ||
    !ts.isPropertyAccessExpression(unwrappedSchemaExpression.expression) ||
    !ts.isIdentifier(unwrappedSchemaExpression.expression.expression) ||
    !zNames.has(unwrappedSchemaExpression.expression.expression.text) ||
    unwrappedSchemaExpression.expression.name.text !== 'object'
  ) {
    return {};
  }

  const objectArgument = unwrappedSchemaExpression.arguments[0];
  if (!objectArgument || !ts.isObjectLiteralExpression(objectArgument)) {
    return {};
  }

  const imageNames = new Set();
  const [firstParameter] = functionNode.parameters;
  if (firstParameter && ts.isObjectBindingPattern(firstParameter.name)) {
    for (const element of firstParameter.name.elements) {
      const propertyName = getPropertyNameText(element.propertyName, ts);
      const bindingName = ts.isIdentifier(element.name)
        ? element.name.text
        : undefined;
      if (propertyName === 'image' && bindingName) {
        imageNames.add(bindingName);
      }

      if (!propertyName && bindingName === 'image') {
        imageNames.add(bindingName);
      }
    }
  }

  if (imageNames.size === 0) {
    imageNames.add('image');
  }

  const fieldKinds = {};
  for (const property of objectArgument.properties) {
    if (!ts.isPropertyAssignment(property)) {
      continue;
    }

    const fieldName = getPropertyNameText(property.name, ts);
    if (!fieldName) {
      continue;
    }

    const unwrappedValue = unwrapCallWrappers(property.initializer, ts);
    if (isNamedCall(unwrappedValue, imageNames, ts)) {
      fieldKinds[fieldName] = 'image';
      continue;
    }

    if (!isZArrayCall(unwrappedValue, zNames, ts)) {
      continue;
    }

    const [arrayItemNode] = unwrappedValue.arguments;
    if (!arrayItemNode) {
      continue;
    }

    const unwrappedArrayItem = unwrapCallWrappers(arrayItemNode, ts);
    if (isNamedCall(unwrappedArrayItem, imageNames, ts)) {
      fieldKinds[fieldName] = 'imageArray';
    }
  }

  return fieldKinds;
}

function parseCollectionsExportMap(sourceFile, ts, definedCollections) {
  const mapped = {};

  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) {
      continue;
    }

    const hasExportModifier = statement.modifiers?.some(
      (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
    );
    if (!hasExportModifier) {
      continue;
    }

    for (const declaration of statement.declarationList.declarations) {
      if (
        !ts.isIdentifier(declaration.name) ||
        declaration.name.text !== 'collections' ||
        !declaration.initializer ||
        !ts.isObjectLiteralExpression(declaration.initializer)
      ) {
        continue;
      }

      for (const property of declaration.initializer.properties) {
        if (ts.isShorthandPropertyAssignment(property)) {
          const variableName = property.name.text;
          const fieldKinds = definedCollections[variableName];
          if (fieldKinds && Object.keys(fieldKinds).length > 0) {
            mapped[variableName] = fieldKinds;
          }
          continue;
        }

        if (!ts.isPropertyAssignment(property)) {
          continue;
        }

        const collectionName = getPropertyNameText(property.name, ts);
        if (!collectionName || !ts.isIdentifier(property.initializer)) {
          continue;
        }

        const fieldKinds = definedCollections[property.initializer.text];
        if (fieldKinds && Object.keys(fieldKinds).length > 0) {
          mapped[collectionName] = fieldKinds;
        }
      }
    }
  }

  return mapped;
}

function parseImageFieldKindsFromContentConfig({ sourceText, filePath, ts }) {
  const sourceFile = ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
  );

  const defineCollectionNames = new Set(['defineCollection']);
  const zNames = new Set(['z']);

  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) {
      continue;
    }

    if (
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== 'astro:content'
    ) {
      continue;
    }

    const importClause = statement.importClause;
    if (
      !importClause?.namedBindings ||
      !ts.isNamedImports(importClause.namedBindings)
    ) {
      continue;
    }

    for (const importSpecifier of importClause.namedBindings.elements) {
      const importedName = importSpecifier.propertyName
        ? importSpecifier.propertyName.text
        : importSpecifier.name.text;
      const localName = importSpecifier.name.text;
      if (importedName === 'defineCollection') {
        defineCollectionNames.add(localName);
      }
      if (importedName === 'z') {
        zNames.add(localName);
      }
    }
  }

  const definedCollections = {};

  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) {
      continue;
    }

    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || !declaration.initializer) {
        continue;
      }

      if (!isNamedCall(declaration.initializer, defineCollectionNames, ts)) {
        continue;
      }

      const [configArg] = declaration.initializer.arguments;
      if (!configArg || !ts.isObjectLiteralExpression(configArg)) {
        continue;
      }

      const schemaProperty = configArg.properties.find((property) => {
        return (
          ts.isPropertyAssignment(property) &&
          getPropertyNameText(property.name, ts) === 'schema'
        );
      });

      if (
        !schemaProperty ||
        !ts.isPropertyAssignment(schemaProperty) ||
        !(
          ts.isArrowFunction(schemaProperty.initializer) ||
          ts.isFunctionExpression(schemaProperty.initializer)
        )
      ) {
        continue;
      }

      const fieldKinds = parseSchemaFieldKindsFromFunction(
        schemaProperty.initializer,
        ts,
        zNames,
      );
      if (Object.keys(fieldKinds).length > 0) {
        definedCollections[declaration.name.text] = fieldKinds;
      }
    }
  }

  const mappedExports = parseCollectionsExportMap(
    sourceFile,
    ts,
    definedCollections,
  );
  if (Object.keys(mappedExports).length > 0) {
    return mappedExports;
  }

  return definedCollections;
}

async function readOptionalFile(filePath) {
  try {
    const source = await readFile(filePath, 'utf8');
    return source;
  } catch (error) {
    const code =
      typeof error === 'object' && error !== null && 'code' in error
        ? error.code
        : undefined;
    if (code === 'ENOENT') {
      return undefined;
    }
    throw error;
  }
}

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function resolveAstroCliPath(rootDir) {
  const candidatePaths =
    process.platform === 'win32'
      ? [
          resolve(rootDir, 'node_modules/.bin/astro.cmd'),
          resolve(rootDir, 'node_modules/.bin/astro'),
        ]
      : [resolve(rootDir, 'node_modules/.bin/astro')];

  for (const candidatePath of candidatePaths) {
    if (await fileExists(candidatePath)) {
      return candidatePath;
    }
  }

  return undefined;
}

async function runAstroSync(rootDir, env = process.env) {
  const astroCliPath = await resolveAstroCliPath(rootDir);
  if (!astroCliPath) {
    throw new Error(
      `Astro CLI was not found at ${resolve(
        rootDir,
        'node_modules/.bin/astro',
      )}. Install dependencies in ${rootDir} and try again.`,
    );
  }

  await new Promise((resolveSync, rejectSync) => {
    const child = spawn(astroCliPath, ['sync'], {
      cwd: rootDir,
      stdio: 'inherit',
      env,
      shell: process.platform === 'win32',
    });

    child.on('error', rejectSync);
    child.on('exit', (code, signal) => {
      if (signal || code !== 0) {
        rejectSync(
          new Error(
            `astro sync failed in ${rootDir} with exit code ${code ?? 'unknown'}.`,
          ),
        );
        return;
      }

      resolveSync();
    });
  });
}

async function readDirEntriesSafe(dirPath) {
  try {
    return await readdir(dirPath, { withFileTypes: true });
  } catch (error) {
    const code =
      typeof error === 'object' && error !== null && 'code' in error
        ? error.code
        : undefined;
    if (code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

async function collectCollectionContentFiles(collectionDirPath) {
  const stack = [collectionDirPath];
  const files = [];

  while (stack.length > 0) {
    const currentDir = stack.pop();
    if (!currentDir) {
      continue;
    }

    const dirEntries = await readDirEntriesSafe(currentDir);
    for (const entry of dirEntries) {
      const entryPath = resolve(currentDir, entry.name);
      if (entry.isDirectory()) {
        stack.push(entryPath);
        continue;
      }

      if (entry.isFile() && hasSupportedContentExtension(entry.name)) {
        files.push(entryPath);
      }
    }
  }

  files.sort();
  return files;
}

async function buildCollectionsFromFilesystem(rootDir) {
  const schemaDirPath = resolve(rootDir, COLLECTIONS_RELATIVE_PATH_PREFIX);
  const contentDirPath = resolve(rootDir, CONTENT_RELATIVE_PATH_PREFIX);

  const schemaNames = new Set();
  const schemaEntries = await readDirEntriesSafe(schemaDirPath);
  for (const schemaEntry of schemaEntries) {
    if (!schemaEntry.isFile()) {
      continue;
    }

    if (!schemaEntry.name.endsWith('.schema.json')) {
      continue;
    }

    const collectionName = schemaEntry.name.slice(0, -'.schema.json'.length);
    if (collectionName.length > 0) {
      schemaNames.add(collectionName);
    }
  }

  const contentCollectionNames = new Set();
  const contentEntries = await readDirEntriesSafe(contentDirPath);
  for (const contentEntry of contentEntries) {
    if (!contentEntry.isDirectory()) {
      continue;
    }

    contentCollectionNames.add(contentEntry.name);
  }

  const collectionNames = [
    ...new Set([...schemaNames, ...contentCollectionNames]),
  ].sort();
  if (collectionNames.length === 0) {
    throw new Error(
      `No collections found. Expected schema files under ${schemaDirPath} or content folders under ${contentDirPath}.`,
    );
  }

  const entries = {};
  const collections = [];
  for (const collectionName of collectionNames) {
    collections.push({
      name: collectionName,
      hasSchema: schemaNames.has(collectionName),
    });

    const collectionDirPath = resolve(contentDirPath, collectionName);
    const collectionFiles =
      await collectCollectionContentFiles(collectionDirPath);
    for (const filePath of collectionFiles) {
      entries[filePath] = collectionName;
    }
  }

  return {
    collections,
    entries,
  };
}

async function resolveContentConfigPath(rootDir) {
  for (const candidate of CONTENT_CONFIG_CANDIDATES) {
    const fullPath = resolve(rootDir, candidate);
    const source = await readOptionalFile(fullPath);
    if (source !== undefined) {
      return {
        filePath: fullPath,
        source,
      };
    }
  }

  return undefined;
}

async function loadInferredImageFieldKinds(rootDir) {
  const contentConfig = await resolveContentConfigPath(rootDir);
  if (!contentConfig) {
    return {};
  }

  let ts;
  try {
    const tsModule = await import('typescript');
    ts = tsModule.default ?? tsModule;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(
      `[bootstrap] Unable to load TypeScript for image() inference: ${message}`,
    );
    return {};
  }

  try {
    return parseImageFieldKindsFromContentConfig({
      sourceText: contentConfig.source,
      filePath: contentConfig.filePath,
      ts,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(
      `[bootstrap] Failed to parse image() fields from ${contentConfig.filePath}: ${message}`,
    );
    return {};
  }
}

async function loadFieldOverrides(rootDir) {
  const configPath = resolve(rootDir, FIELD_OVERRIDES_FILE);
  const source = await readOptionalFile(configPath);
  if (source === undefined) {
    return {};
  }

  let parsed;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[bootstrap] Invalid JSON in ${configPath}: ${message}`);
    return {};
  }

  if (!isRecord(parsed)) {
    console.warn(
      `[bootstrap] Ignoring ${FIELD_OVERRIDES_FILE}: expected a top-level object.`,
    );
    return {};
  }

  const overridesByCollection = {};

  for (const [collectionName, fieldEntries] of Object.entries(parsed)) {
    if (!isRecord(fieldEntries)) {
      console.warn(
        `[bootstrap] Ignoring ${collectionName} overrides: expected object of fields.`,
      );
      continue;
    }

    for (const [fieldKey, rawOverride] of Object.entries(fieldEntries)) {
      const parsedOverride = fieldOverrideSchema.safeParse(rawOverride);
      if (!parsedOverride.success) {
        const issueMessage = parsedOverride.error.issues
          .map((issue) => issue.message)
          .join('; ');
        console.warn(
          `[bootstrap] Ignoring override ${collectionName}.${fieldKey}: ${issueMessage}`,
        );
        continue;
      }

      if (!overridesByCollection[collectionName]) {
        overridesByCollection[collectionName] = {};
      }
      overridesByCollection[collectionName][fieldKey] = parsedOverride.data;
    }
  }

  return overridesByCollection;
}

function asObjectSchema(value) {
  if (
    !isRecord(value) ||
    value.type !== 'object' ||
    !isRecord(value.properties)
  ) {
    return undefined;
  }

  return value;
}

function resolveAstroObjectSchema(schema) {
  const direct = asObjectSchema(schema);
  if (direct) {
    return direct;
  }

  if (!isRecord(schema) || typeof schema.$ref !== 'string') {
    return undefined;
  }

  if (!schema.$ref.startsWith(ASTRO_DEFINITION_PREFIX)) {
    return undefined;
  }

  const definitionKey = schema.$ref.slice(ASTRO_DEFINITION_PREFIX.length);
  const definitions = isRecord(schema.definitions)
    ? schema.definitions
    : undefined;
  const resolvedDefinition = definitions?.[definitionKey];
  return asObjectSchema(resolvedDefinition);
}

function resolveSchemaCompatibilityKind(propertySchema, desiredKind) {
  if (!isRecord(propertySchema)) {
    return undefined;
  }

  if (desiredKind === 'image' && propertySchema.type === 'string') {
    return 'image';
  }

  if (
    desiredKind === 'imageArray' &&
    propertySchema.type === 'array' &&
    isRecord(propertySchema.items) &&
    propertySchema.items.type === 'string'
  ) {
    return 'imageArray';
  }

  if (desiredKind === 'color' && propertySchema.type === 'string') {
    return 'color';
  }

  if (desiredKind === 'icon' && propertySchema.type === 'string') {
    return 'icon';
  }

  return undefined;
}

function normalizeIconLibraries(iconLibraries) {
  if (!Array.isArray(iconLibraries)) {
    return undefined;
  }

  const normalized = [
    ...new Set(
      iconLibraries
        .map((value) => (typeof value === 'string' ? value.trim() : ''))
        .filter((value) => value.length > 0)
        .map((value) => value.toLowerCase()),
    ),
  ];
  return normalized.length > 0 ? normalized : undefined;
}

function getOverrideConfig(override) {
  if (!override) {
    return undefined;
  }

  if (override.type === 'image') {
    return {
      kind: override.multiple ? 'imageArray' : 'image',
      mode: override.mode ?? 'asset',
    };
  }

  if (override.type === 'color') {
    return {
      kind: 'color',
    };
  }

  if (override.type === 'icon') {
    return {
      kind: 'icon',
      iconLibraries: normalizeIconLibraries(override.icon_libraries),
    };
  }

  return undefined;
}

function resolveCollectionFieldUiKinds(params) {
  const { collectionName, schema, inferredFieldKinds, overrideEntries } =
    params;
  const objectSchema = resolveAstroObjectSchema(schema);
  if (!objectSchema) {
    return undefined;
  }

  const resolvedKinds = {};

  const applyKind = (
    fieldKey,
    nextKind,
    sourceLabel,
    mode = 'asset',
    iconLibraries,
  ) => {
    if (!nextKind) {
      return;
    }

    const propertySchema = objectSchema.properties[fieldKey];
    const compatibleKind = resolveSchemaCompatibilityKind(
      propertySchema,
      nextKind,
    );

    if (!compatibleKind) {
      console.warn(
        `[bootstrap] Ignoring ${sourceLabel} override for ${collectionName}.${fieldKey}: incompatible with schema.`,
      );
      return;
    }

    if (compatibleKind === 'image' || compatibleKind === 'imageArray') {
      resolvedKinds[fieldKey] = {
        kind: compatibleKind,
        mode: mode === 'public' ? 'public' : 'asset',
      };
      return;
    }

    if (compatibleKind === 'icon') {
      resolvedKinds[fieldKey] = {
        kind: 'icon',
        iconLibraries,
      };
      return;
    }

    resolvedKinds[fieldKey] = {
      kind: compatibleKind,
    };
  };

  for (const [fieldKey, inferredKind] of Object.entries(
    inferredFieldKinds ?? {},
  )) {
    applyKind(fieldKey, inferredKind, 'inferred', 'asset');
  }

  for (const [fieldKey, override] of Object.entries(overrideEntries ?? {})) {
    const overrideConfig = getOverrideConfig(override);
    applyKind(
      fieldKey,
      overrideConfig?.kind,
      'custom',
      overrideConfig?.mode,
      overrideConfig?.iconLibraries,
    );
  }

  return Object.keys(resolvedKinds).length > 0 ? resolvedKinds : undefined;
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
    normalizePathInput(cliPath) ??
    normalizePathInput(env[ROOT_ENV_KEY]) ??
    DEFAULT_ROOT_PATH;

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

  if (mode === 'development') {
    console.warn(`[bootstrap] Running "astro sync" in ${rootDir}.`);
    await runAstroSync(rootDir, env);
  }
  let collectionsParsed = await buildCollectionsFromFilesystem(rootDir);

  if (
    !isRecord(collectionsParsed) ||
    !Array.isArray(collectionsParsed.collections)
  ) {
    const schemaDirPath = resolve(rootDir, COLLECTIONS_RELATIVE_PATH_PREFIX);
    throw new Error(
      `Invalid collections shape from filesystem scan. Expected "collections" array from ${schemaDirPath} and ${resolve(rootDir, CONTENT_RELATIVE_PATH_PREFIX)}.`,
    );
  }

  const inferredFieldKindsByCollection =
    await loadInferredImageFieldKinds(rootDir);
  const fieldOverridesByCollection = await loadFieldOverrides(rootDir);

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

    if (!isRecord(collection) || typeof collection.name !== 'string') {
      continue;
    }

    collection.fieldUi = resolveCollectionFieldUiKinds({
      collectionName: collection.name,
      schema: collection.schema,
      inferredFieldKinds: inferredFieldKindsByCollection[collection.name],
      overrideEntries: fieldOverridesByCollection[collection.name],
    });
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
    collectionsParsed,
    forwardArgs,
  };
}

export function applyCollectionsEnv(targetEnv, bootstrapResult) {
  targetEnv.APP_COLLECTIONS_ROOT = bootstrapResult.rootDir;
  const collectionsJsonWithSchema = JSON.stringify(
    bootstrapResult.collectionsParsed,
  );
  targetEnv.APP_COLLECTIONS_JSON_B64 = Buffer.from(
    collectionsJsonWithSchema,
    'utf8',
  ).toString('base64');
}
