# How It Works — GitHub Pages → Azure Static Web Apps → Cosmos DB

An architectural walkthrough of this project: why it outgrew GitHub Pages, what Azure
Static Web Apps adds, and exactly what happens between a click on **Subscribe** and a
document appearing in Cosmos DB.

For the commands, see [DEPLOYMENT_RUNBOOK.md](./DEPLOYMENT_RUNBOOK.md).

---

## Contents

1. [The starting point: GitHub Pages](#1-the-starting-point-github-pages)
2. [Why a static host stopped being enough](#2-why-a-static-host-stopped-being-enough)
3. [What Azure Static Web Apps adds](#3-what-azure-static-web-apps-adds)
4. [The deployment pipeline](#4-the-deployment-pipeline)
5. [Anatomy of one subscription](#5-anatomy-of-one-subscription)
6. [How Cosmos DB stores it](#6-how-cosmos-db-stores-it)
7. [Where secrets live](#7-where-secrets-live)
8. [The security model](#8-the-security-model)
9. [Local emulator vs the cloud](#9-local-emulator-vs-the-cloud)
10. [Configuration files](#10-configuration-files)
11. [Cost and scaling](#11-cost-and-scaling)

---

## 1. The starting point: GitHub Pages

The project began as pure front-end: HTML, CSS, and vanilla JavaScript Web Components.
No build step, no framework, no server.

```
git push  ──►  GitHub Actions  ──►  GitHub Pages CDN  ──►  Browser
```

GitHub Pages is a **file server**. It takes the files in the repository and serves them
over HTTPS. That is the entire model, and for a site made of documents it's an excellent
fit: free, fast, globally cached, effectively zero configuration.

The subscribe form worked in the sense that it *looked* like it worked — it validated
input and displayed a success message. But nothing was recorded. Closing the tab
discarded everything the user typed.

---

## 2. Why a static host stopped being enough

Persisting a subscription requires three things a file server cannot provide:

**Code that runs on a server.** Someone has to receive the form data, check it, and
write it somewhere. GitHub Pages executes nothing — it only hands files to browsers.

**A database.** Cosmos DB needs a network call authenticated with a secret key.

**A place to keep that secret.** This is the decisive constraint. Everything shipped to
GitHub Pages is public by definition. Putting a database key in JavaScript means
publishing it — anyone could open DevTools, copy it, and read or delete the entire
database.

> This is worth internalising: it isn't a limitation of *GitHub* Pages specifically.
> It applies to any purely static host. The moment you need a secret, you need somewhere
> to run code that the user can't read.

**Validation is the second reason.** The browser already validates the form, but that
validation is a *convenience*, not a *guarantee* — anyone can bypass the page entirely:

```bash
curl -X POST https://.../api/subscriptions -d '{"plan":"Individual","price":"1 RS/month"}'
```

Only server-side code can enforce that the plan exists and that the price is the real
one. In this project the server ignores any client-supplied price and looks it up from
its own table ([api/validation.js](./api/validation.js)).

---

## 3. What Azure Static Web Apps adds

Static Web Apps is a static file host **plus** a managed serverless API, deployed
together as one resource:

```
                    ┌─────────────────────────────────────────┐
                    │      Azure Static Web Apps (Free)       │
  Browser  ────────►│                                         │
                    │  /*         → static files (CDN edge)   │
                    │  /api/*     → managed Azure Functions   │
                    └──────────────────┬──────────────────────┘
                                       │  Cosmos key from app settings
                                       ▼
                    ┌─────────────────────────────────────────┐
                    │   Azure Cosmos DB (serverless, NoSQL)   │
                    │   spotify-web / subscriptions           │
                    └─────────────────────────────────────────┘
```

Three properties matter:

**Same origin.** The site and the API share one hostname, so
`fetch('/api/subscriptions')` is a same-origin request. No CORS configuration, no
preflight requests, no absolute URLs to keep in sync between environments.

**Server-side secrets.** The Cosmos key is stored as an *app setting* and injected into
the Functions runtime as an environment variable. It never appears in any file sent to a
browser.

**Managed compute.** You don't provision a server. Azure runs [api/index.js](./api/index.js)
on demand, scales it automatically, and charges nothing while idle.

The static half behaves exactly like GitHub Pages did — same files, same CDN model. The
API is added *alongside* it rather than replacing anything.

---

## 4. The deployment pipeline

`az staticwebapp create` connects the Azure resource to the GitHub repository and commits
a workflow to `.github/workflows/`. From then on:

```
git push origin main
        │
        ▼
GitHub Actions runs the Static Web Apps build
        │
        ├── app_location "/"     → collects the static files
        └── api_location "api"   → runs npm install, packages the Functions app
        │
        ▼
Uploads both artifacts to Azure
        │
        ├── static files  → distributed to CDN edge nodes
        └── functions     → deployed to the managed runtime
        │
        ▼
Live at https://<name>.azurestaticapps.net   (2–4 minutes)
```

Two consequences follow from this design:

**The repository is the source of truth.** There is no manual upload step. If a file
isn't committed, it isn't deployed — which is why `api/local.settings.json` being
git-ignored is safe: the deployed API gets its configuration from app settings instead.

**App settings are not part of the build.** They're attached to the running app. Changing
them doesn't trigger a deployment, and a deployment doesn't change them. This decoupling
is what caused the 500 errors during setup: the app was deployed *before* the settings
existed, so the running instance had no Cosmos credentials until it next restarted.

---

## 5. Anatomy of one subscription

Follow a single click through every layer.

### Step 1 — The browser collects and validates

[component/subscribeModal.js](./component/subscribeModal.js) is a Web Component holding
the form in a shadow DOM. As the user types, `_validateField()` runs on both `input` and
`blur`, using `setCustomValidity()` for rules HTML attributes can't express — such as
whether an expiry date is in the past:

```js
const endOfMonth = new Date(year, month, 0, 23, 59, 59, 999);
if (endOfMonth < new Date()) return 'Your card has expired.';
```

`month, 0` is day zero of the following month — the last day of this one — so a card
stays valid through its entire expiry month.

### Step 2 — The payload is built from an allow-list

`_handleSubmit()` reads the form, then constructs a **new** object naming only what may
be sent:

```js
const digits = (data.cardNumber || '').replace(/\D/g, '');

const payload = {
    firstName: data.firstName,
    lastName:  data.lastName,
    email:     data.email,
    plan:      this.planNameEl.textContent.trim(),
    cardBrand:       this._getCardBrand(digits),   // from the leading digits
    cardLast4:       digits.slice(-4),
    cardExpiryMonth: Number(expiryMonth),
    cardExpiryYear:  2000 + Number(expiryYear),
};
```

The full card number and CVV are read into local variables and never referenced again.
**They are not in the HTTP request** — open DevTools → Network and the request body
contains only the masked values.

### Step 3 — The request reaches the edge

```js
fetch('/api/subscriptions', { method: 'POST', ... })
```

Azure's edge matches the path against
[staticwebapp.config.json](./staticwebapp.config.json). `/api/*` is listed under
`navigationFallback.exclude`, so it is **not** rewritten to `index.html` — it's forwarded
to the Functions runtime. (Omitting that exclusion is a classic mistake: API calls
silently return the HTML page, and `response.json()` fails with a confusing parse error.)

### Step 4 — The function validates

[api/index.js](./api/index.js) registers the handler using the Functions v4 programming
model — no `function.json`, just code:

```js
app.http('subscriptions', {
  methods: ['POST'], authLevel: 'anonymous', route: 'subscriptions',
  handler: async (request, context) => { ... }
});
```

It calls `validateSubscription(body)` in [api/validation.js](./api/validation.js), which
runs three checks in order:

1. **Forbidden fields** — if `cardNumber`, `cvv`, `cvc` or `expiryDate` is present, reject
   with 400 immediately. It tests `field in body`, so even an empty string is refused;
   presence itself is the violation.
2. **Field validation** — names, email format and length, plan against an allow-list, and
   the optional masked card values.
3. **Price derivation** — the price is looked up from the server's own `PLANS` table. A
   client-supplied price is ignored entirely.

Every error is collected before returning, so the response reports all problems at once
rather than one per round trip.

### Step 5 — Cosmos is queried, then written

[api/cosmos.js](./api/cosmos.js) caches the container promise so warm invocations skip
setup round-trips, and clears it on failure so a cold start can retry.

First, an idempotency check:

```js
const { resources } = await container.items.query({
  query: 'SELECT TOP 1 * FROM c WHERE c.email = @email AND c.plan = @plan',
  parameters: [{ name: '@email', value: email }, { name: '@plan', value: plan }],
}, { partitionKey: email });
```

Passing `partitionKey` makes this a **single-partition query** — Cosmos looks in exactly
one place instead of fanning out across every partition. That's the difference between a
query costing ~2.8 RU and one that scales with the size of the container.

If a match exists, the API returns **200** with `alreadySubscribed: true` — resubmitting
the same form doesn't create duplicates. Otherwise it writes and returns **201**:

```js
const { firstName, lastName, email, plan, price, ...rest } = result.value;
```

Note this destructures `result.value` — the validator's *output* — not the raw request
body. `...rest` can only contain fields the validator explicitly approved, so unexpected
fields in the request cannot reach the database.

### Step 6 — The browser responds to the result

```js
if (!response.ok) throw new Error(await this._readErrorMessage(response));
```

`_readErrorMessage()` maps the failure to something meaningful: a 404 becomes *"The
subscription service is unavailable in this environment"* (the signature of a static host
with no API), and a 400 surfaces the server's per-field messages. The button is
re-enabled in a `finally` block so a failure never leaves the form stuck.

---

## 6. How Cosmos DB stores it

The result is a JSON document:

```json
{
  "id": "73cb037a-2614-4589-8ba2-4686ce065a24",
  "type": "subscription",
  "firstName": "Andrew",
  "lastName": "Candare",
  "email": "andrew@example.com",
  "plan": "Individual",
  "price": "179 RS/month",
  "cardBrand": "Visa",
  "cardLast4": "4242",
  "cardExpiryMonth": 11,
  "cardExpiryYear": 2028,
  "source": "web",
  "createdAt": "2026-08-09T00:52:34.312Z"
}
```

**Cosmos DB is schema-less.** There is no table definition, no column list, no
constraint preventing a `cvv` field. It stores whatever JSON it receives. The container
enforces exactly two things: every document has an `id`, and every document has the
partition key.

That's a critical architectural point. In a relational database you could omit the column
and the engine would reject the insert. Here, **the validator *is* the schema** — the
guarantees live entirely in [api/validation.js](./api/validation.js), which is precisely
why [api/validation.test.js](./api/validation.test.js) asserts on them.

**The partition key is `/email`.** Cosmos distributes documents across physical
partitions by hashing this value. All subscriptions for one email land together, which
makes "find this person's subscriptions" cheap. Email is a good choice here because it
has high cardinality (spreading load evenly) and matches how the data is queried.

---

## 7. Where secrets live

The same key follows two different paths depending on environment:

```
Local development                    Azure
─────────────────                    ─────
api/local.settings.json              Static Web Apps app settings
  (git-ignored)                        (stored in Azure, encrypted)
        │                                      │
        ▼                                      ▼
  func runtime injects              runtime injects as env vars
  as env vars                                  │
        │                                      │
        └──────────────┬───────────────────────┘
                       ▼
             process.env.COSMOS_KEY
             api/cosmos.js
```

The application code is identical in both cases — it reads `process.env` and doesn't know
or care where the values came from. That's why the same code runs unmodified in the local
emulator and in Azure.

Neither source is ever served to a browser. `local.settings.json` is in
[.gitignore](./.gitignore) and also `.funcignore`, so it is neither committed nor
deployed.

---

## 8. The security model

Four independent layers, each of which would have to fail:

| Layer | Protects against | Implementation |
|-------|------------------|----------------|
| Browser allow-list | Card data ever entering the network | Payload built from named fields only |
| Server validation | Crafted requests bypassing the UI | `FORBIDDEN_FIELDS` → 400; plan allow-list; server-derived price |
| Output-based persistence | Unexpected fields reaching storage | Document built from validator output, never from `body` |
| Secret isolation | Database credential disclosure | Key in server-side app settings, never in client code |

The recurring principle is **allow-list, not deny-list**:

```js
const doc = { ...body };                    // deny-list: everything passes unless blocked
const doc = { firstName, lastName, email }; // allow-list: nothing passes unless named
```

With a deny-list you must remember to strip every dangerous field forever, and any new
form field silently lands in the database. With an allow-list, forgetting means data
*doesn't* get stored — the failure mode is a missing field rather than a leak.

---

## 9. Local emulator vs the cloud

`swa start . --api-location ./api` reproduces the production topology on your machine:

| | Local | Azure |
|---|---|---|
| Static files | SWA CLI on :4280 | CDN edge nodes |
| API | Functions Core Tools on :7071 | Managed Functions runtime |
| Routing | Reads `staticwebapp.config.json` | Reads `staticwebapp.config.json` |
| Config | `api/local.settings.json` | App settings |
| Database | **The real Cosmos DB in Azure** | The same Cosmos DB |
| Reachable by others | No — localhost only | Yes — public HTTPS |

The database is shared, so local testing writes real documents — which is what made it
possible to verify the whole data path before deploying anything.

The emulator proxies `/api/*` to port 7071 exactly as Azure's edge does, which is why
same-origin `fetch` works identically in both. Opening the HTML file directly
(`file://`) or through a plain static server bypasses that proxy, and every API call
404s.

---

## 10. Configuration files

| File | Read by | Purpose |
|------|---------|---------|
| [staticwebapp.config.json](./staticwebapp.config.json) | Azure edge + SWA CLI | Routing, `/api/*` exclusion, MIME types, security headers, `apiRuntime` |
| [api/host.json](./api/host.json) | Functions runtime | Host configuration. Deliberately has **no** `extensionBundle` — HTTP triggers are built in, and the bundle download fails behind TLS-inspecting networks |
| [api/package.json](./api/package.json) | Build + runtime | Dependencies installed during deployment |
| [api/.funcignore](./api/.funcignore) | Deployment | Excludes tests, docs and local settings from the deployed API |
| [.gitignore](./.gitignore) | Git | Keeps `node_modules/` and the Cosmos key out of the repository |
| `nginx.conf`, `Dockerfile` | *Nothing, on SWA* | Left over from container hosting; Static Web Apps ignores both |

---

## 11. Cost and scaling

**$0/month** at this scale:

- **Static Web Apps Free** — 100 GB bandwidth/month, free SSL, custom domains, managed API.
- **Cosmos DB free tier** — first 1000 RU/s and 25 GB free, one account per subscription.
- **Serverless Cosmos** — billed per request rather than per provisioned hour, so an idle
  database costs nothing.

Scaling behaviour differs by layer. Static files are served from CDN edges and scale
essentially without limit. The API scales out automatically per request, with a cold
start of roughly 1–3 seconds after idle. Cosmos scales by partition — with `/email` as
the key and high cardinality, load distributes evenly rather than concentrating on one
hot partition.

The first thing to outgrow the free tier would be bandwidth, given the `.mp3` files this
site serves. Moving the audio to Blob Storage would be the natural next step.
