import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const electronBinary = require('electron');
const scriptDir = dirname(fileURLToPath(import.meta.url));
const appDir = join(scriptDir, '..');
const compiledMainEntry = join(appDir, 'dist-electron', 'main', 'index.js');
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const childProcesses = [];

function spawnChild(command, args, extraEnv = {}) {
  const child = spawn(command, args, {
    cwd: appDir,
    stdio: 'inherit',
    env: {
      ...process.env,
      ...extraEnv,
    },
  });

  childProcesses.push(child);
  return child;
}

async function waitForFile(filePath, timeoutMs = 30000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      await access(filePath);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  throw new Error(`Timed out waiting for compiled Electron entry at ${filePath}.`);
}

async function waitForUrl(url, timeoutMs = 30000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // Keep waiting while the Vite dev server starts.
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(`Timed out waiting for renderer dev server at ${url}.`);
}

function cleanupAndExit(code = 0) {
  for (const child of childProcesses) {
    if (!child.killed) {
      child.kill();
    }
  }

  process.exit(code);
}

process.on('SIGINT', () => cleanupAndExit(0));
process.on('SIGTERM', () => cleanupAndExit(0));

async function start() {
  spawnChild(npmCommand, ['run', 'dev:electron:watch']);
  spawnChild(npmCommand, ['run', 'dev:renderer']);

  await Promise.all([
    waitForFile(compiledMainEntry),
    waitForUrl('http://127.0.0.1:5173'),
  ]);

  const electronProcess = spawnChild(electronBinary, [compiledMainEntry], {
    VITE_DEV_SERVER_URL: 'http://127.0.0.1:5173',
  });

  electronProcess.on('exit', (code) => {
    cleanupAndExit(code ?? 0);
  });
}

start().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  cleanupAndExit(1);
});
