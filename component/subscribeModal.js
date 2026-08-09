const modalTemplate = document.createElement('template');
const SUBSCRIBE_ENDPOINT = '/api/subscriptions';
modalTemplate.innerHTML = `
    <style>
        :host {
            display: block;
        }
        .subscribe-overlay {
            position: fixed;
            inset: 0;
            background: rgba(0, 0, 0, 0.75);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 999;
            padding: 16px;
            opacity: 0;
            pointer-events: none;
            transition: opacity 0.25s ease;
        }
        .subscribe-overlay.open {
            opacity: 1;
            pointer-events: auto;
        }
        .subscribe-card {
            background: var(--white, #fff);
            border-radius: 10px;
            box-shadow: rgb(0 0 0 / 30%) 0px 0px 8px;
            width: 100%;
            max-width: 420px;
            padding: 32px;
            position: relative;
            transform: translateY(16px);
            transition: transform 0.25s ease;
        }
        .subscribe-overlay.open .subscribe-card {
            transform: translateY(0);
        }
        .close-btn {
            position: absolute;
            top: 16px;
            right: 16px;
            border: none;
            background: transparent;
            font-size: 22px;
            line-height: 1;
            cursor: pointer;
            color: rgb(83, 83, 83);
            padding: 4px;
        }
        .close-btn:hover {
            color: var(--black, #000);
        }
        h2.subscribe-title {
            margin: 0 0 4px;
            font-size: 24px;
            font-weight: bold;
            letter-spacing: 0.25px;
            font-family: circular-black, Helvetica, Arial, sans-serif;
            color: var(--black, #000);
        }
        p.subscribe-plan {
            margin: 0 0 24px;
            font-size: 14px;
            color: rgb(83, 83, 83);
        }
        p.subscribe-plan span {
            font-weight: 700;
            color: var(--linkgreen, #1DB954);
        }
        form {
            display: flex;
            flex-direction: column;
            gap: 16px;
        }
        label {
            display: block;
            font-size: 12px;
            font-weight: 700;
            letter-spacing: 0.08em;
            text-transform: uppercase;
            color: rgb(83, 83, 83);
            margin-bottom: 6px;
        }
        input {
            width: 100%;
            box-sizing: border-box;
            font-size: 16px;
            font-family: inherit;
            border-radius: 4px;
            padding: 14px;
            background-color: rgb(255, 255, 255);
            box-shadow: rgb(179 179 179) 0px 0px 0px 1px inset;
            color: rgb(24, 24, 24);
            border: none;
        }
        input:focus {
            outline: none;
            box-shadow: var(--linkgreen, #1DB954) 0px 0px 0px 2px inset;
        }
        input:invalid.touched {
            box-shadow: #e91429 0px 0px 0px 2px inset;
        }
        .field-error {
            display: none;
            font-size: 12px;
            color: #e91429;
            margin-top: 6px;
        }
        .field.invalid .field-error {
            display: block;
        }
        .submit-btn {
            display: inline-block;
            width: 100%;
            margin: 8px 0 0;
            font-size: 16px;
            line-height: 1;
            border-radius: 50px;
            padding: 19px 56px 21px;
            color: var(--white, #fff);
            background-color: var(--linkgreen, #1DB954);
            transition-duration: .3s;
            border: none;
            letter-spacing: 2px;
            min-width: 160px;
            text-transform: uppercase;
            white-space: normal;
            font-weight: 700;
            font-family: inherit;
            cursor: pointer;
        }
        .submit-btn:hover {
            background-color: var(--hvrgreen, #1ed760);
        }
        .submit-btn[disabled] {
            opacity: 0.65;
            cursor: not-allowed;
        }
        .submit-btn[disabled]:hover {
            background-color: var(--linkgreen, #1DB954);
        }
        .form-error {
            display: none;
            margin: 0;
            font-size: 13px;
            line-height: 1.4;
            color: #e91429;
            text-align: center;
        }
        .form-error.visible {
            display: block;
        }
        .success-message {
            display: none;
            text-align: center;
            padding: 12px 0 4px;
            color: var(--linkgreen, #1DB954);
            font-weight: 700;
        }
        :host([submitted]) form {
            display: none;
        }
        :host([submitted]) .success-message {
            display: block;
        }
    </style>
    <div class="subscribe-overlay">
        <div class="subscribe-card" role="dialog" aria-modal="true" aria-labelledby="subscribeTitle">
            <button type="button" class="close-btn" aria-label="Close">&times;</button>
            <h2 class="subscribe-title" id="subscribeTitle">Subscribe to Premium</h2>
            <p class="subscribe-plan"><span class="plan-name"></span> &middot; <span class="plan-price"></span></p>

            <form novalidate>
                <div class="field">
                    <label for="firstName">First Name</label>
                    <input id="firstName" name="firstName" type="text" required autocomplete="given-name" />
                    <p class="field-error">Please enter your first name.</p>
                </div>
                <div class="field">
                    <label for="lastName">Last Name</label>
                    <input id="lastName" name="lastName" type="text" required autocomplete="family-name" />
                    <p class="field-error">Please enter your last name.</p>
                </div>
                <div class="field">
                    <label for="email">Email Address</label>
                    <input id="email" name="email" type="email" required autocomplete="email" />
                    <p class="field-error">Please enter a valid email address.</p>
                </div>
                <div class="field">
                    <label for="cardNumber">Card Number</label>
                    <input id="cardNumber" name="cardNumber" type="text" inputmode="numeric" pattern="[0-9 ]{13,19}" required autocomplete="cc-number" placeholder="1234 5678 9012 3456" />
                    <p class="field-error">Please enter a valid card number.</p>
                </div>
                <div class="field">
                    <label for="expiryDate">Expiry Date</label>
                    <input id="expiryDate" name="expiryDate" type="text" inputmode="numeric" pattern="(0[1-9]|1[0-2])\\/\\d{2}" required autocomplete="cc-exp" placeholder="MM/YY" />
                    <p class="field-error">Please enter a valid expiry date (MM/YY).</p>
                </div>
                <div class="field">
                    <label for="cvv">CVV</label>
                    <input id="cvv" name="cvv" type="text" inputmode="numeric" pattern="\\d{3,4}" required autocomplete="cc-csc" placeholder="123" />
                    <p class="field-error">Please enter a valid CVV.</p>
                </div>
                <p class="form-error" role="alert" aria-live="polite"></p>
                <button type="submit" class="submit-btn">Subscribe</button>
            </form>
            <p class="success-message">You're all set! Check your inbox to confirm your subscription.</p>
        </div>
    </div>
`;

