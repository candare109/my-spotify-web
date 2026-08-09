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

const maskedCard = {
  cardBrand: 'Visa',
  cardLast4: '4242',
  cardExpiryMonth: 11,
  cardExpiryYear: new Date().getFullYear() + 2,
};

// test('stores masked card details when they are supplied', () => {
//   const result = validateSubscription({ ...validBody, ...maskedCard });

//   assert.equal(result.valid, true);
//   assert.equal(result.value.cardBrand, 'Visa');
//   assert.equal(result.value.cardLast4, '4242');
//   assert.equal(result.value.cardExpiryMonth, 11);
//   assert.equal(result.value.cardExpiryYear, maskedCard.cardExpiryYear);
// });

// test('never stores a full card number or CVV alongside the masked details', () => {
//   const result = validateSubscription({ ...validBody, ...maskedCard });

//   assert.equal(result.valid, true);
//   for (const field of ['cardNumber', 'cvv', 'cvc', 'expiryDate']) {
//     assert.equal(result.value[field], undefined);
//   }
// });

test('treats masked card details as optional', () => {
  const result = validateSubscription(validBody);

  assert.equal(result.valid, true);
  assert.equal(result.value.cardLast4, undefined);
});

test('rejects a last4 that is not exactly four digits', () => {
  for (const cardLast4 of ['424', '42424', 'abcd', '']) {
    const result = validateSubscription({ ...validBody, ...maskedCard, cardLast4 });

    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.field === 'cardLast4'));
  }
});

test('rejects an out-of-range expiry month', () => {
  for (const cardExpiryMonth of [0, 13, 'ten']) {
    const result = validateSubscription({ ...validBody, ...maskedCard, cardExpiryMonth });

    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.field === 'cardExpiryMonth'));
  }
});

test('rejects a card whose expiry month has already passed', () => {
  const lastMonth = new Date();
  lastMonth.setMonth(lastMonth.getMonth() - 1);

  const result = validateSubscription({
    ...validBody,
    ...maskedCard,
    cardExpiryMonth: lastMonth.getMonth() + 1,
    cardExpiryYear: lastMonth.getFullYear(),
  });

  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => /expired/.test(e.message)));
});

test('rejects an unrecognised card brand', () => {
  const result = validateSubscription({ ...validBody, ...maskedCard, cardBrand: 'MyBank' });

  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.field === 'cardBrand'));
});
