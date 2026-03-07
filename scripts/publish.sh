#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

PUBLISH=0
STRICT=0
TAG=""

usage() {
  cat <<'EOF'
Usage: ./scripts/publish.sh [--publish] [--strict] [--tag <tag>]

  --publish    actually run npm publish (default is dry-run only)
  --strict     also run lint/test/typecheck gates
  --tag <tag>  publish with npm dist-tag (e.g. next)
EOF
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Missing command: $1" >&2
    exit 1
  }
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --publish)
      PUBLISH=1
      ;;
    --strict)
      STRICT=1
      ;;
    --tag)
      [[ $# -ge 2 ]] || {
        echo "Missing value for --tag" >&2
        exit 1
      }
      TAG="$2"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown arg: $1" >&2
      usage
      exit 1
      ;;
  esac
  shift
done

require_cmd node
require_cmd npm
require_cmd pnpm

node --input-type=module <<'EOF'
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const failures = [];

if (pkg.name !== 'astro-md-editor') failures.push('package name must be "astro-md-editor".');
if (pkg.private === true) failures.push('"private" must be removed or false.');
if (!pkg.version || typeof pkg.version !== 'string') failures.push('"version" is required.');
if (!pkg.bin || pkg.bin['astro-md-editor'] !== './index.mjs') {
  failures.push('"bin.astro-md-editor" must point to "./index.mjs".');
}
if (!Array.isArray(pkg.files)) failures.push('"files" whitelist is required.');
if (Array.isArray(pkg.files)) {
  const requiredPrefixes = ['.output/', 'index.mjs', 'scripts/bootstrap-collections.mjs'];
  for (const req of requiredPrefixes) {
    if (!pkg.files.some((entry) => entry === req || entry.startsWith(req))) {
      failures.push(`"files" should include "${req}"`);
    }
  }
}

if (failures.length > 0) {
  console.error('Prepublish metadata checks failed:');
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
EOF

if ! head -n1 index.mjs | grep -q '^#!/usr/bin/env node'; then
  echo 'index.mjs is missing shebang "#!/usr/bin/env node".' >&2
  exit 1
fi

if ! npm whoami >/dev/null 2>&1; then
  echo "Not logged into npm. Run: npm login" >&2
  exit 1
fi

echo "Running build..."
pnpm build

if [[ "$STRICT" -eq 1 ]]; then
  echo "Running strict checks..."
  pnpm lint
  pnpm exec vitest run --passWithNoTests
  pnpm exec tsc --noEmit
fi

echo "Running npm pack dry-run..."
PACK_JSON="$(npm pack --dry-run --json)"
echo "$PACK_JSON"

PACK_JSON="$PACK_JSON" node --input-type=module <<'EOF'
const parsed = JSON.parse(process.env.PACK_JSON ?? '[]');
const files = parsed?.[0]?.files?.map((f) => f.path) ?? [];

const required = [
  'index.mjs',
  'scripts/bootstrap-collections.mjs',
  '.output/server/index.mjs'
];
const missing = required.filter((f) => !files.includes(f));

if (missing.length > 0) {
  console.error('Packaged tarball is missing required files:');
  for (const m of missing) console.error(`- ${m}`);
  process.exit(1);
}
EOF

if [[ "$PUBLISH" -eq 0 ]]; then
  echo "Dry-run complete. Re-run with --publish to publish."
  exit 0
fi

PUBLISH_CMD=(npm publish --access public)
if [[ -n "$TAG" ]]; then
  PUBLISH_CMD+=(--tag "$TAG")
fi

echo "Publishing: ${PUBLISH_CMD[*]}"
"${PUBLISH_CMD[@]}"
echo "Published successfully."
