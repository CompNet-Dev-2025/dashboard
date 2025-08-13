import { test } from 'node:test';
import assert from 'node:assert';
import request from 'supertest';

process.env.NODE_ENV = 'test';
const { default: app } = await import('../src/server.js');

test('user creation and login', async () => {
  const email = 'hassan.ahmed@torontomu.ca';
  let res = await request(app).post('/api/users').send({ email });
  assert.strictEqual(res.statusCode, 200);
  assert.ok(res.body.username);

  res = await request(app)
    .post('/api/login')
    .send({ email, password: 'CompNet1234' });
  assert.strictEqual(res.statusCode, 200);
  assert.ok(res.body.token);
});
