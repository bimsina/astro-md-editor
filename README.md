# Astro MD Editor

[![npm version](https://img.shields.io/npm/v/astro-md-editor.svg)](https://www.npmjs.com/package/astro-md-editor)

Schema-aware editor for Astro content collections. It lets you edit frontmatter and markdown/MDX together, validates on save, and can reuse values from file Git history.

Demo video: https://www.youtube.com/watch?v=-cI6ct8yLHM

https://github.com/user-attachments/assets/7f38b6a4-fe1a-4e30-80c8-19a58aa860f1

## Quick start

```bash
npx astro-md-editor
# or
pnpm dlx astro-md-editor
```

By default, it targets the current directory.

Target a specific Astro project:

```bash
astro-md-editor /absolute/path/to/astro-project
# or
astro-md-editor --path /absolute/path/to/astro-project
```

Root resolution order:

1. positional argument (`astro-md-editor <astro-project-root>`)
2. `--path`
3. `APP_ROOT_PATH`
4. current working directory

Port can be set with `PORT` or `NITRO_PORT`.

```bash
PORT=1234 npx astro-md-editor
# or
NITRO_PORT=1234 npx astro-md-editor
```

## Requirements

- Astro project with collections under `src/content`
- Generated collection schemas in `.astro/collections/*.schema.json`

If schema files are missing, run in the target project:

```bash
astro sync
```

## Highlights

- Reads collection schemas and content files (`.md`, `.mdx`, `.markdown`)
- Renders schema-aware controls (`string`, `number`, `boolean`, `enum`, `date`, arrays)
- Validates frontmatter with AJV before saving
- Infers image fields from `src/content.config.*` (`image()` / `z.array(image())`)
- Supports image pickers for both `src` assets and `public` assets
- Shows per-file Git history and applies selected revision values to the current draft safely

## Field overrides (optional)

Create `astro-md-editor.fields.json` at the Astro project root to force specific UI controls.

```json
{
  "blog": {
    "brandColor": { "type": "color" },
    "coverAssetPath": { "type": "image", "mode": "public" },
    "menuIconFiltered": { "type": "icon", "icon_libraries": ["lucide", "mdi"] },
    "menuIconAny": { "type": "icon" }
  },
  "snippet": {
    "galleryPaths": { "type": "image", "multiple": true, "mode": "public" }
  }
}
```

Supported override types:

- `image` (`mode: "asset" | "public"`, optional `multiple: true`)
- `color`
- `icon` (optional `icon_libraries: string[]`)

Precedence: `astro-md-editor.fields.json` > inferred `image()` fields > schema defaults.

Invalid or schema-incompatible overrides are ignored with startup warnings.

## Notes

- Applying Git history updates the in-editor draft only; files are written only on normal Save
- `public` assets are saved as `/path/from/public`
- `src` assets are saved relative to the edited content file (`./...` or `../...`)
- Icon values are saved as Iconify IDs (for example `lucide:messages-square`)
- Custom controls currently target top-level frontmatter fields

## Add a custom UI handler in code

If you are extending the editor itself (not just using `astro-md-editor.fields.json`), add a new field kind in these places:

1. `src/lib/schema-form.ts`
   - Extend `FieldUiKind`, `FieldUiConfig`, and `ResolvedField`
   - Update `resolveCustomFieldKind` to map your override kind to a resolved field

2. `scripts/bootstrap-collections.mjs`
   - Extend `fieldOverrideSchema` so config accepts your new `type`
   - Update `getOverrideConfig` and `resolveSchemaCompatibilityKind`

3. `src/components/editor/RightSidebar.tsx`
   - Add your new field component
   - Render it in the `resolvedFields.map(...)` switch (`field.kind === '<yourKind>'`)

4. `src/lib/frontmatter-history-merge.ts`
   - Update `isCompatibleValue` so Git-history apply validates your new kind correctly

Quick checklist for a new kind (example: `slug`):

- add `slug` to schema/field types
- parse `type: "slug"` in bootstrap overrides
- render `<SlugField />` in `RightSidebar`
- add compatibility logic in history merge

If any part is missing, the field falls back to default/unsupported handling.
