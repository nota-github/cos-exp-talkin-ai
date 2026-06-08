export {};

declare global {
  interface Window {
    talkinAI?: {
      shell: {
        channel: string;
        platform: string;
      };
    };
  }
}
