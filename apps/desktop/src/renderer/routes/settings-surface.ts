import type {
  AppSettings,
  CloudModelId,
  OptimizationMode,
  UpdateSettingsResult,
} from '../../shared/ipc/contracts';

export const previewAppSettings: AppSettings = {
  defaultModel: 'gpt-4.1',
  optimizationMode: 'balanced',
  responseLanguage: 'ko',
  theme: 'system',
  advancedPromptPreview: false,
};

export const settingsSurfaceCopy = {
  kicker: 'Settings',
  headline: '기본 실행 기준과 보기 방식을 한 화면에서 맞춥니다',
  intro:
    '대화는 계속 한국어로 진행하고, 기본 모델과 로컬 최적화 기준, 응답 언어, 표시 방식을 이 화면에서 정리합니다.',
  heroTitle: '현재 기본 작업 기준',
  heroBody:
    '여기서 고른 기본값은 다음 채팅, 히스토리 확인, 화면 표시 방식에 바로 이어집니다.',
  executionTitle: '기본 실행 기준',
  executionBody:
    '새 요청을 시작할 때 먼저 적용할 기본 모델과 로컬 최적화 기준을 정합니다.',
  responseTitle: '응답과 보기',
  responseBody:
    '읽는 언어, 화면 톤, 히스토리의 고급 영어 프롬프트 기본 표시 여부를 함께 맞춥니다.',
  connectionsTitle: '보안 연결',
  connectionsBody:
    'API 키 입력과 연결 점검은 다음 단계에서 다룹니다. 이 화면에서는 어떤 기본값이 실제 실행에 쓰이는지만 먼저 분명히 보여줍니다.',
  effectsTitle: '즉시 반영 항목',
  effectsBody:
    '테마는 저장 직후 작업 공간에 반영되고, 고급 보기 기본값은 사용량 히스토리의 펼침 상태에 바로 연결됩니다.',
  loadingTitle: '설정을 불러오는 중입니다',
  loadingBody:
    '저장된 기본 모델과 표시 방식을 읽는 동안 기존 작업은 유지됩니다.',
  errorTitle: '설정을 읽지 못했습니다',
  errorBody:
    '기존에 저장된 기본값은 그대로 남아 있습니다. 잠시 후 다시 열어 보거나 앱을 다시 시도해 주세요.',
  emptyTitle: '아직 보여줄 설정 데이터가 없습니다',
  emptyBody:
    '기본값을 만들 준비는 끝났지만, 저장된 설정을 아직 읽지 못했습니다. 잠시 후 다시 확인해 주세요.',
  previewTitle: '미리보기 기본값',
  previewBody:
    '지금은 데스크탑 연결 없이 예시 기본값을 보여주고 있습니다. 실제 앱에서는 이 자리에서 바로 저장됩니다.',
  savingMessage: '설정을 저장하는 중입니다.',
  saveSuccess: '기본 작업 기준을 저장했습니다.',
  saveError:
    '설정을 저장하지 못했습니다. 기존 기본값은 그대로 유지되어 있습니다. 다시 시도해 주세요.',
  retryLabel: '같은 변경 다시 시도',
  apiKeyDeferredLabel: 'API 키 연결은 다음 스토리에서 이어집니다',
  advancedOnLabel: '히스토리에서 영어 프롬프트를 기본으로 펼쳐 보기',
  advancedOffLabel: '히스토리에서는 최종 한국어 답변만 먼저 보기',
};

export const modelOptions: Array<{
  value: CloudModelId;
  label: string;
  description: string;
}> = [
  {
    value: 'gpt-4.1',
    label: 'GPT-4.1',
    description: '균형 잡힌 기본 응답과 넓은 범용 작업에 맞춥니다.',
  },
  {
    value: 'claude-sonnet-4',
    label: 'Claude Sonnet 4',
    description: '정리형 문서와 구조화된 응답을 자주 다루는 작업에 맞춥니다.',
  },
  {
    value: 'gemini-1.5-pro',
    label: 'Gemini 1.5 Pro',
    description: '긴 문맥과 장문 자료를 자주 다루는 작업 기준으로 둡니다.',
  },
];

