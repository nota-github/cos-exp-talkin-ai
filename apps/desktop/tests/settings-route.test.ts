import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  applyThemePreference,
  getSettingsHeroState,
  getHistoryDefaultVisibility,
  getSettingsSurfaceState,
  settingsSurfaceCopy,
  shouldRenderSettingsControls,
  submitSettingsPatch,
} from '../src/renderer/routes/settings-surface.ts';
import {
  getConnectionBadgeClass,
  previewConnectionHealth,
  settingsConnectionsCopy,
} from '../src/renderer/routes/settings-connections-surface.ts';

const appSource = readFileSync(new URL('../src/renderer/app/App.tsx', import.meta.url), 'utf8');
const rendererSettingsSource = readFileSync(
  new URL('../src/renderer/app/renderer-settings.tsx', import.meta.url),
  'utf8',
);
const settingsRouteSource = readFileSync(
  new URL('../src/renderer/routes/SettingsRoute.tsx', import.meta.url),
  'utf8',
);
const settingsConnectionsSource = readFileSync(
  new URL('../src/renderer/routes/settings-connections-surface.ts', import.meta.url),
  'utf8',
);
const usageRouteSource = readFileSync(
  new URL('../src/renderer/routes/UsageRoute.tsx', import.meta.url),
  'utf8',
);
const settingsStylesSource = readFileSync(
  new URL('../src/renderer/styles.css', import.meta.url),
  'utf8',
);

