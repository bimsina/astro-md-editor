import {
  resolveAstroObjectSchema,
  resolveSchemaFields,
  type FieldUiMap,
  type ResolvedField,
} from '#/lib/schema-form';

type ObjectRecord = Record<string, unknown>;

export type ApplyResult = {
  nextDraft: ObjectRecord;
  appliedKeys: string[];
  skippedKeys: string[];
  reasonBySkippedKey: Record<string, string>;
};

type SkipReason =
  | 'schema_unavailable'
  | 'not_in_schema'
  | 'unsupported_field'
  | 'incompatible_type';

function cloneRecord<T extends ObjectRecord>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isCompatibleValue(field: ResolvedField, value: unknown): boolean {
  switch (field.kind) {
    case 'string':
    case 'image':
    case 'color':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'enum':
      return typeof value === 'string' && field.options.includes(value);
    case 'stringArray':
    case 'imageArray':
      return isStringArray(value);
    case 'dateAnyOf':
      return (
        typeof value === 'string' ||
        (typeof value === 'number' && Number.isFinite(value)) ||
        value === null
      );
    case 'unsupported':
      return false;
    default:
      return false;
  }
}

function toSkipReasonLabel(reason: SkipReason): string {
  switch (reason) {
    case 'schema_unavailable':
      return 'schema unavailable';
    case 'not_in_schema':
      return 'not in schema';
    case 'unsupported_field':
      return 'unsupported field type';
    case 'incompatible_type':
      return 'incompatible value type';
    default:
      return 'not applied';
  }
}

function buildSkipResult(params: {
  currentDraft: ObjectRecord;
  revisionFrontmatter: ObjectRecord;
  reason: SkipReason;
}): ApplyResult {
  const skippedKeys = Object.keys(params.revisionFrontmatter);
  const reasonLabel = toSkipReasonLabel(params.reason);
  const reasonBySkippedKey = Object.fromEntries(
    skippedKeys.map((key) => [key, reasonLabel]),
  );

  return {
    nextDraft: cloneRecord(params.currentDraft),
    appliedKeys: [],
    skippedKeys,
    reasonBySkippedKey,
  };
}

export function applyRevisionFrontmatter(params: {
  currentDraft: ObjectRecord;
  revisionFrontmatter: ObjectRecord;
  schema: ObjectRecord | undefined;
  fieldUi: FieldUiMap | undefined;
}): ApplyResult {
  const schemaObject = resolveAstroObjectSchema(params.schema);
  if (!schemaObject) {
    return buildSkipResult({
      currentDraft: params.currentDraft,
      revisionFrontmatter: params.revisionFrontmatter,
      reason: 'schema_unavailable',
    });
  }

  const resolvedFields = resolveSchemaFields(schemaObject, params.fieldUi);
  const allFieldKinds = new Map<string, ResolvedField>();
  const supportedFieldKinds = new Map<string, ResolvedField>();

  for (const field of resolvedFields) {
    allFieldKinds.set(field.key, field);
    if (field.kind !== 'unsupported') {
      supportedFieldKinds.set(field.key, field);
    }
  }

  const nextDraft = cloneRecord(params.currentDraft);
  const appliedKeys: string[] = [];
  const skippedKeys: string[] = [];
  const reasonBySkippedKey: Record<string, string> = {};

  for (const [key, value] of Object.entries(params.revisionFrontmatter)) {
    const field = supportedFieldKinds.get(key);
    if (!field) {
      skippedKeys.push(key);
      const skipReason = allFieldKinds.has(key)
        ? 'unsupported_field'
        : 'not_in_schema';
      reasonBySkippedKey[key] = toSkipReasonLabel(skipReason);
      continue;
    }

    if (!isCompatibleValue(field, value)) {
      skippedKeys.push(key);
      reasonBySkippedKey[key] = toSkipReasonLabel('incompatible_type');
      continue;
    }

    nextDraft[key] = Array.isArray(value)
      ? [...value]
      : value;
    appliedKeys.push(key);
  }

  return {
    nextDraft,
    appliedKeys,
    skippedKeys,
    reasonBySkippedKey,
  };
}
