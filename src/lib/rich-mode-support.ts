export type RichModeSupport =
  | {
      supported: true;
    }
  | {
      supported: false;
      reason: string;
    };

const IMPORT_EXPORT_PATTERN = /^\s*(import|export)\s+/;
const JSX_COMPONENT_PATTERN = /<\/?[A-Z][A-Za-z0-9._-]*(\s|>|\/>)/;
const JSX_FRAGMENT_PATTERN = /<\s*\/?\s*>/;
const MDX_EXPRESSION_PATTERN = /^\s*\{[\s\S]*\}\s*$/;
const CODE_FENCE_PATTERN = /^\s*(```|~~~)/;

function isCodeFenceLine(line: string): boolean {
  return CODE_FENCE_PATTERN.test(line);
}

function hasImportOrExport(line: string): boolean {
  return IMPORT_EXPORT_PATTERN.test(line);
}

function hasJsxSyntax(line: string): boolean {
  return JSX_COMPONENT_PATTERN.test(line) || JSX_FRAGMENT_PATTERN.test(line);
}

function hasStandaloneMdxExpression(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length < 2) {
    return false;
  }

  if (hasJsxSyntax(trimmed)) {
    return false;
  }

  return MDX_EXPRESSION_PATTERN.test(trimmed);
}

export function getRichModeSupport(content: string): RichModeSupport {
  const lines = content.split(/\r?\n/);
  let inCodeFence = false;

  for (const line of lines) {
    if (isCodeFenceLine(line)) {
      inCodeFence = !inCodeFence;
      continue;
    }

    if (inCodeFence) {
      continue;
    }

    if (hasImportOrExport(line)) {
      return {
        supported: false,
        reason: 'contains MDX import/export statements',
      };
    }

    if (hasJsxSyntax(line)) {
      return {
        supported: false,
        reason: 'contains JSX component syntax',
      };
    }

    if (hasStandaloneMdxExpression(line)) {
      return {
        supported: false,
        reason: 'contains standalone MDX expressions',
      };
    }
  }

  return {
    supported: true,
  };
}
