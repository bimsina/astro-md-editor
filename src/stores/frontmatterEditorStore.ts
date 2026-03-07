import { create } from 'zustand';
import { getRichModeSupport } from '#/lib/rich-mode-support';

type ObjectRecord = Record<string, unknown>;
export type EditorMode = 'basic' | 'rich';
export type RichModeAvailability = 'supported' | 'blocked';

type SelectionIdentity = {
  collectionName?: string;
  fileId?: string;
};

type FrontmatterEditorState = SelectionIdentity & {
  draft: ObjectRecord;
  initial: ObjectRecord;
  contentDraft: string;
  initialContent: string;
  editorMode: EditorMode;
  richModeAvailability: RichModeAvailability;
  richModeBlockReason?: string;
  dirty: boolean;
  touched: Record<string, boolean>;
  errors: Partial<Record<string, string[]>>;
  chipInputs: Record<string, string>;
  validationRequested: boolean;
  loadSelection: (
    selection: SelectionIdentity & {
      data: ObjectRecord;
      content: string;
    },
  ) => void;
  clearSelection: () => void;
  setFieldValue: (field: string, value: unknown) => void;
  setContentDraft: (content: string) => void;
  setEditorMode: (mode: EditorMode) => void;
  commitSavedState: () => void;
  setFieldTouched: (field: string) => void;
  setValidationRequested: () => void;
  setValidationErrors: (errors: Partial<Record<string, string[]>>) => void;
  setChipInput: (field: string, value: string) => void;
  addChipValue: (field: string, value: string) => void;
  removeChipValue: (field: string, index: number) => void;
  removeLastChipValue: (field: string) => void;
};

function isRecord(value: unknown): value is ObjectRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cloneRecord<T extends ObjectRecord>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isEqualValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) {
    return true;
  }

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) {
      return false;
    }

    for (let index = 0; index < a.length; index += 1) {
      if (!isEqualValue(a[index], b[index])) {
        return false;
      }
    }

    return true;
  }

  if (isRecord(a) && isRecord(b)) {
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);

    if (aKeys.length !== bKeys.length) {
      return false;
    }

    for (const key of aKeys) {
      if (!Object.prototype.hasOwnProperty.call(b, key)) {
        return false;
      }

      if (!isEqualValue(a[key], b[key])) {
        return false;
      }
    }

    return true;
  }

  return false;
}

function normalizeChip(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === 'string');
}

function buildNextDraft(
  currentDraft: ObjectRecord,
  field: string,
  value: unknown,
): ObjectRecord {
  const nextDraft = {
    ...currentDraft,
  };

  if (value === undefined) {
    delete nextDraft[field];
  } else {
    nextDraft[field] = value;
  }

  return nextDraft;
}

function getIsDirty(params: {
  draft: ObjectRecord;
  initial: ObjectRecord;
  contentDraft: string;
  initialContent: string;
}): boolean {
  if (!isEqualValue(params.draft, params.initial)) {
    return true;
  }

  return params.contentDraft !== params.initialContent;
}

function getRichModeState(content: string): {
  richModeAvailability: RichModeAvailability;
  richModeBlockReason?: string;
} {
  const support = getRichModeSupport(content);
  if (support.supported) {
    return {
      richModeAvailability: 'supported',
      richModeBlockReason: undefined,
    };
  }

  return {
    richModeAvailability: 'blocked',
    richModeBlockReason: support.reason,
  };
}

