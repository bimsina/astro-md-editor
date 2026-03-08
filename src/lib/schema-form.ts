import { z } from 'zod';

type ObjectRecord = Record<string, unknown>;

const recordSchema = z.record(z.string(), z.unknown());
const jsonObjectSchema = z
  .object({
    type: z.literal('object'),
    properties: recordSchema,
    required: z.array(z.string()).optional(),
  })
  .passthrough();
const propertySchema = z
  .object({
    type: z.string().optional(),
    format: z.string().optional(),
    enum: z.array(z.string()).optional(),
    anyOf: z.array(recordSchema).optional(),
    items: recordSchema.optional(),
  })
  .passthrough();

type JsonObjectSchema = z.infer<typeof jsonObjectSchema>;
type JsonPropertySchema = z.infer<typeof propertySchema>;

export type FieldUiKind = 'image' | 'imageArray' | 'color' | 'icon';
export type ImageFieldSourceMode = 'asset' | 'public';
export type FieldUiConfig =
  | {
      kind: 'image' | 'imageArray';
      mode: ImageFieldSourceMode;
    }
  | {
      kind: 'color';
    }
  | {
      kind: 'icon';
      iconLibraries?: string[];
    };
export type FieldUiMap = Record<string, FieldUiConfig>;

export type ResolvedField =
  | { kind: 'string'; key: string; required: boolean }
  | { kind: 'number'; key: string; required: boolean }
  | { kind: 'boolean'; key: string; required: boolean }
  | { kind: 'enum'; key: string; required: boolean; options: string[] }
  | { kind: 'stringArray'; key: string; required: boolean }
  | {
      kind: 'image';
      key: string;
      required: boolean;
      sourceMode: ImageFieldSourceMode;
    }
  | {
      kind: 'imageArray';
      key: string;
      required: boolean;
      sourceMode: ImageFieldSourceMode;
    }
  | { kind: 'color'; key: string; required: boolean }
  | {
      kind: 'icon';
      key: string;
      required: boolean;
      iconLibraries?: string[];
    }
  | { kind: 'dateAnyOf'; key: string; required: boolean }
  | { kind: 'unsupported'; key: string; required: boolean; reason: string };

const ASTRO_DEF_PREFIX = '#/definitions/';

function asRecord(value: unknown): ObjectRecord | undefined {
  const parsed = recordSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

function parsePropertySchema(value: unknown): JsonPropertySchema | undefined {
  const parsed = propertySchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

function asObjectSchema(value: unknown): JsonObjectSchema | undefined {
  const parsed = jsonObjectSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

function isStringArraySchema(schema: JsonPropertySchema): boolean {
  if (schema.type !== 'array') {
    return false;
  }

  const itemSchema = parsePropertySchema(schema.items);
  return itemSchema?.type === 'string';
}

function isDateAnyOfSchema(schema: JsonPropertySchema): boolean {
  if (!schema.anyOf || schema.anyOf.length === 0) {
    return false;
  }

  let hasDateOption = false;

  for (const option of schema.anyOf) {
    const candidate = parsePropertySchema(option);
    if (!candidate) {
      return false;
    }

    if (
      candidate.type === 'string' &&
      (candidate.format === 'date' || candidate.format === 'date-time')
    ) {
      hasDateOption = true;
      continue;
    }

    if (
      (candidate.type === 'integer' || candidate.type === 'number') &&
      candidate.format === 'unix-time'
    ) {
      hasDateOption = true;
      continue;
    }

    if (candidate.type === 'null') {
      continue;
    }

    return false;
  }

  return hasDateOption;
}

function resolveRequiredFields(required: unknown): Set<string> {
  const parsed = z.array(z.string()).safeParse(required);
  return new Set(parsed.success ? parsed.data : []);
}

function resolveCustomFieldKind(params: {
  key: string;
  property: JsonPropertySchema;
  required: boolean;
  fieldUi: FieldUiMap | undefined;
}): ResolvedField | undefined {
  const customKind = params.fieldUi?.[params.key];
  if (!customKind) {
    return undefined;
  }

  if (customKind.kind === 'image' && params.property.type === 'string') {
    return {
      kind: 'image',
      key: params.key,
      required: params.required,
      sourceMode: customKind.mode,
    };
  }

  if (
    customKind.kind === 'imageArray' &&
    isStringArraySchema(params.property)
  ) {
    return {
      kind: 'imageArray',
      key: params.key,
      required: params.required,
      sourceMode: customKind.mode,
    };
  }

  if (customKind.kind === 'color' && params.property.type === 'string') {
    return {
      kind: 'color',
      key: params.key,
      required: params.required,
    };
  }

  if (customKind.kind === 'icon' && params.property.type === 'string') {
    return {
      kind: 'icon',
      key: params.key,
      required: params.required,
      iconLibraries: customKind.iconLibraries,
    };
  }

  return undefined;
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

export function resolveSchemaFields(
  schema: JsonObjectSchema,
  fieldUi?: FieldUiMap,
): ResolvedField[] {
  const requiredFields = resolveRequiredFields(schema.required);
  const fields: ResolvedField[] = [];

  for (const [key, rawPropertySchema] of Object.entries(schema.properties)) {
    if (key === '$schema') {
      continue;
    }

    const parsedProperty = parsePropertySchema(rawPropertySchema);
    const isRequired = requiredFields.has(key);

    if (!parsedProperty) {
      fields.push({
        kind: 'unsupported',
        key,
        required: isRequired,
        reason: 'invalid schema node',
      });
      continue;
    }

    const customField = resolveCustomFieldKind({
      key,
      property: parsedProperty,
      required: isRequired,
      fieldUi,
    });
    if (customField) {
      fields.push(customField);
      continue;
    }

    if (isDateAnyOfSchema(parsedProperty)) {
      fields.push({ kind: 'dateAnyOf', key, required: isRequired });
      continue;
    }

    if (
      parsedProperty.type === 'string' &&
      (parsedProperty.format === 'date' ||
        parsedProperty.format === 'date-time')
    ) {
      fields.push({ kind: 'dateAnyOf', key, required: isRequired });
      continue;
    }

    if (
      (parsedProperty.type === 'number' || parsedProperty.type === 'integer') &&
      parsedProperty.format === 'unix-time'
    ) {
      fields.push({ kind: 'dateAnyOf', key, required: isRequired });
      continue;
    }

    const enumValues = parsedProperty.enum;
    if (enumValues && enumValues.length > 0) {
      fields.push({
        kind: 'enum',
        key,
        required: isRequired,
        options: enumValues,
      });
      continue;
    }

    if (parsedProperty.type === 'string') {
      fields.push({ kind: 'string', key, required: isRequired });
      continue;
    }

    if (parsedProperty.type === 'boolean') {
      fields.push({ kind: 'boolean', key, required: isRequired });
      continue;
    }

    if (parsedProperty.type === 'number' || parsedProperty.type === 'integer') {
      fields.push({ kind: 'number', key, required: isRequired });
      continue;
    }

    if (isStringArraySchema(parsedProperty)) {
      fields.push({ kind: 'stringArray', key, required: isRequired });
      continue;
    }

    if (parsedProperty.type === 'array') {
      fields.push({
        kind: 'unsupported',
        key,
        required: isRequired,
        reason: 'array items are not string',
      });
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
