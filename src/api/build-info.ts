import { execSync } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Try to read git hash at startup
function getGitHash(): string {
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
  } catch {
    // In Docker, git may not be available. Fall back to a build-time file.
    try {
      const __filename = fileURLToPath(import.meta.url);
      const __dirname = path.dirname(__filename);
      const versionFile = path.join(__dirname, '..', '..', 'BUILD_HASH');
      if (existsSync(versionFile)) {
        return readFileSync(versionFile, 'utf8').trim();
      }
    } catch { /* ignore */ }
    return 'unknown';
  }
}

export const BUILD_HASH = getGitHash();
