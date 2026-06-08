import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import type { AppSettings } from '../../shared/ipc/contracts';
import {
  createDesktopQueryDescriptor,
  getDesktopQueryCache,
  getRendererDesktopClient,
} from '../lib/ipc/query-client';
import { useDesktopQuery } from '../lib/ipc/query-hooks';
import {
  applyThemePreference,
  areAppSettingsEqual,
  getSettingsSurfaceState,
  previewAppSettings,
  settingsSurfaceCopy,
  submitSettingsPatch,
  type SettingsSaveState,
  type SettingsSurfaceState,
} from '../routes/settings-surface';

type RendererSettingsContextValue = {
  desktopAvailable: boolean;
  error: Error | null;
  isSaving: boolean;
  lastFailedPatch: Partial<AppSettings> | null;
  saveState: SettingsSaveState;
  settings: AppSettings | null;
  surfaceState: SettingsSurfaceState;
  retryLastFailedPatch(): Promise<void>;
  updateSettings(patch: Partial<AppSettings>): Promise<void>;
};

const settingsContext = createContext<RendererSettingsContextValue | null>(null);

function createIdleSaveState(): SettingsSaveState {
  return {
    status: 'idle',
    message: null,
    changedKeys: [],
  };
}

export function RendererSettingsProvider({ children }: { children: ReactNode }) {
  const desktopClient = getRendererDesktopClient();
  const queryCache = getDesktopQueryCache();
  const settingsDescriptor = createDesktopQueryDescriptor('getSettings', {});
  const settingsQuery = useDesktopQuery(queryCache, settingsDescriptor, {
    enabled: desktopClient.available,
  });
  const [saveState, setSaveState] = useState<SettingsSaveState>(createIdleSaveState);
  const [lastFailedPatch, setLastFailedPatch] = useState<Partial<AppSettings> | null>(null);
  const [settingsOverride, setSettingsOverride] = useState<AppSettings | null>(null);
  const hasData = Boolean(settingsOverride ?? settingsQuery.data);
  const surfaceState = getSettingsSurfaceState({
    desktopAvailable: desktopClient.available,
    status: settingsQuery.status,
    hasData,
  });
  const resolvedSettings =
    settingsOverride ??
    settingsQuery.data ??
    (desktopClient.available ? null : previewAppSettings);

  useEffect(() => {
    if (typeof document === 'undefined' || !resolvedSettings) {
      return;
    }

    applyThemePreference(document.documentElement, resolvedSettings.theme);
  }, [resolvedSettings?.theme]);

  useEffect(() => {
    if (!settingsQuery.data || !settingsOverride) {
      return;
    }

    if (areAppSettingsEqual(settingsQuery.data, settingsOverride)) {
      setSettingsOverride(null);
    }
  }, [settingsOverride, settingsQuery.data]);

  async function commitSettingsPatch(patch: Partial<AppSettings>) {
    if (!desktopClient.available || Object.keys(patch).length === 0) {
      return;
    }

    setSaveState({
      status: 'saving',
      message: settingsSurfaceCopy.savingMessage,
      changedKeys: [],
    });

    const result = await submitSettingsPatch({
      patch,
      updateSettings: async (nextPatch) =>
        desktopClient.commands.updateSettings({
          patch: nextPatch,
        }),
    });

    if (result.settings) {
      setSettingsOverride(result.settings);
      setLastFailedPatch(null);
    } else {
      setLastFailedPatch(result.failedPatch);
    }

    setSaveState(result.saveState);
  }

  const value: RendererSettingsContextValue = {
    desktopAvailable: desktopClient.available,
    error: settingsQuery.error,
    isSaving: saveState.status === 'saving',
    lastFailedPatch,
    saveState,
    settings: resolvedSettings,
    surfaceState,
    retryLastFailedPatch: async () => {
      if (!lastFailedPatch) {
        return;
      }

      await commitSettingsPatch(lastFailedPatch);
    },
    updateSettings: async (patch) => {
      await commitSettingsPatch(patch);
    },
  };

  return (
    <settingsContext.Provider value={value}>
      {children}
    </settingsContext.Provider>
  );
}

export function useRendererSettings() {
  const value = useContext(settingsContext);

  if (!value) {
    throw new Error('RendererSettingsProvider is missing from the renderer tree.');
  }

  return value;
}
