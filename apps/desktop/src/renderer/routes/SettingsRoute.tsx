import type { AppSettings } from '../../shared/ipc/contracts';
import { useRendererSettings } from '../app/renderer-settings';
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

  const controlsDisabled = isSaving || !desktopAvailable;
  const heroState = getSettingsHeroState({
    surfaceState,
    settings,
  });
  const visibleSettings = settings ?? previewAppSettings;
  const visibleLabels = getAppSettingsLabels(visibleSettings);
  const showSettingsControls = shouldRenderSettingsControls(surfaceState);

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
                  handleSelection('advancedPromptPreview', value as AppSettings['advancedPromptPreview']);
                }}
              />
            </article>
          </div>

          <aside className="settings-rail">
            <article className="panel settings-rail-card">
              <div className="panel-header panel-header-stack">
                <div>
                  <span className="panel-kicker">API 키 맥락</span>
                  <h3>{settingsSurfaceCopy.connectionsTitle}</h3>
                  <p>{settingsSurfaceCopy.connectionsBody}</p>
                </div>
              </div>

              <div className="settings-provider-list">
                <div className="settings-provider-row">
                  <strong>OpenAI</strong>
                  <span className="badge badge-muted">연결 설정 대기</span>
                </div>
                <div className="settings-provider-row">
                  <strong>Anthropic</strong>
                  <span className="badge badge-muted">연결 설정 대기</span>
                </div>
                <div className="settings-provider-row">
                  <strong>Google</strong>
                  <span className="badge badge-muted">연결 설정 대기</span>
                </div>
              </div>

              <span className="badge badge-primary">{settingsSurfaceCopy.apiKeyDeferredLabel}</span>
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
