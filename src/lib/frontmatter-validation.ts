import Ajv, { type ErrorObject, type ValidateFunction } from 'ajv';
import addFormats from 'ajv-formats';

type ObjectRecord = Record<string, unknown>;

export const ROOT_VALIDATION_KEY = '_root';

export type ValidationErrors = Partial<Record<string, string[]>>;

type ValidationResult = {
  valid: boolean;
  errors: ValidationErrors;
};

const ajv = new Ajv({
  allErrors: true,
  strict: false,
});

addFormats(ajv);

const validatorCache = new WeakMap<ObjectRecord, ValidateFunction>();

function getSchemaValidator(schema: ObjectRecord): ValidateFunction {
  const cached = validatorCache.get(schema);
  if (cached) {
    return cached;
  }

  const validator = ajv.compile(schema);
  validatorCache.set(schema, validator);
  return validator;
}

function decodePointerSegment(segment: string): string {
  return segment.replaceAll('~1', '/').replaceAll('~0', '~');
}

function getTopLevelErrorKey(error: ErrorObject): string {
  if (error.keyword === 'required') {
    const missingProperty =
      typeof error.params.missingProperty === 'string'
        ? error.params.missingProperty
        : undefined;

    return missingProperty ?? ROOT_VALIDATION_KEY;
  }

  const cleanedPath = error.instancePath.replace(/^\//, '');
  if (cleanedPath.length === 0) {
    return ROOT_VALIDATION_KEY;
  }

  const firstSegment = cleanedPath.split('/')[0];
  return firstSegment
    ? decodePointerSegment(firstSegment)
    : ROOT_VALIDATION_KEY;
}

function toErrorMessage(error: ErrorObject): string {
  const message = error.message?.trim();
  return message && message.length > 0 ? message : 'invalid value';
}

function mapAjvErrors(
  errors: ErrorObject[] | null | undefined,
): ValidationErrors {
  if (!errors || errors.length === 0) {
    return {};
  }

  const mapped: ValidationErrors = {};

  for (const error of errors) {
    const key = getTopLevelErrorKey(error);
    const message = toErrorMessage(error);
    const existing = mapped[key] ?? [];

    if (!existing.includes(message)) {
      mapped[key] = [...existing, message];
    }
  }

  return mapped;
}

export function validateFrontmatterDraft(
  schema: ObjectRecord,
  draft: ObjectRecord,
): ValidationResult {
  const validator = getSchemaValidator(schema);
  const valid = validator(draft);

  return {
    valid: Boolean(valid),
    errors: mapAjvErrors(validator.errors),
  };
}
