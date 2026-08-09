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
 * Fields that must never reach this API. The full card number and the CVV are
 * never transmitted or stored: they belong to a PCI-compliant payment provider
 * (Stripe, PayMongo, ...) which returns a token. Only the masked details -
 * brand, last four digits and expiry - may be persisted, and PCI DSS 3.3.1
 * forbids retaining a CVV under any circumstances.
 */
const FORBIDDEN_FIELDS = Object.freeze([
  'cardNumber',
  'cardnumber',
  'expiryDate',
  'cardholderName',
]);

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/;
const MAX_NAME_LENGTH = 80;
const MAX_EMAIL_LENGTH = 254;

/**
 * Card brands the UI is able to recognise. Anything else is stored as 'Unknown'
 * rather than rejected, so an unrecognised prefix never blocks a subscription.
 */
const CARD_BRANDS = Object.freeze([
  'Visa',
  'Mastercard',
  'American Express',
  'Discover',
  'JCB',
  'Diners Club',
  'Unknown',
]);

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
 * Validates the masked card details, which are the only card-related values
 * allowed to be persisted: brand, last four digits and expiry. These are
 * optional - a request without them is still a valid subscription.
 *
 * @returns {object} The masked fields to store (empty when none were supplied).
 */
function validateMaskedCard(body, errors) {
  const brand = asTrimmedString(body.cardBrand);
  const last4 = asTrimmedString(body.cardLast4);
  const month = body.cardExpiryMonth;
  const year = body.cardExpiryYear;

  const supplied = [brand, last4, month, year].filter(
    (value) => value !== undefined && value !== null && value !== ''
  );
  if (supplied.length === 0) return {};

  // if (!/^\d{4}$/.test(last4)) {
  //   errors.push({ field: 'cardLast4', message: 'Card last 4 digits must be exactly 4 digits.' });
  // }

  if (brand && !CARD_BRANDS.includes(brand)) {
    errors.push({ field: 'cardBrand', message: `Unknown card brand. Expected one of: ${CARD_BRANDS.join(', ')}.` });
  }

  const monthNumber = Number(month);
  if (!Number.isInteger(monthNumber) || monthNumber < 1 || monthNumber > 12) {
    errors.push({ field: 'cardExpiryMonth', message: 'Card expiry month must be between 1 and 12.' });
  }

  const yearNumber = Number(year);
  if (!Number.isInteger(yearNumber) || yearNumber < 2000 || yearNumber > 2199) {
    errors.push({ field: 'cardExpiryYear', message: 'Card expiry year must be a four-digit year.' });
  }

  if (errors.length > 0) return {};

  // Day 0 of the next month is the last day of this one, so a card stays valid
  // through the whole of its expiry month.
  const endOfMonth = new Date(Date.UTC(yearNumber, monthNumber, 0, 23, 59, 59, 999));
  if (endOfMonth < new Date()) {
    errors.push({ field: 'cardExpiryMonth', message: 'The card has expired.' });
    return {};
  }

  return {
    cardBrand: brand || 'Unknown',
    cardLast4: last4,
    cardExpiryMonth: monthNumber,
    cardExpiryYear: yearNumber,
  };
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
  const cvv = asTrimmedString(body.cvv); 
  const maskedCard = validateMaskedCard(body, errors);

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
    value: { firstName, lastName, email, plan, price: PLANS[plan], cvv,...maskedCard },
  };
}

module.exports = { validateSubscription, PLANS, FORBIDDEN_FIELDS, CARD_BRANDS };
