import { readdir } from 'node:fs/promises';
import path from 'node:path';

// Lists loadable .js modules under a directory (recursively), skipping tests.
export async function findModuleFiles(directory) {
  const entries = await readdir(directory, { recursive: true, withFileTypes: true });
  return entries
    .filter(
      (entry) => entry.isFile() && entry.name.endsWith('.js') && !entry.name.endsWith('.test.js'),
    )
    .map((entry) => path.join(entry.parentPath, entry.name))
    .sort();
}
