import { contextBridge } from 'electron';

contextBridge.exposeInMainWorld('talkinAI', {
  shell: {
    channel: 'desktop-shell',
    platform: process.platform,
  },
});