test('story-6.1:SCOPE-1, story-6.1:SCOPE-3, story-6.1:AC-1, and story-6.1:AC-5 group non-secret settings into a readable control surface', () => {
  assert.match(settingsSurfaceCopy.executionBody, /기본 모델/);
  assert.match(settingsSurfaceCopy.responseBody, /히스토리/);
  assert.match(settingsRouteSource, /label="기본 모델"/);
  assert.match(settingsRouteSource, /label="최적화 모드"/);
  assert.match(settingsRouteSource, /label="응답 언어"/);
  assert.match(settingsRouteSource, /label="테마"/);
  assert.match(settingsRouteSource, /label="히스토리 고급 보기 기본값"/);
  assert.match(settingsRouteSource, /settingsSurfaceCopy\.retryLabel/);
  assert.match(appSource, /RendererSettingsProvider/);
  assert.match(settingsStylesSource, /\.settings-layout\s*\{/);
  assert.match(settingsStylesSource, /\.settings-choice-list\s*\{/);
  assert.match(settingsRouteSource, /shouldRenderSettingsControls\(surfaceState\)/);
  assert.doesNotMatch(settingsRouteSource, /dotenv|environment variables|debug panel/i);
});

test('story-6.2:SCOPE-1, story-6.2:SCOPE-3, story-6.2:AC-1, story-6.2:AC-4, and story-6.2:AC-5 render human-readable connection controls and guidance', () => {
  assert.equal(settingsConnectionsCopy.refreshLabel, '연결 다시 확인');
  assert.equal(getConnectionBadgeClass('connected'), 'badge badge-success');
  assert.equal(getConnectionBadgeClass('needs_attention'), 'badge badge-primary');
  assert.equal(getConnectionBadgeClass('setup_required'), 'badge badge-muted');
  assert.equal(previewConnectionHealth.providers[0].status.label, '설정 필요');
  assert.equal(previewConnectionHealth.localEngine.status.label, '확인 필요');
  assert.match(settingsRouteSource, /getConnectionHealth/);
  assert.match(settingsRouteSource, /saveApiKey/);
  assert.match(settingsRouteSource, /deleteApiKey/);
  assert.match(settingsRouteSource, /name="apiKey"/);
  assert.match(settingsRouteSource, /settingsConnectionsCopy\.emptyInputMessage/);
  assert.match(settingsRouteSource, /settingsConnectionsCopy\.saveError/);
  assert.match(settingsRouteSource, /settingsConnectionsCopy\.deleteError/);
  assert.match(settingsRouteSource, /settingsConnectionsCopy\.refreshLabel/);
  assert.match(settingsRouteSource, /현재 기본 모델/);
  assert.match(settingsConnectionsSource, /확인 필요/);
  assert.match(settingsConnectionsSource, /설정 필요/);
  assert.match(settingsRouteSource, /item\.status\.label/);
  assert.match(settingsStylesSource, /\.settings-provider-editor/);
  assert.match(settingsStylesSource, /\.settings-connection-brief/);
  assert.doesNotMatch(settingsRouteSource, /stack trace|uncaught|dotenv|401|403/i);
});

test('story-6.2:SCOPE-2, story-6.2:AC-3, and story-6.2:AC-4 keep desktop loading and error rail states neutral instead of falling back to preview summaries', () => {
  assert.match(settingsRouteSource, /const connectionRailState: ConnectionRailState = !desktopClient\.available/);
  assert.match(
    settingsRouteSource,
    /const visibleConnectionHealth =\s*desktopClient\.available && connectionQuery\.data\s*\?\s*connectionQuery\.data\s*:\s*!desktopClient\.available\s*\?\s*previewConnectionHealth\s*:\s*null;/,
  );
  assert.match(
    settingsRouteSource,
    /getPendingConnectionSummary\(\{\s*railState: connectionRailState,\s*target: 'provider',\s*\}\)/,
  );
  assert.match(
    settingsRouteSource,
    /getPendingConnectionSummary\(\{\s*railState: connectionRailState,\s*target: 'localEngine',\s*\}\)/,
  );
  assert.match(settingsRouteSource, /현재 기본 모델 연결을 확인하는 중/);
  assert.match(settingsRouteSource, /현재 기본 모델 연결을 불러오지 못했습니다/);
  assert.match(settingsRouteSource, /로컬 최적화 엔진 상태를 확인하는 중/);
  assert.match(settingsRouteSource, /로컬 최적화 엔진 상태를 불러오지 못했습니다/);
  assert.doesNotMatch(
    settingsRouteSource,
    /selectedModel \?\? previewConnectionHealth\.selectedModel/,
  );
  assert.doesNotMatch(
    settingsRouteSource,
    /visibleConnectionHealth\?\.localEngine ?? previewConnectionHealth\.localEngine/,
  );
});

test('story-6.1:SCOPE-3 keeps loading and read-failure states from presenting preview defaults as saved settings', () => {
  const loadingHero = getSettingsHeroState({
    surfaceState: 'loading',
    settings: null,
  });
  const errorHero = getSettingsHeroState({
    surfaceState: 'error',
    settings: null,
  });

  assert.deepEqual(
    [loadingHero.kicker, loadingHero.value, loadingHero.body],
    ['저장된 기본값 확인 중', '불러오는 중', settingsSurfaceCopy.loadingBody],
  );
  assert.deepEqual(
    [errorHero.kicker, errorHero.value, errorHero.body],
    ['저장값 확인 필요', '읽기 실패', settingsSurfaceCopy.errorBody],
  );
  assert.equal(shouldRenderSettingsControls('loading'), false);
  assert.equal(shouldRenderSettingsControls('error'), false);
  assert.equal(shouldRenderSettingsControls('preview'), true);
  assert.match(settingsRouteSource, /const showSettingsControls = shouldRenderSettingsControls\(surfaceState\)/);
  assert.match(settingsRouteSource, /\{showSettingsControls \? \(/);
  assert.doesNotMatch(
    settingsRouteSource,
    /body=\{error\?\.message \?\? settingsSurfaceCopy\.errorBody\}/,
  );
});

test('story-6.1:AC-4 returns safe retry metadata when a settings save fails and success copy when it commits', async () => {
  const patch = {
    theme: 'dark' as const,
    advancedPromptPreview: true,
  };
  const failureResult = await submitSettingsPatch({
    patch,
    updateSettings: async () => {
      throw new Error('forced settings write failure');
    },
  });
  const successResult = await submitSettingsPatch({
    patch: {
      defaultModel: 'claude-sonnet-4',
      responseLanguage: 'en',
    },
    updateSettings: async (nextPatch) => ({
      settings: {
        defaultModel: nextPatch.defaultModel ?? 'gpt-4.1',
        optimizationMode: 'balanced',
        responseLanguage: nextPatch.responseLanguage ?? 'ko',
        theme: 'system',
        advancedPromptPreview: false,
      },
      updatedKeys: ['defaultModel', 'responseLanguage'],
    }),
  });

  assert.equal(failureResult.settings, null);
  assert.deepEqual(failureResult.failedPatch, patch);
  assert.deepEqual(failureResult.saveState, {
    status: 'error',
    message: settingsSurfaceCopy.saveError,
    changedKeys: [],
  });
  assert.equal(successResult.failedPatch, null);
  assert.equal(successResult.saveState.status, 'success');
  assert.match(successResult.saveState.message ?? '', /기본 모델/);
  assert.match(successResult.saveState.message ?? '', /응답 언어/);
  assert.match(settingsRouteSource, /retryLastFailedPatch/);
});

test('story-6.1:VAL-2 and story-6.1:AC-3 tie advanced preview defaults to usage-history reveal state', () => {
  assert.deepEqual(getHistoryDefaultVisibility(false), {
    showOptimizedPrompt: false,
    showProviderResponse: false,
  });
  assert.deepEqual(getHistoryDefaultVisibility(true), {
    showOptimizedPrompt: true,
    showProviderResponse: true,
  });
  assert.match(usageRouteSource, /getHistoryDefaultVisibility/);
  assert.match(usageRouteSource, /settings\?\.advancedPromptPreview/);
  assert.match(
    usageRouteSource,
    /setShowOptimizedPrompt\(historyDefaultVisibility\.showOptimizedPrompt\)/,
  );
  assert.match(
    usageRouteSource,
    /setShowProviderResponse\(historyDefaultVisibility\.showProviderResponse\)/,
  );
});

test('story-6.1:VAL-3 and story-6.1:SCOPE-2 apply theme changes to the renderer shell without restart', () => {
  const target = {
    dataset: {},
    style: {},
  };

  applyThemePreference(target, 'dark');
  assert.equal(target.dataset.theme, 'dark');
  assert.equal(target.style.colorScheme, 'dark');

  applyThemePreference(target, 'system');
  assert.equal(target.dataset.theme, 'system');
  assert.equal(target.style.colorScheme, 'light dark');

  assert.deepEqual(
    [
      getSettingsSurfaceState({
        desktopAvailable: false,
        status: 'idle',
        hasData: false,
      }),
      getSettingsSurfaceState({
        desktopAvailable: true,
        status: 'loading',
        hasData: false,
      }),
      getSettingsSurfaceState({
        desktopAvailable: true,
        status: 'error',
        hasData: false,
      }),
      getSettingsSurfaceState({
        desktopAvailable: true,
        status: 'success',
        hasData: false,
      }),
      getSettingsSurfaceState({
        desktopAvailable: true,
        status: 'success',
        hasData: true,
      }),
    ],
    ['preview', 'loading', 'error', 'empty', 'ready'],
  );
  assert.match(
    rendererSettingsSource,
    /applyThemePreference\(document\.documentElement,\s*resolvedSettings\.theme\)/,
  );
  assert.match(rendererSettingsSource, /desktopClient\.available \? null : previewAppSettings/);
  assert.match(settingsStylesSource, /:root\[data-theme="dark"\]/);
  assert.match(settingsStylesSource, /:root\[data-theme="system"\]/);
});
