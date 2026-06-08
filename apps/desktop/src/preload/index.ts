import { contextBridge, ipcRenderer } from 'electron';
import { createTalkinAIDesktopApi } from './bridge';

contextBridge.exposeInMainWorld(
  'talkinAI',
  createTalkinAIDesktopApi(ipcRenderer, {
    channel: 'desktop-shell',
    platform: process.platform,
  }),
);
