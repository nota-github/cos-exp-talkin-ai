import { app, BrowserWindow, ipcMain } from 'electron';
import { join } from 'node:path';
import { createPersistentChatHistoryService } from './chat/index.ts';
import { registerDesktopIpcHandlers } from './ipc/register-ipc';
import { createPersistentAppSettingsService } from './settings/index.ts';
import {
  createStdioTranslationMcpRuntime,
  createTranslationMcpAdapter,
} from './translation/index.ts';
import { createMainWindowOptions } from './window-config';
import { createPersistentOptimizationStageOrchestrator } from './workflows/index.ts';

let mainWindow: BrowserWindow | null = null;
let ipcHandlersRegistered = false;

function registerIpcHandlers() {
  if (ipcHandlersRegistered) {
    return;
  }

  const dbPath = join(app.getPath('userData'), 'talkin-ai.db');
  const translationAdapter = createTranslationMcpAdapter({
    runtime: createStdioTranslationMcpRuntime({
      command:
        process.env.TALKIN_AI_TRANSLATION_MCP_COMMAND ?? 'talkin-ai-translation-mcp',
    }),
  });

  registerDesktopIpcHandlers(ipcMain, {
    broadcast: (channel, payload) => {
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send(channel, payload);
      }
    },
    chatHistoryService: createPersistentChatHistoryService({
      dbPath,
      optimizationStageOrchestrator: createPersistentOptimizationStageOrchestrator({
        dbPath,
        translationAdapter,
      }),
    }),
    settingsService: createPersistentAppSettingsService({
      dbPath,
    }),
    translationAdapter,
  });

  ipcHandlersRegistered = true;
}

function createMainWindow() {
  const preloadPath = join(__dirname, '../preload/index.js');
  const windowOptions = createMainWindowOptions(preloadPath);

  mainWindow = new BrowserWindow(windowOptions);

  const rendererDevUrl = process.env.VITE_DEV_SERVER_URL;
  if (rendererDevUrl) {
    void mainWindow.loadURL(rendererDevUrl);
  } else {
    const rendererEntry = join(__dirname, '../../dist/index.html');
    void mainWindow.loadFile(rendererEntry);
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  registerIpcHandlers();
  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
