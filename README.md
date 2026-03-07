# Astro MD Editor
[![npm version](https://img.shields.io/npm/v/astro-md-editor.svg)](https://www.npmjs.com/package/astro-md-editor)

Editor UI for Astro content collections (`src/content`) with schema-aware frontmatter editing and markdown body editing.

## Run

```bash
npx astro-md-editor
```

```bash
pnpm dlx astro-md-editor
# or
pnpx astro-md-editor
```

### Target project path

```bash
# positional
npx astro-md-editor /absolute/path/to/astro-project

# flag
npx astro-md-editor --path /absolute/path/to/astro-project
```

Path resolution order:

1. positional CLI arg (`astro-md-editor <astro-project-root>`)
2. `--path=<astro-project-root>`
3. `APP_ROOT_PATH`
4. current working directory

### Port

```bash
PORT=1234 npx astro-md-editor
# or
NITRO_PORT=1234 npx astro-md-editor
```

The runtime reads `PORT`/`NITRO_PORT` for server port.

## Requirements

- Astro project with collections in `src/content`.
- Collection schemas available in `.astro/collections/*.schema.json`.

If schema files are missing, run:

```bash
astro sync
```

## Features

- Reads `.astro/collections/*.schema.json`.
- Scans `src/content/<collection>/**/*.{md,mdx,markdown}`.
- Renders controls for schema fields (`string`, `number`, `boolean`, `enum`, `date`, arrays).
- Edits frontmatter and markdown/MDX body in one flow.
- Validates frontmatter with AJV before save.
- Supports image field inference from `src/content.config.*` (`image()`, `z.array(image())`).
- Supports image pickers for both `src` assets and `public` assets.

## Local development

```bash
pnpm dev
```

`pnpm dev` uses `--path example-blog --port 3000`.

Run dev against another project:

```bash
node scripts/dev.mjs /absolute/path/to/astro-project --port 3000
```

In dev mode, if schema files are missing, startup runs `astro sync` automatically for the selected project.

## Field overrides

Create `astro-md-editor.fields.json` at the Astro project root.

Example:

```json
{
  "blog": {
    "brandColor": { "type": "color" },
    "coverAssetPath": { "type": "image", "mode": "public" }
  },
  "snippet": {
    "galleryPaths": { "type": "image", "multiple": true, "mode": "public" }
  }
}
```

Rules:

- `type`: `image` or `color`
- for `type: "image"`, optional `mode`: `asset` (default) or `public`
- for `type: "image"`, optional `multiple: true` for array-style image input
- shape: `{ [collectionName]: { [fieldName]: override } }`

Precedence:

1. `astro-md-editor.fields.json` overrides
2. inferred `image()` / `array(image())` from content config
3. schema-based fallback rendering

Invalid or incompatible overrides are ignored with bootstrap warnings.

## Notes

- `public` assets are saved as `/path/from/public`.
- `src` assets are saved as relative paths from the content file (`./...` or `../...`).
- Custom controls currently target top-level frontmatter fields.
