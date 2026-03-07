#!/usr/bin/env node

import {
  applyCollectionsEnv,
  bootstrapCollections,
} from './scripts/bootstrap-collections.mjs';

async function main() {
  const bootstrapResult = await bootstrapCollections(process.argv.slice(2), {
    mode: 'production',
  });
  applyCollectionsEnv(process.env, bootstrapResult);

  await import('./.output/server/index.mjs');
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[startup] ${message}`);
  process.exit(1);
});
