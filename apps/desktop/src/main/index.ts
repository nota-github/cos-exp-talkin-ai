import { app, BrowserWindow } from 'electron';
import { join } from 'node:path';
import { createMainWindowOptions } from './window-config';

let mainWindow: BrowserWindow | null = null;

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
