'use strict';

const { app } = require('@azure/functions');
const { randomUUID } = require('node:crypto');
const { validateSubscription } = require('./validation');
const { findSubscription, createSubscription } = require('./cosmos');

function jsonResponse(status, body) {
  return { status, jsonBody: body };
}

async function readJsonBody(request) {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}

app.http('subscriptions', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'subscriptions',
  handler: async (request, context) => {
    const body = await readJsonBody(request);
    if (body === undefined) {
      return jsonResponse(400, { error: 'Request body must be valid JSON.' });
    }

    const result = validateSubscription(body);
    if (!result.valid) {
      return jsonResponse(400, { error: 'Validation failed.', details: result.errors });
    }

    // `rest` carries the optional masked card details (brand, last 4, expiry).
    const { firstName, lastName, email, plan, price, cvv,...rest } = result.value;
    try {
      // Re-subscribing to the same plan is a no-op rather than a duplicate row.
      const existing = await findSubscription(email, plan);
      if (existing) {
        context.log(`Subscription already exists for plan "${plan}"`);
        return jsonResponse(200, {
          id: existing.id,
          plan,
          price,
          createdAt: existing.createdAt,
          alreadySubscribed: true,
        });
      }

      const saved = await createSubscription({
        id: randomUUID(),
        type: 'subscription',
        firstName,
        lastName,
        email,
        plan,
        price,
        cvv,
        ...rest,
        source: 'web',
        createdAt: new Date().toISOString(),
      });

      context.log(`Stored subscription ${saved.id} for plan "${plan}"`);
      return jsonResponse(201, {
        id: saved.id,
        plan,
        price,
        createdAt: saved.createdAt,
        alreadySubscribed: false,
      });
    } catch (error) {
      // Log the failure, never the submitted personal data.
      context.error('Failed to store subscription', error);

      // Temporary diagnostics: only when DEBUG_ERRORS=1 is set as an app
      // setting, so production responses never leak internal details.
      const debug = process.env.DEBUG_ERRORS === '1'
        ? { code: error.code, message: error.message }
        : undefined;

      return jsonResponse(500, {
        error: 'Could not store the subscription. Please try again later.',
        debug,
      });
    }
  },
});
