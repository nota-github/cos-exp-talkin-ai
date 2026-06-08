import assert from 'node:assert/strict';
import test from 'node:test';
import { createMainWindowOptions } from '../src/main/window-config.ts';

test('story-1.1:AC-3 keeps Electron BrowserWindow security defaults enabled', () => {
  const windowOptions = createMainWindowOptions('/tmp/talkin-ai-preload.js');

  assert.equal(windowOptions.webPreferences.contextIsolation, true);
  assert.equal(windowOptions.webPreferences.nodeIntegration, false);
  assert.equal(windowOptions.webPreferences.preload, '/tmp/talkin-ai-preload.js');
});
