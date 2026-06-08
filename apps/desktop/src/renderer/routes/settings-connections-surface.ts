import type {
  ConnectionHealthResult,
  ConnectionState,
  ProviderId,
} from '../../shared/ipc/contracts';

export const settingsConnectionsCopy = {
  railKicker: '보안 연결',
  title: 'API 키와 로컬 엔진 상태를 같은 작업 흐름에서 관리합니다',
  body:
    '현재 기본 모델이 쓰는 제공자 연결과 로컬 최적화 엔진 상태를 먼저 확인하고, 필요한 키만 바로 수정하세요.',
  refreshLabel: '연결 다시 확인',
  previewBody:
    '지금은 데스크탑 연결 없이 예시 상태를 보여주고 있습니다. 실제 앱에서는 이 자리에서 바로 저장하고 확인할 수 있습니다.',
  errorTitle: '연결 상태를 읽지 못했습니다',
  errorBody:
    '기존 작업은 그대로 유지됩니다. 잠시 후 다시 확인하거나 앱을 다시 열어 보세요.',
  selectedProviderKicker: '현재 기본 모델 연결',
  localEngineKicker: '로컬 최적화 엔진',
  providerListKicker: '제공자별 키 관리',
  providerListBody:
    '다른 제공자 키도 미리 저장할 수 있지만, 자동 연결 점검은 현재 기본 모델의 제공자에 먼저 집중합니다.',
  inputPlaceholder: '새 API 키를 붙여넣고 저장',
  saveLabel: '저장',
  deleteLabel: '삭제',
  emptyInputMessage: '키를 입력한 뒤 저장하세요. 제거하려면 삭제를 사용하세요.',
  saveError:
    '키를 저장하지 못했습니다. 입력값과 키체인 접근 권한을 확인한 뒤 다시 시도하세요.',
  deleteError:
    '저장된 키를 지우지 못했습니다. 잠시 후 다시 시도하거나 앱 권한 상태를 확인하세요.',
};

export const previewConnectionHealth: ConnectionHealthResult = {
  selectedProvider: 'openai',
  selectedModel: 'gpt-4.1',
  providers: [
    {
      provider: 'openai',
      label: 'OpenAI',
      defaultModel: 'gpt-4.1',
      isSelected: true,
      hasStoredKey: false,
      maskedKeyPreview: null,
      lastCheckedAt: null,
      status: {
        state: 'setup_required',
        label: '설정 필요',
        summary: 'OpenAI API 키가 아직 저장되지 않았습니다.',
        guidance: '키를 붙여넣고 저장하면 다음 요청부터 바로 이 연결을 사용할 수 있습니다.',
      },
    },
    {
      provider: 'anthropic',
      label: 'Anthropic',
      defaultModel: 'claude-sonnet-4',
      isSelected: false,
      hasStoredKey: false,
      maskedKeyPreview: null,
      lastCheckedAt: null,
      status: {
        state: 'setup_required',
        label: '설정 필요',
        summary: 'Anthropic API 키가 아직 저장되지 않았습니다.',
        guidance: '필요할 때 저장해 두면 기본 모델을 바꾼 뒤 바로 사용할 수 있습니다.',
      },
    },
    {
      provider: 'google',
      label: 'Google AI',
      defaultModel: 'gemini-1.5-pro',
      isSelected: false,
      hasStoredKey: false,
      maskedKeyPreview: null,
      lastCheckedAt: null,
      status: {
        state: 'setup_required',
        label: '설정 필요',
        summary: 'Google AI API 키가 아직 저장되지 않았습니다.',
        guidance: 'Gemini를 기본 모델로 쓰려면 이 키를 저장하세요.',
      },
    },
  ],
  localEngine: {
    engineId: 'translation-mcp',
    label: '로컬 최적화 엔진',
    transport: 'unknown',
    lastCheckedAt: null,
    warnings: [],
    status: {
      state: 'needs_attention',
      label: '확인 필요',
      summary: '로컬 최적화 엔진 연결 구성이 아직 준비되지 않았습니다.',
      guidance: '실제 앱에서는 translation MCP가 실행되면 이 자리에서 바로 상태를 보여줍니다.',
    },
  },
};

export function getConnectionBadgeClass(state: ConnectionState) {
  if (state === 'connected') {
    return 'badge badge-success';
  }

  if (state === 'setup_required') {
    return 'badge badge-muted';
  }

  return 'badge badge-primary';
}

export function getProviderMutationSuccessMessage(input: {
  provider: ProviderId;
  providerLabel: string;
  action: 'save' | 'delete';
}) {
  if (input.action === 'delete') {
    return `${input.providerLabel} 저장 키를 지웠습니다. ${input.provider === 'openai' ? '다음 요청에는 OpenAI 연결이 비어 있는 상태로 남습니다.' : '필요할 때 다시 저장할 수 있습니다.'}`;
  }

  return `${input.providerLabel} 키를 저장했습니다. 현재 기본 모델이 이 제공자를 쓰고 있다면 연결 상태가 곧 다시 확인됩니다.`;
}
