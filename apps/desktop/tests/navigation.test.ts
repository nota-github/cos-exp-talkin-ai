import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultRoutePath, navigationItems } from '../src/renderer/app/navigation.ts';

test('story-1.1:AC-1 defaults to the Chat route', () => {
  assert.equal(defaultRoutePath, '/');
  assert.equal(navigationItems[0]?.id, 'chat');
  assert.equal(navigationItems[0]?.label, 'Chat');
});

test('story-1.1:AC-2 exposes all required global navigation items', () => {
  assert.deepEqual(
    navigationItems.map((item) => item.label),
    ['Chat', 'Workbench', 'Projects', 'Usage', 'Settings'],
  );
});
