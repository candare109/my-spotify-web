'use strict';

/**
 * Server-side validation for subscription requests.
 *
 * The browser runs equivalent checks for UX, but nothing coming from the client
 * is trusted here: the plan is checked against an allow-list and the price is
 * derived on the server rather than read from the request.
 */

// Plan name -> price. Must stay in sync with the <pay-plan> elements in premium.html.
const PLANS = Object.freeze({
  Individual: '179 RS/month',
  Duo: '239 RS/month',
  Family: '299 RS/month',
  Student: '149 RS/month',
});

/**
 * Fields that must never reach this API. Card data belongs to a PCI-compliant
 * payment provider (Stripe, PayMongo, ...) which returns a token; only that
 * token, the last four digits and the expiry may ever be persisted. A CVV must
 * never be stored at all.
 */
const FORBIDDEN_FIELDS = Object.freeze([
  'cardNumber',
  'cardnumber',
  'expiryDate',
  'cvv',
  'cvc',
  'cardholderName',
]);

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/;
const MAX_NAME_LENGTH = 80;
const MAX_EMAIL_LENGTH = 254;

function asTrimmedString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function validateName(value, field, label, errors) {
  if (!value) {
    errors.push({ field, message: `${label} is required.` });
  } else if (value.length > MAX_NAME_LENGTH) {
    errors.push({ field, message: `${label} must be ${MAX_NAME_LENGTH} characters or fewer.` });
  }
}

/**
 * @param {unknown} body Parsed JSON request body.
 * @returns {{valid: true, value: object} | {valid: false, errors: Array<{field: string, message: string}>}}
 */
function validateSubscription(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return {
      valid: false,
      errors: [{ field: 'body', message: 'Request body must be a JSON object.' }],
    };
  }

  const forbidden = FORBIDDEN_FIELDS.filter((field) => field in body);
  if (forbidden.length > 0) {
    return {
      valid: false,
      errors: forbidden.map((field) => ({
        field,
        message: 'Card details must never be sent to this endpoint.',
      })),
    };
  }

  const errors = [];
  const firstName = asTrimmedString(body.firstName);
  const lastName = asTrimmedString(body.lastName);
  const email = asTrimmedString(body.email).toLowerCase();
  const plan = asTrimmedString(body.plan);

  validateName(firstName, 'firstName', 'First name', errors);
  validateName(lastName, 'lastName', 'Last name', errors);

  if (!email) {
    errors.push({ field: 'email', message: 'Email address is required.' });
  } else if (email.length > MAX_EMAIL_LENGTH) {
    errors.push({ field: 'email', message: `Email address must be ${MAX_EMAIL_LENGTH} characters or fewer.` });
  } else if (!EMAIL_PATTERN.test(email)) {
    errors.push({ field: 'email', message: 'Please enter a valid email address.' });
  }

  if (!plan) {
    errors.push({ field: 'plan', message: 'A plan is required.' });
  } else if (!Object.prototype.hasOwnProperty.call(PLANS, plan)) {
    errors.push({ field: 'plan', message: `Unknown plan. Choose one of: ${Object.keys(PLANS).join(', ')}.` });
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    // Price is looked up here on purpose - a client-supplied price is ignored.
    value: { firstName, lastName, email, plan, price: PLANS[plan] },
  };
}

module.exports = { validateSubscription, PLANS, FORBIDDEN_FIELDS };
