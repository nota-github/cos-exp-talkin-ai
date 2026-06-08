import { useState, type FormEvent } from 'react';
import type {
  AppSettings,
  LocalEngineConnection,
  ProviderConnectionItem,
  ProviderId,
} from '../../shared/ipc/contracts';
import { useRendererSettings } from '../app/renderer-settings';
import {
  createDesktopQueryDescriptor,
  getDesktopQueryCache,
  getRendererDesktopClient,
} from '../lib/ipc/query-client';
import { useDesktopQuery } from '../lib/ipc/query-hooks';
import {
  getConnectionBadgeClass,
  getProviderMutationSuccessMessage,
  previewConnectionHealth,
  settingsConnectionsCopy,
} from './settings-connections-surface';
import {
  advancedPreviewOptions,
  getAppSettingsLabels,
  getSettingsHeroState,
  modelOptions,
  optimizationModeOptions,
  previewAppSettings,
  responseLanguageOptions,
  settingsSurfaceCopy,
  shouldRenderSettingsControls,
  themeOptions,
} from './settings-surface';

type SettingsOptionValue = string | boolean;

type ConnectionMutationState = {
  status: 'idle' | 'saving' | 'success' | 'error';
  message: string | null;
};

type ConnectionRailState = 'preview' | 'loading' | 'error' | 'ready';

type ConnectionSummaryViewModel = {
  detail: string;
  guidance: string;
  meta: string | null;
  statusClassName: string;
  statusLabel: string;
  title: string;
  warnings?: string[];
};

function createIdleConnectionMutationState(): ConnectionMutationState {
  return {
    status: 'idle',
    message: null,
  };
}

function createInitialConnectionMutationState() {
  return {
    openai: createIdleConnectionMutationState(),
    anthropic: createIdleConnectionMutationState(),
    google: createIdleConnectionMutationState(),
  } satisfies Record<ProviderId, ConnectionMutationState>;
}

function SettingsStateCard({
  kicker,
  title,
  body,
  tone = 'neutral',
}: {
  kicker: string;
  title: string;
  body: string;
  tone?: 'neutral' | 'error';
}) {
  return (
    <section
      className={
        tone === 'error'
          ? 'panel settings-state-card settings-state-card-error'
          : 'panel settings-state-card'
      }
    >
      <span className="panel-kicker">{kicker}</span>
      <strong>{title}</strong>
      <p>{body}</p>
    </section>
  );
}

