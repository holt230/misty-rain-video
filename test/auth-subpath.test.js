import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { AuthService } from '../server/auth.js';

function service(t) {
  fs.mkdirSync('.local-runtime/tests', { recursive: true });
  const directory = fs.mkdtempSync('.local-runtime/tests/auth-subpath-');
  const previous = process.env.APP_USERS_JSON;
  process.env.APP_USERS_JSON = JSON.stringify([{ username: 'test', password: 'fixture-only', role: 'user', folder: 'test' }]);
  t.after(() => {
    if (previous === undefined) delete process.env.APP_USERS_JSON; else process.env.APP_USERS_JSON = previous;
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const auth = new AuthService(directory);
  const { token } = auth.login({ headers: { host: 'localhost' } }, 'test', 'fixture-only');
  return { auth, token };
}
test('subpath session wins over a stale root cookie with the same name', t => {
  const { auth, token } = service(t);
  const request = { headers: { cookie: 'other=value; misty_rain_session=' + token + '; misty_rain_session=stale-root', 'x-forwarded-prefix': '/misty-rain' } };
  assert.equal(auth.authenticate(request).username, 'test');
});
test('an invalid specific-path session does not fall through to a different valid root session', t => {
  const { auth, token } = service(t);
  const request = { headers: { cookie: 'misty_rain_session=invalid-specific; misty_rain_session=' + token, 'x-forwarded-prefix': '/misty-rain' } };
  assert.equal(auth.authenticate(request, false), null);
  assert.throws(() => auth.authenticate(request), error => error.code === 'APP_AUTH_REQUIRED');
});
