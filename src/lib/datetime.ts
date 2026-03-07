function padTwo(value: number): string {
  return value.toString().padStart(2, '0');
}

function toDateTimeLocal(date: Date): string {
  const year = date.getFullYear();
  const month = padTwo(date.getMonth() + 1);
  const day = padTwo(date.getDate());
  const hour = padTwo(date.getHours());
  const minute = padTwo(date.getMinutes());

  return `${year}-${month}-${day}T${hour}:${minute}`;
}

function parseUnixTimestamp(value: number): Date | undefined {
  if (!Number.isFinite(value)) {
    return undefined;
  }

  const millis = Math.abs(value) < 1_000_000_000_000 ? value * 1000 : value;
  const parsed = new Date(millis);

  if (Number.isNaN(parsed.getTime())) {
    return undefined;
  }

  return parsed;
}

export function toDateTimeLocalValue(value: unknown): string {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      return '';
    }

    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      return `${trimmed}T00:00`;
    }

    const parsed = new Date(trimmed);
    if (!Number.isNaN(parsed.getTime())) {
      return toDateTimeLocal(parsed);
    }

    return '';
  }

  if (typeof value === 'number') {
    const parsed = parseUnixTimestamp(value);
    return parsed ? toDateTimeLocal(parsed) : '';
  }

  return '';
}

export function fromDateTimeLocalToIso(value: string): string | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return undefined;
  }

  return parsed.toISOString();
}
