import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultRoutePath, navigationItems } from '../src/renderer/app/navigation.ts';

test('story-1.1:AC-1 defaults to the Chat route', () => {
  assert.equal(defaultRoutePath, '/');
  assert.equal(navigationItems[0]?.id, 'chat');
  assert.equal(navigationItems[0]?.label, '채팅');
});

test('story-1.1:AC-2 exposes all required global navigation items', () => {
  assert.deepEqual(
    navigationItems.map((item) => item.label),
    ['채팅', '작업대', '프로젝트', '사용량', '설정'],
  );
});
