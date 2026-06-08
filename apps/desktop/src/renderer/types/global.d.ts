import type { TalkinAIDesktopApi } from '../../shared/ipc/contracts';

export {};

declare global {
  interface Window {
    talkinAI?: TalkinAIDesktopApi;
  }
}
