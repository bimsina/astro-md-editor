type ObjectRecord = Record<string, unknown>;

type JsonObjectSchema = {
  type: 'object';
  properties: ObjectRecord;
  required?: unknown;
};

export type ResolvedField =
  | { kind: 'string'; key: string; required: boolean }
  | { kind: 'number'; key: string; required: boolean }
  | { kind: 'boolean'; key: string; required: boolean }
  | { kind: 'enum'; key: string; required: boolean; options: string[] }
  | { kind: 'stringArray'; key: string; required: boolean }
  | { kind: 'dateAnyOf'; key: string; required: boolean }
  | { kind: 'unsupported'; key: string; required: boolean; reason: string };

const ASTRO_DEF_PREFIX = '#/definitions/';

function asRecord(value: unknown): ObjectRecord | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined;
  }

  return value as ObjectRecord;
}

function asStringArray(value: unknown): string[] | undefined {
  if (
    !Array.isArray(value) ||
    !value.every((item) => typeof item === 'string')
  ) {
    return undefined;
  }

  return value;
}

function asObjectSchema(value: unknown): JsonObjectSchema | undefined {
  const record = asRecord(value);
  if (!record || record.type !== 'object') {
    return undefined;
  }

  const properties = asRecord(record.properties);
  if (!properties) {
    return undefined;
  }

  return {
    type: 'object',
    properties,
    required: record.required,
  };
}

function isDateAnyOfSchema(schema: ObjectRecord): boolean {
  if (!Array.isArray(schema.anyOf) || schema.anyOf.length === 0) {
    return false;
  }

  let hasDateOption = false;

  for (const option of schema.anyOf) {
    const candidate = asRecord(option);
    if (!candidate) {
      return false;
    }

    const candidateType = candidate.type;
    const candidateFormat = candidate.format;

    if (
      candidateType === 'string' &&
      (candidateFormat === 'date' || candidateFormat === 'date-time')
    ) {
      hasDateOption = true;
      continue;
    }

    if (
      (candidateType === 'integer' || candidateType === 'number') &&
      candidateFormat === 'unix-time'
    ) {
      hasDateOption = true;
      continue;
    }

    if (candidateType === 'null') {
      continue;
    }

    return false;
  }

  return hasDateOption;
}

function resolveRequiredFields(required: unknown): Set<string> {
  const requiredList = asStringArray(required) ?? [];
  return new Set(requiredList);
}

export function resolveAstroObjectSchema(
  schema: ObjectRecord | undefined,
): JsonObjectSchema | undefined {
  if (!schema) {
    return undefined;
  }

  const direct = asObjectSchema(schema);
  if (direct) {
    return direct;
  }

  const ref = typeof schema.$ref === 'string' ? schema.$ref : undefined;
  if (!ref?.startsWith(ASTRO_DEF_PREFIX)) {
    return undefined;
  }

  const definitionKey = ref.slice(ASTRO_DEF_PREFIX.length);
  const definitions = asRecord(schema.definitions);
  const definitionSchema = definitions ? definitions[definitionKey] : undefined;

  return asObjectSchema(definitionSchema);
}

export function resolveSchemaFields(schema: JsonObjectSchema): ResolvedField[] {
  const requiredFields = resolveRequiredFields(schema.required);
  const fields: ResolvedField[] = [];

  for (const [key, rawPropertySchema] of Object.entries(schema.properties)) {
    if (key === '$schema') {
      continue;
    }

    const propertySchema = asRecord(rawPropertySchema);
    const isRequired = requiredFields.has(key);

    if (!propertySchema) {
      fields.push({
        kind: 'unsupported',
        key,
        required: isRequired,
        reason: 'invalid schema node',
      });
      continue;
    }

    if (isDateAnyOfSchema(propertySchema)) {
      fields.push({ kind: 'dateAnyOf', key, required: isRequired });
      continue;
    }

    if (
      propertySchema.type === 'string' &&
      (propertySchema.format === 'date' ||
        propertySchema.format === 'date-time')
    ) {
      fields.push({ kind: 'dateAnyOf', key, required: isRequired });
      continue;
    }

    if (
      (propertySchema.type === 'number' || propertySchema.type === 'integer') &&
      propertySchema.format === 'unix-time'
    ) {
      fields.push({ kind: 'dateAnyOf', key, required: isRequired });
      continue;
    }

    const enumValues = asStringArray(propertySchema.enum);
    if (enumValues && enumValues.length > 0) {
      fields.push({
        kind: 'enum',
        key,
        required: isRequired,
        options: enumValues,
      });
      continue;
    }

    if (propertySchema.type === 'string') {
      fields.push({ kind: 'string', key, required: isRequired });
      continue;
    }

    if (propertySchema.type === 'boolean') {
      fields.push({ kind: 'boolean', key, required: isRequired });
      continue;
    }

    if (propertySchema.type === 'number' || propertySchema.type === 'integer') {
      fields.push({ kind: 'number', key, required: isRequired });
      continue;
    }

    if (propertySchema.type === 'array') {
      const itemSchema = asRecord(propertySchema.items);
      if (itemSchema?.type === 'string') {
        fields.push({ kind: 'stringArray', key, required: isRequired });
      } else {
        fields.push({
          kind: 'unsupported',
          key,
          required: isRequired,
          reason: 'array items are not string',
        });
      }
      continue;
    }

    fields.push({
      kind: 'unsupported',
      key,
      required: isRequired,
      reason: 'schema type not supported',
    });
  }

  return fields;
}