export const useFrontmatterEditorStore = create<FrontmatterEditorState>(
  (set) => ({
    collectionName: undefined,
    fileId: undefined,
    draft: {},
    initial: {},
    contentDraft: '',
    initialContent: '',
    editorMode: 'basic',
    richModeAvailability: 'supported',
    richModeBlockReason: undefined,
    dirty: false,
    touched: {},
    errors: {},
    chipInputs: {},
    validationRequested: false,
    loadSelection: ({ collectionName, fileId, data, content }) =>
      set((state) => {
        const sameSelection =
          state.collectionName === collectionName && state.fileId === fileId;
        if (sameSelection) {
          return state;
        }

        const normalizedData = cloneRecord(data);
        const richModeState = getRichModeState(content);
        return {
          collectionName,
          fileId,
          draft: normalizedData,
          initial: cloneRecord(normalizedData),
          contentDraft: content,
          initialContent: content,
          editorMode:
            richModeState.richModeAvailability === 'blocked'
              ? 'basic'
              : state.editorMode,
          ...richModeState,
          dirty: false,
          touched: {},
          errors: {},
          chipInputs: {},
          validationRequested: false,
        };
      }),
    clearSelection: () =>
      set({
        collectionName: undefined,
        fileId: undefined,
        draft: {},
        initial: {},
        contentDraft: '',
        initialContent: '',
        richModeAvailability: 'supported',
        richModeBlockReason: undefined,
        dirty: false,
        touched: {},
        errors: {},
        chipInputs: {},
        validationRequested: false,
      }),
    setFieldValue: (field, value) =>
      set((state) => {
        const nextDraft = buildNextDraft(state.draft, field, value);
        return {
          draft: nextDraft,
          dirty: getIsDirty({
            draft: nextDraft,
            initial: state.initial,
            contentDraft: state.contentDraft,
            initialContent: state.initialContent,
          }),
        };
      }),
    setContentDraft: (content) =>
      set((state) => ({
        ...(() => {
          const richModeState = getRichModeState(content);
          return {
            ...richModeState,
            editorMode:
              richModeState.richModeAvailability === 'blocked'
                ? 'basic'
                : state.editorMode,
          };
        })(),
        contentDraft: content,
        dirty: getIsDirty({
          draft: state.draft,
          initial: state.initial,
          contentDraft: content,
          initialContent: state.initialContent,
        }),
      })),
    setEditorMode: (mode) =>
      set((state) => {
        if (mode === 'rich' && state.richModeAvailability === 'blocked') {
          return state;
        }

        if (state.editorMode === mode) {
          return state;
        }

        return {
          editorMode: mode,
        };
      }),
    commitSavedState: () =>
      set((state) => ({
        initial: cloneRecord(state.draft),
        initialContent: state.contentDraft,
        dirty: false,
        touched: {},
        errors: {},
        validationRequested: false,
      })),
    setFieldTouched: (field) =>
      set((state) => ({
        touched: {
          ...state.touched,
          [field]: true,
        },
      })),
    setValidationRequested: () =>
      set({
        validationRequested: true,
      }),
    setValidationErrors: (errors) =>
      set({
        errors,
      }),
    setChipInput: (field, value) =>
      set((state) => ({
        chipInputs: {
          ...state.chipInputs,
          [field]: value,
        },
      })),
    addChipValue: (field, value) =>
      set((state) => {
        const normalizedValue = normalizeChip(value);
        if (!normalizedValue) {
          return state;
        }

        const existingValues = asStringArray(state.draft[field]);
        if (existingValues.includes(normalizedValue)) {
          return {
            chipInputs: {
              ...state.chipInputs,
              [field]: '',
            },
          };
        }

        const nextValues = [...existingValues, normalizedValue];
        const nextDraft = buildNextDraft(state.draft, field, nextValues);

        return {
          draft: nextDraft,
          dirty: getIsDirty({
            draft: nextDraft,
            initial: state.initial,
            contentDraft: state.contentDraft,
            initialContent: state.initialContent,
          }),
          chipInputs: {
            ...state.chipInputs,
            [field]: '',
          },
        };
      }),
    removeChipValue: (field, index) =>
      set((state) => {
        const existingValues = asStringArray(state.draft[field]);
        if (index < 0 || index >= existingValues.length) {
          return state;
        }

        const nextValues = existingValues.filter((_, itemIndex) => {
          return itemIndex !== index;
        });
        const nextDraft = buildNextDraft(
          state.draft,
          field,
          nextValues.length > 0 ? nextValues : undefined,
        );

        return {
          draft: nextDraft,
          dirty: getIsDirty({
            draft: nextDraft,
            initial: state.initial,
            contentDraft: state.contentDraft,
            initialContent: state.initialContent,
          }),
        };
      }),
    removeLastChipValue: (field) =>
      set((state) => {
        const existingValues = asStringArray(state.draft[field]);
        if (existingValues.length === 0) {
          return state;
        }

        const nextValues = existingValues.slice(0, -1);
        const nextDraft = buildNextDraft(
          state.draft,
          field,
          nextValues.length > 0 ? nextValues : undefined,
        );

        return {
          draft: nextDraft,
          dirty: getIsDirty({
            draft: nextDraft,
            initial: state.initial,
            contentDraft: state.contentDraft,
            initialContent: state.initialContent,
          }),
        };
      }),
  }),
);

export type { FrontmatterEditorState };
