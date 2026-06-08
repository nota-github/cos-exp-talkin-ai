export type NavigationItem = {
  id: 'chat' | 'workbench' | 'projects' | 'usage' | 'settings';
  label: string;
  path: string;
  eyebrow: string;
  summary: string;
};

export const navigationItems: NavigationItem[] = [
  {
    id: 'chat',
    label: '채팅',
    path: '/',
    eyebrow: '인박스',
    summary: '한국어로 바로 시작하는 채팅형 인박스',
  },
  {
    id: 'workbench',
    label: '작업대',
    path: '/workbench',
    eyebrow: '분할 작업',
    summary: '여러 AI 작업을 동시에 관리하는 멀티채팅 작업대',
  },
  {
    id: 'projects',
    label: '프로젝트',
    path: '/projects',
    eyebrow: '흐름 보드',
    summary: '칸반 흐름과 장기 작업 묶음을 함께 관리',
  },
  {
    id: 'usage',
    label: '사용량',
    path: '/usage',
    eyebrow: '절감 근거',
    summary: '토큰 절감 근거와 히스토리를 확인하는 대시보드',
  },
  {
    id: 'settings',
    label: '설정',
    path: '/settings',
    eyebrow: '환경',
    summary: '로컬 최적화 엔진과 기본 모델 설정을 다루는 환경 화면',
  },
];

export const defaultRoutePath = navigationItems[0].path;