export const optimizationModeOptions: Array<{
  value: OptimizationMode;
  label: string;
  description: string;
}> = [
  {
    value: 'balanced',
    label: '기본',
    description: '의도 보존과 절감 균형을 기본값으로 둡니다.',
  },
  {
    value: 'savings',
    label: '절감 우선',
    description: '더 짧고 압축된 영어 흐름을 우선합니다.',
  },
  {
    value: 'quality',
    label: '품질 우선',
    description: '표현 정확도와 조건 보존을 먼저 지킵니다.',
  },
  {
    value: 'long_context',
    label: '긴 컨텍스트',
    description: '장문 대화와 문서 작업 기준으로 프롬프트를 정리합니다.',
  },
];

export const responseLanguageOptions = [
  {
    value: 'ko',
    label: '한국어로 받기',
    description: '복원된 최종 답변을 바로 읽을 수 있는 기본 흐름입니다.',
  },
  {
    value: 'en',
    label: '영어로 받기',
    description: '영문 응답을 그대로 검토해야 하는 작업에 맞춥니다.',
  },
] as const;

export const themeOptions = [
  {
    value: 'light',
    label: '라이트',
    description: '화이트 기반 작업 화면을 고정합니다.',
  },
  {
    value: 'dark',
    label: '다크',
    description: '어두운 배경 기준으로 작업 공간을 바꿉니다.',
  },
  {
    value: 'system',
    label: '시스템',
    description: 'OS 테마에 맞춰 작업 화면을 따릅니다.',
  },
] as const;

export const advancedPreviewOptions = [
  {
    value: false,
    label: '최종 답변 우선',
    description: '히스토리에서 최종 한국어 답변을 먼저 보고, 영어 artifact는 필요할 때만 펼칩니다.',
  },
  {
    value: true,
    label: '고급 보기 기본 열기',
    description: '히스토리에서 최적화 영어 프롬프트와 클라우드 영어 응답을 기본으로 펼칩니다.',
  },
] as const;

export type SettingsSurfaceState = 'preview' | 'loading' | 'error' | 'empty' | 'ready';
export type SettingsHeroTone = 'active' | 'preview' | 'pending' | 'warning';

export type SettingsSaveState = {
  status: 'idle' | 'saving' | 'success' | 'error';
  message: string | null;
  changedKeys: Array<keyof AppSettings>;
};

export type ThemeApplicationTarget = {
  dataset: {
    theme?: string;
  };
  style: {
    colorScheme?: string;
  };
};

export type SettingsHeroBadge = {
  tone: 'primary' | 'muted' | 'success';
  label: string;
};

export type SettingsHeroState = {
  body: string;
  badges: SettingsHeroBadge[];
  kicker: string;
  tone: SettingsHeroTone;
  value: string;
};

const settingKeyLabels: Record<keyof AppSettings, string> = {
  defaultModel: '기본 모델',
  optimizationMode: '최적화 모드',
  responseLanguage: '응답 언어',
  theme: '테마',
  advancedPromptPreview: '히스토리 고급 보기',
};

function findLabeledValue<TValue extends string | boolean>(
  options: ReadonlyArray<{
    value: TValue;
    label: string;
  }>,
  value: TValue,
) {
  return options.find((option) => option.value === value)?.label ?? String(value);
}

export function getAppSettingsLabels(settings: AppSettings) {
  return {
    defaultModel: findLabeledValue(modelOptions, settings.defaultModel),
    optimizationMode: findLabeledValue(optimizationModeOptions, settings.optimizationMode),
    responseLanguage: findLabeledValue(responseLanguageOptions, settings.responseLanguage),
    theme: findLabeledValue(themeOptions, settings.theme),
    advancedPromptPreview: settings.advancedPromptPreview
      ? settingsSurfaceCopy.advancedOnLabel
      : settingsSurfaceCopy.advancedOffLabel,
  };
}

export function getSettingsSurfaceState(input: {
  desktopAvailable: boolean;
  status: 'idle' | 'loading' | 'success' | 'error';
  hasData: boolean;
}): SettingsSurfaceState {
  if (!input.desktopAvailable) {
    return 'preview';
  }

  if (!input.hasData && (input.status === 'idle' || input.status === 'loading')) {
    return 'loading';
  }

  if (!input.hasData && input.status === 'error') {
    return 'error';
  }

  if (!input.hasData) {
    return 'empty';
  }

  return 'ready';
}

export function getSettingsChangeSummary(updatedKeys: Array<keyof AppSettings>) {
  if (updatedKeys.length === 0) {
    return settingsSurfaceCopy.saveSuccess;
  }

  return `${settingsSurfaceCopy.saveSuccess} ${updatedKeys
    .map((key) => settingKeyLabels[key])
    .join(', ')} 기준을 새 기본값으로 썼습니다.`;
}

