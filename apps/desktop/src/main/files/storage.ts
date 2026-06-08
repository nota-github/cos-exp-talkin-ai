import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';

export type StoreProjectFileInput = {
  projectId: string;
  fileId: string;
  displayName: string;
  bytes: Uint8Array;
};

export type StoreProjectFileResult = {
  storagePath: string;
  sizeBytes: number;
};

export type ProjectFileStorage = {
  storeFile(input: StoreProjectFileInput): Promise<StoreProjectFileResult>;
};

export type ProjectFileStorageOptions = {
  rootDir: string;
};

function sanitizeExtension(displayName: string) {
  const extension = extname(displayName).toLowerCase();

  if (!extension) {
    return '';
  }

  return extension.replace(/[^a-z0-9.]/g, '').slice(0, 12);
}

export function createProjectFileStorage(
  options: ProjectFileStorageOptions,
): ProjectFileStorage {
  return {
    async storeFile(input) {
      const extension = sanitizeExtension(input.displayName);
      const directory = join(options.rootDir, input.projectId);
      const storagePath = join(directory, `${input.fileId}${extension}`);

      await mkdir(dirname(storagePath), { recursive: true });
      await writeFile(storagePath, input.bytes);

      return {
        storagePath,
        sizeBytes: input.bytes.byteLength,
      };
    },
  };
}
