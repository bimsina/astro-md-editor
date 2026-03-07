# Astro MD Editor

Astro MD Editor is a schema-aware frontend for editing Astro markdown content collections.

It loads an Astro project's generated collection schemas, provides structured frontmatter editing plus markdown content writing, validates drafts with AJV, and writes updates back to source files.

## What the app does

- Reads collection schemas from `.astro/collections/*.schema.json`.
- Builds entry lists by scanning `src/content/<collection>/**/*.{md,mdx,markdown}`.
- Builds an editor UI from schema fields (`string`, `number`, `boolean`, `enum`, `date`, arrays).
- Supports writing and updating markdown/MDX body content in the same editor flow.
- Supports image-focused controls:
  - native `image()` and `z.array(image())` inference from `src/content.config.*`
  - image asset picker from both `src` and `public`
- Supports custom field controls through override config (currently `image` and `color`).
- Validates frontmatter edits with AJV before save and persists both frontmatter + body updates.

## Local development

```bash
pnpm dev
```

Path resolution order:

1. `--path=<astro-project-root>` CLI argument
2. `APP_ROOT_PATH` environment variable
3. fallback to `example-blog` in this repository

So if you do not pass `--path` and do not set `APP_ROOT_PATH`, local dev opens `example-blog` by default.

If no schema files are present in `.astro/collections` during dev startup, the launcher runs `astro sync` in the selected Astro project and then continues with schema + content-directory discovery.

## Example project

`example-blog` is included as a sample Astro project for editor development.

It contains multiple collections with mixed field types:

- `blog`
- `project`
- `snippet`

and includes content entries using dates, enums, booleans, arrays, `image()`, `z.array(image())`, and override-driven fields.

## Custom field overrides

Add an `astro-md-editor.fields.json` file at the target Astro project root.

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

- `type` supports: `image`, `color`
- for `type: "image"`, optional `mode` supports:
  - `asset` (default): use `src` assets only (`./` / `../` paths)
  - `public`: use `public` assets only (`/path` values)
- optional `multiple: true` enables array-style image UX
- top-level shape is `{ [collectionName]: { [fieldName]: override } }`

Precedence:

1. overrides from `astro-md-editor.fields.json`
2. inferred `image()`/`array(image())` from content config
3. fallback schema-based type rendering

Invalid or incompatible overrides are ignored with bootstrap warnings.

## Notes

- Public assets are inserted as `/path/from/public`.
- Source assets are inserted as explicit relative paths from the content file (`./...` or `../...`).
- Current custom controls target top-level frontmatter fields.
