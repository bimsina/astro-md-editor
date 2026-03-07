import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import {
  applyCollectionsEnv,
  bootstrapCollections,
} from './bootstrap-collections.mjs';

function runViteDev(args) {
  return new Promise((resolveExitCode, reject) => {
    const viteBin = resolve(process.cwd(), 'node_modules/vite/bin/vite.js');
    const child = spawn(process.execPath, [viteBin, 'dev', ...args], {
      stdio: 'inherit',
      env: process.env,
    });

    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (signal) {
        resolveExitCode(1);
        return;
      }

      resolveExitCode(code ?? 0);
    });
  });
}

async function main() {
  const bootstrapResult = await bootstrapCollections(process.argv.slice(2), {
    mode: 'development',
  });
  applyCollectionsEnv(process.env, bootstrapResult);

  const exitCode = await runViteDev(bootstrapResult.forwardArgs);
  process.exit(exitCode);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[startup] ${message}`);
  process.exit(1);
});
