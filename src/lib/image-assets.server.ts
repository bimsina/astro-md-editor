import { readdir, readFile } from 'node:fs/promises';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { getCollectionsRootPath } from '#/lib/collections.server';

type ImageSource = 'src' | 'public';
export type ImageAssetSourceMode = 'asset' | 'public';

type IndexedImageAsset = {
  id: string;
  source: ImageSource;
  absolutePath: string;
  sourceRelativePath: string;
  mimeType: string;
};

export type ImageAssetOption = {
  id: string;
  source: ImageSource;
  displayPath: string;
  value: string;
};

const IMAGE_MIME_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
};

let cachedRootDir: string | undefined;
let cachedAssets: IndexedImageAsset[] | undefined;
let cachedAssetsById: Map<string, IndexedImageAsset> | undefined;

function toPosix(pathLike: string): string {
  return pathLike.replaceAll('\\', '/');
}

function toRelativePath(fromPath: string, toPath: string): string {
  const rawRelative = toPosix(relative(fromPath, toPath));
  if (rawRelative.length === 0) {
    return './';
  }

  return rawRelative.startsWith('.') ? rawRelative : `./${rawRelative}`;
}

function getMimeType(fileName: string): string | undefined {
  const extension = extname(fileName).toLowerCase();
  return IMAGE_MIME_TYPES[extension];
}

function assertPathWithinRoot(rootDir: string, absolutePath: string): void {
  const relativePath = toPosix(relative(rootDir, absolutePath));
  if (
    relativePath.length === 0 ||
    relativePath.startsWith('..') ||
    relativePath.includes('/../')
  ) {
    throw new Error('Image path is outside the project root.');
  }
}

async function collectImageAssetsForSource(params: {
  rootDir: string;
  source: ImageSource;
}): Promise<IndexedImageAsset[]> {
  const sourceRoot = resolve(params.rootDir, params.source);

  async function walkDirectory(dirPath: string): Promise<IndexedImageAsset[]> {
    let entries;
    try {
      entries = await readdir(dirPath, {
        withFileTypes: true,
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      throw error;
    }

    const assets: IndexedImageAsset[] = [];
    for (const entry of entries) {
      const absolutePath = join(dirPath, entry.name);
      if (entry.isDirectory()) {
        assets.push(...(await walkDirectory(absolutePath)));
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      const mimeType = getMimeType(entry.name);
      if (!mimeType) {
        continue;
      }

      const sourceRelativePath = toPosix(relative(sourceRoot, absolutePath));
      assets.push({
        id: `${params.source}:${sourceRelativePath}`,
        source: params.source,
        absolutePath,
        sourceRelativePath,
        mimeType,
      });
    }

    return assets;
  }

  return walkDirectory(sourceRoot);
}

async function buildImageAssetIndex(
  rootDir: string,
): Promise<IndexedImageAsset[]> {
  const [srcAssets, publicAssets] = await Promise.all([
    collectImageAssetsForSource({
      rootDir,
      source: 'src',
    }),
    collectImageAssetsForSource({
      rootDir,
      source: 'public',
    }),
  ]);

  return [...srcAssets, ...publicAssets].sort((a, b) => {
    if (a.source !== b.source) {
      return a.source.localeCompare(b.source);
    }

    return a.sourceRelativePath.localeCompare(b.sourceRelativePath);
  });
}

async function getImageIndex(): Promise<IndexedImageAsset[]> {
  const rootDir = getCollectionsRootPath();
  if (cachedRootDir === rootDir && cachedAssets && cachedAssetsById) {
    return cachedAssets;
  }

  const assets = await buildImageAssetIndex(rootDir);
  cachedRootDir = rootDir;
  cachedAssets = assets;
  cachedAssetsById = new Map(assets.map((asset) => [asset.id, asset]));
  return assets;
}

export async function listImageAssetsForFile(
  currentFilePath: string,
  sourceMode: ImageAssetSourceMode = 'asset',
): Promise<ImageAssetOption[]> {
  const targetSource: ImageSource = sourceMode === 'public' ? 'public' : 'src';
  const assets = (await getImageIndex()).filter((asset) => {
    return asset.source === targetSource;
  });
  const fileDirectory = dirname(resolve(currentFilePath));

  return assets.map((asset) => {
    const value =
      asset.source === 'public'
        ? `/${asset.sourceRelativePath}`
        : toRelativePath(fileDirectory, asset.absolutePath);

    return {
      id: asset.id,
      source: asset.source,
      displayPath: asset.sourceRelativePath,
      value,
    };
  });
}

export async function readImageAssetPreviewById(assetId: string): Promise<{
  bytes: Buffer;
  mimeType: string;
}> {
  await getImageIndex();
  const asset = cachedAssetsById?.get(assetId);
  if (!asset) {
    throw new Error(`Image asset not found: ${assetId}`);
  }

  const bytes = await readFile(asset.absolutePath);
  return {
    bytes,
    mimeType: asset.mimeType,
  };
}

function isRemoteSourcePath(sourcePath: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(sourcePath);
}

export async function readImagePreviewBySourcePath(params: {
  currentFilePath: string;
  sourcePath: string;
}): Promise<{ bytes: Buffer; mimeType: string }> {
  const rootDir = getCollectionsRootPath();
  const normalizedSourcePath = params.sourcePath.trim();
  if (!normalizedSourcePath) {
    throw new Error('Image path is empty.');
  }

  if (isRemoteSourcePath(normalizedSourcePath)) {
    throw new Error('Remote image URLs are not resolved through local preview.');
  }

  const currentFileAbsolutePath = resolve(params.currentFilePath);
  assertPathWithinRoot(rootDir, currentFileAbsolutePath);

  const targetAbsolutePath = normalizedSourcePath.startsWith('/')
    ? resolve(rootDir, 'public', normalizedSourcePath.replace(/^\/+/, ''))
    : resolve(dirname(currentFileAbsolutePath), normalizedSourcePath);
  assertPathWithinRoot(rootDir, targetAbsolutePath);

  const mimeType = getMimeType(targetAbsolutePath);
  if (!mimeType) {
    throw new Error(`Unsupported image extension: ${normalizedSourcePath}`);
  }

  const bytes = await readFile(targetAbsolutePath);
  return {
    bytes,
    mimeType,
  };
}
