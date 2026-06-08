export type MainWindowOptions = {
  width: number;
  height: number;
  minWidth: number;
  minHeight: number;
  backgroundColor: string;
  title: string;
  titleBarStyle: 'hiddenInset';
  webPreferences: {
    preload: string;
    contextIsolation: boolean;
    nodeIntegration: boolean;
  };
};

export function createMainWindowOptions(preloadPath: string): MainWindowOptions {
  return {
    width: 1480,
    height: 960,
    minWidth: 1180,
    minHeight: 760,
    backgroundColor: '#f3f7fb',
    title: 'Talkin AI',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
    },
  };
}
