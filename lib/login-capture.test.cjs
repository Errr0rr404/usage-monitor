const test = require('node:test');
const assert = require('node:assert/strict');
const { pickClaude, pickGrok, pickCodex, pickBearer, pickStoredSecret, loginUrl } = require('./login-capture.cjs');

test('claude login is the sessionKey cookie', () => {
  assert.equal(pickClaude([{ name: 'sessionKey', value: 'sk-ant-sid-1' }]).secret, 'sk-ant-sid-1');
  assert.equal(pickClaude([{ name: 'sessionKey', value: 'nope' }]), null);
});

test('grok login keeps the sso cookies', () => {
  const picked = pickGrok([
    { name: 'sso', value: 'aaa' },
    { name: 'sso-rw', value: 'bbb' },
    { name: 'cf_clearance', value: 'skip' },
  ]);
  assert.equal(picked.secret, 'sso=aaa; sso-rw=bbb');
  assert.equal(pickGrok([{ name: 'other', value: 'x' }]), null);
});

test('codex login reads the browser session token', () => {
  const picked = pickCodex({
    accessToken: 'eyJhbGciOiJub25lIn0.eyJzdWIiOiIxIn0.sig',
    user: { email: 'ada@example.com', id: 'user_1' },
    account: { id: 'acct_1' },
  });
  assert.equal(picked.email, 'ada@example.com');
  assert.equal(picked.accountId, 'acct_1');
  assert.equal(pickCodex({}), null);
});

test('minimax login accepts a bearer or a stored key', () => {
  assert.equal(pickBearer('Bearer subscription-key-1234567890'), 'subscription-key-1234567890');
  assert.equal(pickBearer('short'), null);
  assert.equal(pickStoredSecret([['api_key', 'subscription-key-1234567890']]), 'subscription-key-1234567890');
  assert.equal(pickStoredSecret([['blob', '{"access_token":"subscription-key-1234567890"}']]), 'subscription-key-1234567890');
});

test('a stored object without a token field is never taken as the key', () => {
  assert.equal(pickStoredSecret([['settings', '{"theme":"dark","language":"en-US"}']]), null);
  assert.equal(pickStoredSecret([['access_token_meta', '{"expires":1791158400,"scope":"coding_plan"}']]), null);
  assert.equal(pickStoredSecret([
    ['settings', '{"theme":"dark","language":"en-US"}'],
    ['session', '{"token":"subscription-key-1234567890"}'],
  ]), 'subscription-key-1234567890');
});

test('each service opens its own site', () => {
  assert.equal(loginUrl('claude'), 'https://claude.ai/login');
  assert.equal(loginUrl('codex'), 'https://chatgpt.com/');
  assert.equal(loginUrl('grok'), 'https://grok.com/');
  assert.equal(loginUrl('minimax', 'cn'), 'https://platform.minimaxi.com/');
});
