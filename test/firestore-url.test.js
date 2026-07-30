const test = require('node:test');
const assert = require('node:assert');

function freshModule() {
  delete require.cache[require.resolve('../firestore-rest')];
  return require('../firestore-rest');
}

test('documentUrl targets the emulator when FIRESTORE_EMULATOR_HOST is set', () => {
  process.env.GOOGLE_CLOUD_PROJECT = 'pripay-dev';
  process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8090';
  const { documentUrl } = freshModule();
  assert.strictEqual(
    documentUrl('kv/pripay:vk:0xabc'),
    'http://127.0.0.1:8090/v1/projects/pripay-dev/databases/(default)/documents/kv/pripay:vk:0xabc'
  );
});

test('documentUrl targets prod Firestore when the emulator host is absent', () => {
  process.env.GOOGLE_CLOUD_PROJECT = 'pripay-prod';
  delete process.env.FIRESTORE_EMULATOR_HOST;
  const { documentUrl } = freshModule();
  assert.strictEqual(
    documentUrl('wallets/0xabc/orders/o1'),
    'https://firestore.googleapis.com/v1/projects/pripay-prod/databases/(default)/documents/wallets/0xabc/orders/o1'
  );
});

test('usingEmulator reflects the env var', () => {
  process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8090';
  assert.strictEqual(freshModule().usingEmulator(), true);
  delete process.env.FIRESTORE_EMULATOR_HOST;
  assert.strictEqual(freshModule().usingEmulator(), false);
});
