const modalTemplate = document.createElement('template');
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
                    <input id="expiryDate" name="expiryDate" type="text" inputmode="numeric" pattern="(0[1-9]|1[0-2])\/\d{2}" required autocomplete="cc-exp" placeholder="MM/YY" />
                    <p class="field-error">Please enter a valid expiry date (MM/YY).</p>
                </div>
                <div class="field">
                    <label for="cvv">CVV</label>
                    <input id="cvv" name="cvv" type="text" inputmode="numeric" pattern="\d{3,4}" required autocomplete="cc-csc" placeholder="123" />
                    <p class="field-error">Please enter a valid CVV.</p>
                </div>
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
            input.addEventListener('blur', () => this._validateField(input));
        });
    }

    // Opens the modal, prefilled with the selected plan's name/price.
    open({ plan = '', price = '' } = {}) {
        this.removeAttribute('submitted');
        this.form.reset();
        this.form.querySelectorAll('.field').forEach((f) => f.classList.remove('invalid'));

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
        const field = input.closest('.field');
        field.classList.toggle('invalid', !input.checkValidity());
        input.classList.add('touched');
    }

    _handleSubmit(e) {
        e.preventDefault();

        let valid = true;
        this.form.querySelectorAll('input').forEach((input) => {
            this._validateField(input);
            if (!input.checkValidity()) valid = false;
        });
        if (!valid) return;

        const data = Object.fromEntries(new FormData(this.form).entries());
        // No backend wired up yet - surface the captured data for now.
        this.dispatchEvent(new CustomEvent('subscribe-submit', {
            bubbles: true,
            composed: true,
            detail: data,
        }));

        this.setAttribute('submitted', '');
        setTimeout(() => this.close(), 1800);
    }
}

window.customElements.define('subscribe-modal', SubscribeModal);
