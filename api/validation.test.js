'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { validateSubscription, PLANS } = require('./validation');

const validBody = {
  firstName: 'Ada',
  lastName: 'Lovelace',
  email: 'Ada@Example.com',
  plan: 'Individual',
};

test('accepts a valid payload and normalises the email', () => {
  const result = validateSubscription(validBody);

  assert.equal(result.valid, true);
  assert.equal(result.value.email, 'ada@example.com');
  assert.equal(result.value.firstName, 'Ada');
});

test('derives the price on the server and ignores a client-supplied one', () => {
  const result = validateSubscription({ ...validBody, price: '1 RS/month' });

  assert.equal(result.valid, true);
  assert.equal(result.value.price, PLANS.Individual);
});

test('rejects any request carrying card data', () => {
  for (const field of ['cardNumber', 'expiryDate', 'cvv']) {
    const result = validateSubscription({ ...validBody, [field]: '4111111111111111' });

    assert.equal(result.valid, false);
    assert.equal(result.errors[0].field, field);
    assert.match(result.errors[0].message, /never be sent/);
  }
});

test('rejects an unknown plan', () => {
  const result = validateSubscription({ ...validBody, plan: 'Platinum' });

  assert.equal(result.valid, false);
  assert.equal(result.errors[0].field, 'plan');
});

test('rejects malformed email addresses', () => {
  for (const email of ['not-an-email', 'missing@domain', 'spaces in@mail.com', '']) {
    const result = validateSubscription({ ...validBody, email });

    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.field === 'email'));
  }
});

test('rejects missing or oversized names', () => {
  const missing = validateSubscription({ ...validBody, firstName: '   ' });
  assert.equal(missing.valid, false);
  assert.ok(missing.errors.some((e) => e.field === 'firstName'));

  const oversized = validateSubscription({ ...validBody, lastName: 'x'.repeat(81) });
  assert.equal(oversized.valid, false);
  assert.ok(oversized.errors.some((e) => e.field === 'lastName'));
});

test('rejects non-object bodies', () => {
  for (const body of [null, 'string', 42, ['array']]) {
    const result = validateSubscription(body);

    assert.equal(result.valid, false);
    assert.equal(result.errors[0].field, 'body');
  }
});

test('reports every invalid field at once', () => {
  const result = validateSubscription({ firstName: '', lastName: '', email: 'nope', plan: '' });

  assert.equal(result.valid, false);
  assert.equal(result.errors.length, 4);
});
