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
    label: 'Chat',
    path: '/',
    eyebrow: 'Inbox',
    summary: '한국어로 바로 시작하는 채팅형 인박스',
  },
  {
    id: 'workbench',
    label: 'Workbench',
    path: '/workbench',
    eyebrow: 'Split View',
    summary: '여러 AI 작업을 동시에 관리하는 멀티채팅 작업대',
  },
  {
    id: 'projects',
    label: 'Projects',
    path: '/projects',
    eyebrow: 'Portfolio',
    summary: '장기 작업과 관련 자산을 프로젝트 단위로 정리',
  },
  {
    id: 'usage',
    label: 'Usage',
    path: '/usage',
    eyebrow: 'Savings',
    summary: '토큰 절감 근거와 히스토리를 확인하는 대시보드',
  },
  {
    id: 'settings',
    label: 'Settings',
    path: '/settings',
    eyebrow: 'Controls',
    summary: '로컬 최적화 엔진과 기본 모델 설정을 다루는 환경 화면',
  },
];

export const defaultRoutePath = navigationItems[0].path;
