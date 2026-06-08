import { app, BrowserWindow, ipcMain } from 'electron';
import { join } from 'node:path';
import { createPersistentChatHistoryService } from './chat/index.ts';
import { createPersistentHistoryInspectionService } from './history/index.ts';
import { registerDesktopIpcHandlers } from './ipc/register-ipc';
import { createPersistentSecretService } from './keychain/index.ts';
import { createCloudInferenceGateway } from './providers/index.ts';
import { createPersistentAppSettingsService } from './settings/index.ts';
import {
  createStdioTranslationMcpRuntime,
  createTranslationMcpAdapter,
} from './translation/index.ts';
import { createPersistentWorkbenchService } from './workbench/index.ts';
import { createMainWindowOptions } from './window-config';
import {
  createPersistentOptimizationStageOrchestrator,
  createPersistentResponseCompletionOrchestrator,
} from './workflows/index.ts';
import { createPersistentUsageDashboardService } from './usage/index.ts';

let mainWindow: BrowserWindow | null = null;
let ipcHandlersRegistered = false;

function registerIpcHandlers() {
  if (ipcHandlersRegistered) {
    return;
  }

  const dbPath = join(app.getPath('userData'), 'talkin-ai.db');
  const settingsService = createPersistentAppSettingsService({
    dbPath,
  });
  const usageDashboardService = createPersistentUsageDashboardService({
    dbPath,
  });
  const historyInspectionService = createPersistentHistoryInspectionService({
    dbPath,
  });
  const workbenchService = createPersistentWorkbenchService({
    dbPath,
  });
  const secretService = createPersistentSecretService({});
  const translationAdapter = createTranslationMcpAdapter({
    runtime: createStdioTranslationMcpRuntime({
      command:
        process.env.TALKIN_AI_TRANSLATION_MCP_COMMAND ?? 'talkin-ai-translation-mcp',
    }),
  });
  const cloudInferenceGateway = createCloudInferenceGateway({
    processType: 'browser',
    secretService,
    settingsService,
  });
  const responseCompletionOrchestrator = createPersistentResponseCompletionOrchestrator({
    dbPath,
    cloudInferenceGateway,
    translationAdapter,
    settingsService,
  });
  const optimizationStageOrchestrator = createPersistentOptimizationStageOrchestrator({
    dbPath,
    translationAdapter,
    dispatchOptimizedRun(input) {
      return responseCompletionOrchestrator.completeOptimizedRun(input);
    },
  });

  registerDesktopIpcHandlers(ipcMain, {
    broadcast: (channel, payload) => {
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send(channel, payload);
      }
    },
    chatHistoryService: createPersistentChatHistoryService({
      dbPath,
      optimizationStageOrchestrator,
    }),
    historyInspectionService,
    settingsService,
    translationAdapter,
    usageDashboardService,
    workbenchService,
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
