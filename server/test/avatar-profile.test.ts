import assert from 'node:assert/strict';
import { test } from 'node:test';
import { profileAvatars } from '../src/avatar-profile.js';

test('Clerk Google provider image precedes a different Clerk profile image', () => {
  assert.deepEqual(profileAvatars({
    externalAccounts: [{ provider: 'google', imageUrl: 'https://google.example/avatar' }],
    hasImage: true, imageUrl: 'https://clerk.example/avatar',
  }), { imageUrl: 'https://google.example/avatar', fallbackImageUrl: 'https://clerk.example/avatar' });
});
test('other Clerk avatars are used when Google has no image', () => {
  assert.deepEqual(profileAvatars({
    externalAccounts: [{ provider: 'google' }], hasImage: true, imageUrl: 'https://clerk.example/avatar',
  }), { imageUrl: 'https://clerk.example/avatar', fallbackImageUrl: null });
});
test('Clerk generated initials do not replace the local fallback', () => {
  assert.deepEqual(profileAvatars({ externalAccounts: [], hasImage: false, imageUrl: 'https://clerk.example/initials' }),
    { imageUrl: null, fallbackImageUrl: null });
});
test('the same image is not retried as a fallback', () => {
  assert.deepEqual(profileAvatars({
    externalAccounts: [{ provider: 'google', imageUrl: 'https://example.com/avatar' }],
    hasImage: true, imageUrl: 'https://example.com/avatar',
  }), { imageUrl: 'https://example.com/avatar', fallbackImageUrl: null });
});