export function getHistoryDefaultVisibility(advancedPromptPreview: boolean) {
  return {
    showOptimizedPrompt: advancedPromptPreview,
    showProviderResponse: advancedPromptPreview,
  };
}

export function shouldRenderSettingsControls(surfaceState: SettingsSurfaceState) {
  return surfaceState === 'ready' || surfaceState === 'preview';
}

export function getSettingsHeroState(input: {
  settings: AppSettings | null;
  surfaceState: SettingsSurfaceState;
}): SettingsHeroState {
  if (input.surfaceState === 'loading') {
    return {
      kicker: '저장된 기본값 확인 중',
      value: '불러오는 중',
      body: settingsSurfaceCopy.loadingBody,
      tone: 'pending',
      badges: [
        {
          tone: 'muted',
          label: '저장값 읽는 중',
        },
        {
          tone: 'primary',
          label: '잠시 후 다시 선택 가능',
        },
      ],
    };
  }

  if (input.surfaceState === 'error') {
    return {
      kicker: '저장값 확인 필요',
      value: '읽기 실패',
      body: settingsSurfaceCopy.errorBody,
      tone: 'warning',
      badges: [
        {
          tone: 'muted',
          label: '기존 저장값 유지',
        },
        {
          tone: 'primary',
          label: '잠시 후 다시 열기',
        },
      ],
    };
  }

  if (input.surfaceState === 'empty') {
    return {
      kicker: '저장값 준비 전',
      value: '첫 기본값 저장 전',
      body: settingsSurfaceCopy.emptyBody,
      tone: 'pending',
      badges: [
        {
          tone: 'muted',
          label: '저장된 기준 없음',
        },
        {
          tone: 'primary',
          label: '연결 후 바로 설정 가능',
        },
      ],
    };
  }

  const resolvedSettings = input.settings ?? previewAppSettings;
  const labels = getAppSettingsLabels(resolvedSettings);

  if (input.surfaceState === 'preview') {
    return {
      kicker: settingsSurfaceCopy.previewTitle,
      value: labels.defaultModel,
      body: settingsSurfaceCopy.previewBody,
      tone: 'preview',
      badges: [
        {
          tone: 'primary',
          label: labels.optimizationMode,
        },
        {
          tone: 'muted',
          label: labels.responseLanguage,
        },
        {
          tone: 'muted',
          label: labels.theme,
        },
        {
          tone: 'success',
          label: '예시 기본값',
        },
      ],
    };
  }

  return {
    kicker: settingsSurfaceCopy.heroTitle,
    value: labels.defaultModel,
    body: settingsSurfaceCopy.heroBody,
    tone: 'active',
    badges: [
      {
        tone: 'primary',
        label: labels.optimizationMode,
      },
      {
        tone: 'muted',
        label: labels.responseLanguage,
      },
      {
        tone: 'muted',
        label: labels.theme,
      },
      {
        tone: 'success',
        label: labels.advancedPromptPreview,
      },
    ],
  };
}

export function areAppSettingsEqual(left: AppSettings, right: AppSettings) {
  return (
    left.defaultModel === right.defaultModel &&
    left.optimizationMode === right.optimizationMode &&
    left.responseLanguage === right.responseLanguage &&
    left.theme === right.theme &&
    left.advancedPromptPreview === right.advancedPromptPreview
  );
}

export function applyThemePreference(
  target: ThemeApplicationTarget,
  theme: AppSettings['theme'],
) {
  target.dataset.theme = theme;
  target.style.colorScheme = theme === 'system' ? 'light dark' : theme;
}

export async function submitSettingsPatch(input: {
  patch: Partial<AppSettings>;
  updateSettings: (patch: Partial<AppSettings>) => Promise<UpdateSettingsResult>;
}): Promise<{
  settings: AppSettings | null;
  failedPatch: Partial<AppSettings> | null;
  saveState: SettingsSaveState;
}> {
  try {
    const result = await input.updateSettings(input.patch);

    return {
      settings: result.settings,
      failedPatch: null,
      saveState: {
        status: 'success',
        message: getSettingsChangeSummary(result.updatedKeys),
        changedKeys: result.updatedKeys,
      },
    };
  } catch {
    return {
      settings: null,
      failedPatch: input.patch,
      saveState: {
        status: 'error',
        message: settingsSurfaceCopy.saveError,
        changedKeys: [],
      },
    };
  }
}