function SettingsChoiceGroup({
  currentValue,
  disabled,
  label,
  onSelect,
  options,
}: {
  currentValue: SettingsOptionValue;
  disabled: boolean;
  label: string;
  onSelect: (value: SettingsOptionValue) => void;
  options: ReadonlyArray<{
    value: SettingsOptionValue;
    label: string;
    description: string;
  }>;
}) {
  return (
    <section className="settings-choice-group">
      <div className="settings-choice-header">
        <strong>{label}</strong>
      </div>

      <div className="settings-choice-list">
        {options.map((option) => {
          const selected = currentValue === option.value;

          return (
            <button
              key={String(option.value)}
              type="button"
              className={
                selected
                  ? 'settings-option-button settings-option-button-active'
                  : 'settings-option-button'
              }
              aria-pressed={selected}
              disabled={disabled || selected}
              onClick={() => {
                onSelect(option.value);
              }}
            >
              <span className="settings-option-top">
                <span className="settings-option-label">{option.label}</span>
                <span className={selected ? 'badge badge-primary' : 'badge badge-muted'}>
                  {selected ? '현재 기본값' : '선택 가능'}
                </span>
              </span>
              <span className="settings-option-description">{option.description}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function ConnectionSummaryCard({
  detail,
  guidance,
  kicker,
  meta,
  statusClassName,
  statusLabel,
  title,
  warnings,
}: {
  detail: string;
  guidance: string;
  kicker: string;
  meta: string | null;
  statusClassName: string;
  statusLabel: string;
  title: string;
  warnings?: string[];
}) {
  return (
    <section className="settings-connection-brief">
      <div className="settings-connection-brief-top">
        <div>
          <span className="panel-kicker">{kicker}</span>
          <strong>{title}</strong>
        </div>
        <span className={statusClassName}>{statusLabel}</span>
      </div>

      <p>{detail}</p>
      <span className="settings-connection-guidance">{guidance}</span>
      {meta ? <span className="settings-connection-meta">{meta}</span> : null}
      {warnings && warnings.length > 0 ? (
        <div className="chip-row">
          {warnings.map((warning) => (
            <span key={warning} className="badge badge-muted">
              {warning}
            </span>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function ProviderKeyEditor({
  item,
  disabled,
  mutationState,
  onDelete,
  onSave,
}: {
  item: ProviderConnectionItem;
  disabled: boolean;
  mutationState: ConnectionMutationState;
  onDelete: (provider: ProviderId, form: HTMLFormElement | null) => Promise<void>;
  onSave: (provider: ProviderId, event: FormEvent<HTMLFormElement>) => Promise<void>;
}) {
  const feedbackClassName =
    mutationState.status === 'success'
      ? 'settings-inline-feedback settings-inline-feedback-success'
      : mutationState.status === 'error'
        ? 'settings-inline-feedback settings-inline-feedback-error'
        : 'settings-inline-feedback';

  return (
    <article className="settings-provider-editor">
      <div className="settings-provider-editor-top">
        <div className="settings-provider-title-stack">
          <div className="settings-provider-title-row">
            <strong>{item.label}</strong>
            {item.isSelected ? <span className="badge badge-primary">현재 기본 모델</span> : null}
            <span className="badge badge-muted">{item.defaultModel}</span>
          </div>
          <p>{item.status.summary}</p>
        </div>
        <span className={getConnectionBadgeClass(item.status.state)}>{item.status.label}</span>
      </div>

      <div className="settings-provider-subline">
        <span>
          {item.maskedKeyPreview
            ? `저장된 키 ${item.maskedKeyPreview}`
            : '저장된 키 없음'}
        </span>
        {item.lastCheckedAt ? (
          <span className="settings-connection-meta">
            마지막 확인 {item.lastCheckedAt.slice(11, 16)}
          </span>
        ) : null}
      </div>

      <form
        className="settings-provider-form"
        onSubmit={(event) => {
          event.preventDefault();
          void onSave(item.provider, event);
        }}
      >
        <input
          type="password"
          name="apiKey"
          autoComplete="off"
          spellCheck={false}
          className="settings-provider-input"
          placeholder={settingsConnectionsCopy.inputPlaceholder}
          disabled={disabled || mutationState.status === 'saving'}
        />

        <div className="settings-provider-actions">
          <button
            type="submit"
            className="soft-button"
            disabled={disabled || mutationState.status === 'saving'}
          >
            {mutationState.status === 'saving' ? '저장 중' : settingsConnectionsCopy.saveLabel}
          </button>
          <button
            type="button"
            className="ghost-chip"
            disabled={
              disabled ||
              mutationState.status === 'saving' ||
              !item.hasStoredKey
            }
            onClick={(event) => {
              void onDelete(item.provider, event.currentTarget.form);
            }}
          >
            {settingsConnectionsCopy.deleteLabel}
          </button>
        </div>
      </form>

      <span className="settings-connection-guidance">{item.status.guidance}</span>
      {mutationState.message ? (
        <p className={feedbackClassName} aria-live="polite">
          {mutationState.message}
        </p>
      ) : null}
    </article>
  );
}

function getConnectionMetaLabel(connection: LocalEngineConnection | ProviderConnectionItem) {
  if (!connection.lastCheckedAt) {
    return null;
  }

  return `마지막 확인 ${connection.lastCheckedAt.slice(11, 16)}`;
}

function getPendingConnectionSummary(args: {
  railState: Extract<ConnectionRailState, 'loading' | 'error'>;
  target: 'provider' | 'localEngine';
}): ConnectionSummaryViewModel {
  const statusClassName =
    args.railState === 'loading' ? 'badge badge-muted' : 'badge badge-primary';
  const statusLabel = args.railState === 'loading' ? '확인 중' : '확인 필요';

  if (args.target === 'provider') {
    return {
      title:
        args.railState === 'loading'
          ? '현재 기본 모델 연결을 확인하는 중'
          : '현재 기본 모델 연결을 불러오지 못했습니다',
      statusClassName,
      statusLabel,
      detail:
        args.railState === 'loading'
          ? '선택된 제공자와 저장된 키 상태를 읽고 있습니다.'
          : '현재 기본 모델 제공자의 실제 연결 상태를 지금은 확인할 수 없습니다.',
      guidance:
        args.railState === 'loading'
          ? '잠시만 기다리면 실제 연결 상태가 이 자리에 표시됩니다.'
          : '연결 다시 확인을 눌러 재시도하거나 앱을 다시 열어 보세요.',
      meta: null,
    };
  }

  return {
    title:
      args.railState === 'loading'
        ? '로컬 최적화 엔진 상태를 확인하는 중'
        : '로컬 최적화 엔진 상태를 불러오지 못했습니다',
    statusClassName,
    statusLabel,
    detail:
      args.railState === 'loading'
        ? 'translation MCP와 현재 연결 구성을 읽고 있습니다.'
        : '로컬 최적화 엔진의 실제 연결 상태를 지금은 확인할 수 없습니다.',
    guidance:
      args.railState === 'loading'
        ? '엔진 상태가 준비되면 여기에 바로 표시됩니다.'
        : '연결 다시 확인을 눌러 재시도하거나 앱을 다시 열어 보세요.',
    meta: null,
  };
}

export function SettingsRoute() {
  const {
    desktopAvailable,
    isSaving,
    lastFailedPatch,
    retryLastFailedPatch,
    saveState,
    settings,
    surfaceState,
    updateSettings,
  } = useRendererSettings();
  const desktopClient = getRendererDesktopClient();
  const queryCache = getDesktopQueryCache();
  const connectionDescriptor = createDesktopQueryDescriptor('getConnectionHealth', {});
  const connectionQuery = useDesktopQuery(queryCache, connectionDescriptor, {
    enabled: desktopClient.available,
  });
  const [connectionMutationStates, setConnectionMutationStates] = useState(
    createInitialConnectionMutationState,
  );

  const controlsDisabled = isSaving || !desktopAvailable;
  const heroState = getSettingsHeroState({
    surfaceState,
    settings,
  });
  const visibleSettings = settings ?? previewAppSettings;
  const visibleLabels = getAppSettingsLabels(visibleSettings);
  const showSettingsControls = shouldRenderSettingsControls(surfaceState);
  const connectionLoadingWithoutData =
    desktopClient.available &&
    connectionQuery.status === 'loading' &&
    !connectionQuery.data;
  const connectionErrorWithoutData =
    desktopClient.available &&
    connectionQuery.status === 'error' &&
    !connectionQuery.data;
  const connectionRefreshing =
    desktopClient.available &&
    connectionQuery.status === 'loading' &&
    Boolean(connectionQuery.data);
  const connectionRailState: ConnectionRailState = !desktopClient.available
    ? 'preview'
    : connectionLoadingWithoutData
      ? 'loading'
      : connectionErrorWithoutData
        ? 'error'
        : 'ready';
  const visibleConnectionHealth =
    desktopClient.available && connectionQuery.data
      ? connectionQuery.data
      : !desktopClient.available
        ? previewConnectionHealth
        : null;
  const selectedProviderConnection =
    visibleConnectionHealth?.providers.find((item) => item.isSelected) ?? null;
  const selectedProviderSummary: ConnectionSummaryViewModel =
    connectionRailState === 'loading' || connectionRailState === 'error'
      ? getPendingConnectionSummary({
          railState: connectionRailState,
          target: 'provider',
        })
      : selectedProviderConnection
        ? {
            title: `${selectedProviderConnection.label} · ${visibleConnectionHealth.selectedModel}`,
            statusClassName: getConnectionBadgeClass(selectedProviderConnection.status.state),
            statusLabel: selectedProviderConnection.status.label,
            detail: selectedProviderConnection.status.summary,
            guidance: selectedProviderConnection.status.guidance,
            meta: getConnectionMetaLabel(selectedProviderConnection),
          }
        : getPendingConnectionSummary({
            railState: 'error',
            target: 'provider',
          });
  const localEngineSummary: ConnectionSummaryViewModel =
    connectionRailState === 'loading' || connectionRailState === 'error'
      ? getPendingConnectionSummary({
          railState: connectionRailState,
          target: 'localEngine',
        })
      : visibleConnectionHealth
        ? {
            title: visibleConnectionHealth.localEngine.label,
            statusClassName: getConnectionBadgeClass(visibleConnectionHealth.localEngine.status.state),
            statusLabel: visibleConnectionHealth.localEngine.status.label,
            detail: visibleConnectionHealth.localEngine.status.summary,
            guidance: visibleConnectionHealth.localEngine.status.guidance,
            meta: getConnectionMetaLabel(visibleConnectionHealth.localEngine),
            warnings: visibleConnectionHealth.localEngine.warnings,
          }
        : getPendingConnectionSummary({
            railState: 'error',
            target: 'localEngine',
          });
  const showConnectionControls = Boolean(visibleConnectionHealth) && connectionRailState !== 'error';

  function setConnectionMutationState(
    provider: ProviderId,
    state: ConnectionMutationState,
  ) {
    setConnectionMutationStates((current) => ({
      ...current,
      [provider]: state,
    }));
  }

  function handleSelection<TKey extends keyof AppSettings>(
    key: TKey,
    value: AppSettings[TKey],
  ) {
    if (visibleSettings[key] === value) {
      return;
    }

    void updateSettings({
      [key]: value,
    } as Partial<AppSettings>);
  }

  async function refreshConnectionHealth() {
    if (!desktopClient.available) {
      return;
    }

    await queryCache.fetchQuery(connectionDescriptor);
  }

  async function handleSaveApiKey(
    provider: ProviderId,
    event: FormEvent<HTMLFormElement>,
  ) {
    const form = event.currentTarget;
    const formData = new FormData(form);
    const apiKey = String(formData.get('apiKey') ?? '').trim();
    const providerLabel =
      visibleConnectionHealth?.providers.find((item) => item.provider === provider)?.label ??
      provider;

    if (!apiKey) {
      setConnectionMutationState(provider, {
        status: 'error',
        message: settingsConnectionsCopy.emptyInputMessage,
      });
      return;
    }

    setConnectionMutationState(provider, {
      status: 'saving',
      message: null,
    });

    try {
      await desktopClient.commands.saveApiKey({
        provider,
        apiKey,
      });
      form.reset();
      setConnectionMutationState(provider, {
        status: 'success',
        message: getProviderMutationSuccessMessage({
          provider,
          providerLabel,
          action: 'save',
        }),
      });
      await refreshConnectionHealth();
    } catch {
      setConnectionMutationState(provider, {
        status: 'error',
        message: settingsConnectionsCopy.saveError,
      });
    }
  }

  async function handleDeleteApiKey(
    provider: ProviderId,
    form: HTMLFormElement | null,
  ) {
    const providerLabel =
      visibleConnectionHealth?.providers.find((item) => item.provider === provider)?.label ??
      provider;

    setConnectionMutationState(provider, {
      status: 'saving',
      message: null,
    });

    try {
      await desktopClient.commands.deleteApiKey({
        provider,
      });
      form?.reset();
      setConnectionMutationState(provider, {
        status: 'success',
        message: getProviderMutationSuccessMessage({
          provider,
          providerLabel,
          action: 'delete',
        }),
      });
      await refreshConnectionHealth();
    } catch {
      setConnectionMutationState(provider, {
        status: 'error',
        message: settingsConnectionsCopy.deleteError,
      });
    }
  }

  return (
    <section className="screen screen-settings">
      <header className="screen-header settings-screen-header">
        <div>
          <span className="screen-kicker">{settingsSurfaceCopy.kicker}</span>
          <h1>{settingsSurfaceCopy.headline}</h1>
          <p>{settingsSurfaceCopy.intro}</p>
        </div>

        <article className="hero-stat-card settings-hero-card">
          <span className="hero-stat-label">{heroState.kicker}</span>
          <strong>{heroState.value}</strong>
          <p>{heroState.body}</p>
          <div className="chip-row">
            {heroState.badges.map((badge) => (
              <span
                key={badge.label}
                className={
                  badge.tone === 'primary'
                    ? 'badge badge-primary'
                    : badge.tone === 'success'
                      ? 'badge badge-success'
                      : 'badge badge-muted'
                }
              >
                {badge.label}
              </span>
            ))}
          </div>
        </article>
      </header>

      {surfaceState === 'loading' ? (
        <SettingsStateCard
          kicker="불러오는 중"
          title={settingsSurfaceCopy.loadingTitle}
          body={settingsSurfaceCopy.loadingBody}
        />
      ) : null}

      {surfaceState === 'error' ? (
        <SettingsStateCard
          kicker="읽기 실패"
          title={settingsSurfaceCopy.errorTitle}
          body={settingsSurfaceCopy.errorBody}
          tone="error"
        />
      ) : null}

      {surfaceState === 'empty' ? (
        <SettingsStateCard
          kicker="설정 비어 있음"
          title={settingsSurfaceCopy.emptyTitle}
          body={settingsSurfaceCopy.emptyBody}
        />
      ) : null}

      {surfaceState === 'preview' ? (
        <SettingsStateCard
          kicker="미리보기"
          title={settingsSurfaceCopy.previewTitle}
          body={settingsSurfaceCopy.previewBody}
        />
      ) : null}

      <div className="settings-feedback-row">
        {saveState.status === 'saving' ? (
          <section className="panel settings-feedback settings-feedback-saving">
            <span className="panel-kicker">저장 중</span>
            <strong>{settingsSurfaceCopy.savingMessage}</strong>
            <p>현재 작업 공간은 유지한 채 기본값만 갱신하고 있습니다.</p>
          </section>
        ) : null}

        {saveState.status === 'success' ? (
          <section className="panel settings-feedback settings-feedback-success">
            <span className="panel-kicker">저장 완료</span>
            <strong>{settingsSurfaceCopy.saveSuccess}</strong>
            <p>{saveState.message}</p>
          </section>
        ) : null}

        {saveState.status === 'error' ? (
          <section className="panel settings-feedback settings-feedback-error">
            <div>
              <span className="panel-kicker">저장 실패</span>
              <strong>{settingsSurfaceCopy.saveError}</strong>
              <p>방금 시도한 변경만 다시 보내면 됩니다. 기존 기본값은 바뀌지 않았습니다.</p>
            </div>
            <button
              type="button"
              className="soft-button"
              disabled={!lastFailedPatch || isSaving}
              onClick={() => {
                void retryLastFailedPatch();
              }}
            >
              {settingsSurfaceCopy.retryLabel}
            </button>
          </section>
        ) : null}
      </div>

      {showSettingsControls ? (
        <div className="settings-layout">
          <div className="settings-main-column">
            <article className="panel settings-group-card">
              <div className="panel-header panel-header-stack">
                <div>
                  <span className="panel-kicker">기본 실행</span>
                  <h3>{settingsSurfaceCopy.executionTitle}</h3>
                  <p>{settingsSurfaceCopy.executionBody}</p>
                </div>
              </div>

              <SettingsChoiceGroup
                label="기본 모델"
                currentValue={visibleSettings.defaultModel}
                disabled={controlsDisabled}
                options={modelOptions}
                onSelect={(value) => {
                  handleSelection('defaultModel', value as AppSettings['defaultModel']);
                }}
              />

              <SettingsChoiceGroup
                label="최적화 모드"
                currentValue={visibleSettings.optimizationMode}
                disabled={controlsDisabled}
                options={optimizationModeOptions}
                onSelect={(value) => {
                  handleSelection('optimizationMode', value as AppSettings['optimizationMode']);
                }}
              />
            </article>

            <article className="panel settings-group-card">
              <div className="panel-header panel-header-stack">
                <div>
                  <span className="panel-kicker">응답과 보기</span>
                  <h3>{settingsSurfaceCopy.responseTitle}</h3>
                  <p>{settingsSurfaceCopy.responseBody}</p>
                </div>
              </div>

              <SettingsChoiceGroup
                label="응답 언어"
                currentValue={visibleSettings.responseLanguage}
                disabled={controlsDisabled}
                options={responseLanguageOptions}
                onSelect={(value) => {
                  handleSelection('responseLanguage', value as AppSettings['responseLanguage']);
                }}
              />

              <SettingsChoiceGroup
                label="테마"
                currentValue={visibleSettings.theme}
                disabled={controlsDisabled}
                options={themeOptions}
                onSelect={(value) => {
                  handleSelection('theme', value as AppSettings['theme']);
                }}
              />

              <SettingsChoiceGroup
                label="히스토리 고급 보기 기본값"
                currentValue={visibleSettings.advancedPromptPreview}
                disabled={controlsDisabled}
                options={advancedPreviewOptions}
                onSelect={(value) => {
                  handleSelection(
                    'advancedPromptPreview',
                    value as AppSettings['advancedPromptPreview'],
                  );
                }}
              />
            </article>

            <article className="panel settings-group-card">
              <div className="panel-header panel-header-stack">
                <div>
                  <span className="panel-kicker">{settingsConnectionsCopy.providerListKicker}</span>
                  <h3>{settingsConnectionsCopy.title}</h3>
                  <p>{settingsConnectionsCopy.providerListBody}</p>
                </div>
              </div>

              {connectionLoadingWithoutData ? (
                <div className="settings-inline-feedback">
                  <strong>연결 상태를 확인하는 중입니다.</strong>
                  <p>저장된 키와 로컬 엔진 상태를 차례대로 읽고 있습니다.</p>
                </div>
              ) : null}

              {connectionErrorWithoutData ? (
                <div className="settings-inline-feedback settings-inline-feedback-error">
                  <div>
                    <strong>{settingsConnectionsCopy.errorTitle}</strong>
                    <p>{settingsConnectionsCopy.errorBody}</p>
                  </div>
                  <button
                    type="button"
                    className="soft-button"
                    onClick={() => {
                      void refreshConnectionHealth();
                    }}
                  >
                    {settingsConnectionsCopy.refreshLabel}
                  </button>
                </div>
              ) : null}

              {!desktopClient.available ? (
                <div className="settings-inline-feedback">
                  <strong>예시 연결 상태</strong>
                  <p>{settingsConnectionsCopy.previewBody}</p>
                </div>
              ) : null}

              {connectionRefreshing ? (
                <div className="settings-inline-feedback">
                  <strong>연결 상태를 다시 확인하고 있습니다.</strong>
                  <p>현재 기본 모델 제공자와 로컬 엔진 상태를 최신 기준으로 갱신 중입니다.</p>
                </div>
              ) : null}

              {showConnectionControls ? (
                <div className="settings-provider-editor-list">
                  {visibleConnectionHealth.providers.map((item) => (
                    <ProviderKeyEditor
                      key={item.provider}
                      item={item}
                      disabled={!desktopClient.available}
                      mutationState={connectionMutationStates[item.provider]}
                      onDelete={handleDeleteApiKey}
                      onSave={handleSaveApiKey}
                    />
                  ))}
                </div>
              ) : null}
            </article>
          </div>

          <aside className="settings-rail">
            <article className="panel settings-rail-card">
              <div className="panel-header panel-header-stack">
                <div>
                  <span className="panel-kicker">{settingsConnectionsCopy.railKicker}</span>
                  <h3>{settingsConnectionsCopy.title}</h3>
                  <p>{settingsConnectionsCopy.body}</p>
                </div>
                <button
                  type="button"
                  className="soft-button"
                  disabled={!desktopClient.available || connectionQuery.status === 'loading'}
                  onClick={() => {
                    void refreshConnectionHealth();
                  }}
                >
                  {settingsConnectionsCopy.refreshLabel}
                </button>
              </div>

              <div className="settings-connection-brief-grid">
                <ConnectionSummaryCard
                  kicker={settingsConnectionsCopy.selectedProviderKicker}
                  title={selectedProviderSummary.title}
                  statusClassName={selectedProviderSummary.statusClassName}
                  statusLabel={selectedProviderSummary.statusLabel}
                  detail={selectedProviderSummary.detail}
                  guidance={selectedProviderSummary.guidance}
                  meta={selectedProviderSummary.meta}
                />

                <ConnectionSummaryCard
                  kicker={settingsConnectionsCopy.localEngineKicker}
                  title={localEngineSummary.title}
                  statusClassName={localEngineSummary.statusClassName}
                  statusLabel={localEngineSummary.statusLabel}
                  detail={localEngineSummary.detail}
                  guidance={localEngineSummary.guidance}
                  meta={localEngineSummary.meta}
                  warnings={localEngineSummary.warnings}
                />
              </div>
            </article>

            <article className="panel settings-rail-card">
              <div className="panel-header panel-header-stack">
                <div>
                  <span className="panel-kicker">즉시 반영</span>
                  <h3>{settingsSurfaceCopy.effectsTitle}</h3>
                  <p>{settingsSurfaceCopy.effectsBody}</p>
                </div>
              </div>

              <div className="settings-effect-list">
                <div className="settings-effect-row">
                  <strong>현재 테마</strong>
                  <span>{visibleLabels.theme}</span>
                </div>
                <div className="settings-effect-row">
                  <strong>히스토리 기본 보기</strong>
                  <span>{visibleLabels.advancedPromptPreview}</span>
                </div>
                <div className="settings-effect-row">
                  <strong>다음 기본 모델</strong>
                  <span>{visibleLabels.defaultModel}</span>
                </div>
              </div>
            </article>
          </aside>
        </div>
      ) : null}
    </section>
  );
}