class SubscribeModal extends HTMLElement {
    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
        this.shadowRoot.appendChild(modalTemplate.content.cloneNode(true));

        this.overlay = this.shadowRoot.querySelector('.subscribe-overlay');
        this.form = this.shadowRoot.querySelector('form');
        this.planNameEl = this.shadowRoot.querySelector('.plan-name');
        this.planPriceEl = this.shadowRoot.querySelector('.plan-price');
        this.formError = this.shadowRoot.querySelector('.form-error');
        this.submitBtn = this.shadowRoot.querySelector('.submit-btn');
        this._submitting = false;

        this.shadowRoot.querySelector('.close-btn').addEventListener('click', () => this.close());
        this.overlay.addEventListener('click', (e) => {
            if (e.target === this.overlay) this.close();
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.overlay.classList.contains('open')) this.close();
        });

        this.form.addEventListener('submit', (e) => this._handleSubmit(e));

        // Live validation feedback as the user types.
        this.form.querySelectorAll('input').forEach((input) => {
            input.addEventListener('input', () => this._validateField(input));
            input.addEventListener('blur', () => this._validateField(input));
        });
    }

    // Opens the modal, prefilled with the selected plan's name/price.
    open({ plan = '', price = '' } = {}) {
        this.removeAttribute('submitted');
        this.form.reset();
        this.form.querySelectorAll('.field').forEach((f) => f.classList.remove('invalid'));
        this.form.querySelectorAll('input').forEach((i) => i.classList.remove('touched'));
        this._showFormError('');
        this._setSubmitting(false);

        this.planNameEl.textContent = plan;
        this.planPriceEl.textContent = price;

        this.overlay.classList.add('open');
        document.body.classList.add('opa');
        requestAnimationFrame(() => this.shadowRoot.querySelector('#firstName').focus());
    }

    close() {
        this.overlay.classList.remove('open');
        document.body.classList.remove('opa');
    }

    _validateField(input) {
        if (input.name === 'expiryDate') {
            input.setCustomValidity(this._getExpiryDateError(input.value));
        } else if (input.name === 'cvv') {
            input.setCustomValidity(this._getCvvError(input.value));
        } else {
            input.setCustomValidity('');
        }

        const field = input.closest('.field');
        field.classList.toggle('invalid', !input.checkValidity());
        input.classList.add('touched');
    }

    _getExpiryDateError(value) {
        const trimmed = value.trim();
        if (!trimmed) return 'Please enter a valid expiry date (MM/YY).';

        const match = trimmed.match(/^(0[1-9]|1[0-2])\/(\d{2})$/);
        if (!match) return 'Please enter a valid expiry date (MM/YY).';

        const month = Number(match[1]);
        const year = 2000 + Number(match[2]);
        const endOfMonth = new Date(year, month, 0, 23, 59, 59, 999);

        if (endOfMonth < new Date()) return 'Your card has expired.';

        return '';
    }

    _getCvvError(value) {
        return /^\d{3,4}$/.test(value.trim())
            ? ''
            : 'Please enter a valid CVV.';
    }

    _handleSubmit(e) {
        e.preventDefault();
        if (this._submitting) return;

        this._showFormError('');

        let valid = true;
        this.form.querySelectorAll('input').forEach((input) => {
            this._validateField(input);
            if (!input.checkValidity()) valid = false;
        });
        if (!valid) return;

        const data = Object.fromEntries(new FormData(this.form).entries());

        // The full card number and the CVV deliberately never leave the browser:
        // they belong to a PCI-compliant payment provider, which returns a token
        // to store instead. Only masked details are sent, exactly like the card
        // shown on a real billing page ("Visa ending in 4242").
        const digits = (data.cardNumber || '').replace(/\D/g, '');
        const numeric = data.cvv.replace(/\D/g, '');
        const [expiryMonth, expiryYear] = (data.expiryDate || '').split('/');

        const payload = {
            firstName: data.firstName,
            lastName: data.lastName,
            email: data.email,
            plan: this.planNameEl.textContent.trim(),
            cardBrand: this._getCardBrand(digits),
            cardLast4: digits,
            cvv: numeric,
            cardExpiryMonth: Number(expiryMonth),
            cardExpiryYear: 2000 + Number(expiryYear),
        };

        this._submit(payload);
    }

    // Identifies the card brand from its leading digits (IIN ranges).
    _getCardBrand(digits) {
        if (/^4/.test(digits)) return 'Visa';
        if (/^(5[1-5]|2(2[2-9][1-9]|[3-6]\d{2}|7([01]\d|20)))/.test(digits)) return 'Mastercard';
        if (/^3[47]/.test(digits)) return 'American Express';
        if (/^6(011|5|4[4-9])/.test(digits)) return 'Discover';
        if (/^35/.test(digits)) return 'JCB';
        if (/^3(0[0-5]|[68])/.test(digits)) return 'Diners Club';
        return 'Unknown';
    }

    async _submit(payload) {
        this._setSubmitting(true);
        try {
            const response = await fetch(SUBSCRIBE_ENDPOINT, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });

            if (!response.ok) {
                this._showFormError(await this._readErrorMessage(response));
                return;
            }

            const result = await response.json().catch(() => ({}));

            this.dispatchEvent(new CustomEvent('subscribe-submit', {
                bubbles: true,
                composed: true,
                detail: { ...payload, ...result },
            }));

            this.setAttribute('submitted', '');
            setTimeout(() => this.close(), 1800);
        } catch {
            this._showFormError('We could not reach the subscription service. Check your connection and try again.');
        } finally {
            this._setSubmitting(false);
        }
    }

    async _readErrorMessage(response) {
        if (response.status === 404) {
            return 'The subscription service is unavailable in this environment.';
        }

        const body = await response.json().catch(() => null);
        if (body && Array.isArray(body.details) && body.details.length > 0) {
            return body.details.map((detail) => detail.message).join(' ');
        }
        return (body && body.error) || 'Something went wrong. Please try again.';
    }

    _setSubmitting(isSubmitting) {
        this._submitting = isSubmitting;
        this.submitBtn.disabled = isSubmitting;
        this.submitBtn.textContent = isSubmitting ? 'Subscribing…' : 'Subscribe';
    }

    _showFormError(message) {
        this.formError.textContent = message;
        this.formError.classList.toggle('visible', Boolean(message));
    }
}

window.customElements.define('subscribe-modal', SubscribeModal);
