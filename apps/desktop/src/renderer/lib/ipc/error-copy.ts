export type DesktopSafeErrorCopy = {
  primary: string;
  diagnostic: string | null;
};

function normalizeErrorMessage(error: unknown) {
  if (!(error instanceof Error)) {
    return null;
  }

  const message = error.message.trim();
  return message.length > 0 ? message : null;
}

export function getSafeDesktopErrorCopy(
  error: unknown,
  fallbackPrimary: string,
): DesktopSafeErrorCopy {
  const diagnostic = normalizeErrorMessage(error);

  if (!diagnostic) {
    return {
      primary: fallbackPrimary,
      diagnostic: null,
    };
  }

  if (
    /desktop bridge is unavailable/i.test(diagnostic) ||
    /cannot access .* in this renderer context/i.test(diagnostic)
  ) {
    return {
      primary:
        '데스크탑 연결이 아직 준비되지 않았습니다. 앱 창을 다시 열거나 잠시 후 다시 시도해 주세요.',
      diagnostic,
    };
  }

  if (/unknown (task|project|run)/i.test(diagnostic)) {
    return {
      primary:
        '방금 보던 작업 정보를 다시 찾지 못했습니다. 목록을 다시 불러와 최신 상태를 확인해 주세요.',
      diagnostic,
    };
  }

  if (/timed out|timeout/i.test(diagnostic)) {
    return {
      primary: '동기화 응답이 늦어지고 있습니다. 잠시 후 다시 시도해 주세요.',
      diagnostic,
    };
  }

  return {
    primary: fallbackPrimary,
    diagnostic,
  };
}

export function getSafeDesktopActionErrorMessage(
  error: unknown,
  fallbackPrimary: string,
) {
  return getSafeDesktopErrorCopy(error, fallbackPrimary).primary;
}
