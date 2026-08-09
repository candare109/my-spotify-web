# Azure Static Web Apps + Cosmos DB — From Scratch

A complete, reusable guide for deploying **any** web app with a serverless API and a
NoSQL database on Azure, at **$0/month**.

Start with an empty folder; finish with a public HTTPS site whose form writes to a
database. Every command was verified on Windows. Errors that actually occur in practice
are documented inline with their fixes.

**Who this is for:** anyone building a site that needs to store data — a contact form,
signup, booking, feedback, or waitlist. No prior Azure experience assumed.

**Not project-specific.** Replace the placeholders in [§0](#0-placeholders) and every
command works as written.

---

## Contents

**Setup**
0. [Placeholders](#0-placeholders)
1. [Architecture](#1-architecture)
2. [Do you need this?](#2-do-you-need-this)
3. [Permissions required](#3-permissions-required)
4. [Install the tools](#4-install-the-tools)

**Build**
5. [Project structure](#5-project-structure)
6. [Write the API](#6-write-the-api)
7. [Write the frontend](#7-write-the-frontend)
8. [Configure routing](#8-configure-routing)

**Deploy**
9. [Create the Azure resources](#9-create-the-azure-resources)
10. [Run it locally](#10-run-it-locally)
11. [Push to GitHub](#11-push-to-github)
12. [Create the Static Web App](#12-create-the-static-web-app)
13. [Configure app settings](#13-configure-app-settings)
14. [Verify](#14-verify)

**Operate**
15. [Framework builds](#15-framework-builds-react-vue-angular)
16. [Troubleshooting](#16-troubleshooting)
17. [Security checklist](#17-security-checklist)
18. [Cost and limits](#18-cost-and-limits)
19. [Teardown](#19-teardown)
20. [Command reference](#20-command-reference)

---

## 0. Placeholders

Fill this table in first, then substitute throughout. Every command below uses these
exact tokens.

| Placeholder | Example | Rules |
|---|---|---|
| `<RG_NAME>` | `rg-myapp-prod` | Any name, unique within your subscription |
| `<REGION>` | `southeastasia` | Any Azure region — `az account list-locations -o table` |
| `<COSMOS_NAME>` | `cosmos-myapp-4821` | **Globally unique**, 3–44 chars, lowercase letters/digits/hyphens |
| `<DB_NAME>` | `myapp` | Database name |
| `<CONTAINER_NAME>` | `submissions` | Container (table) name |
| `<PARTITION_KEY>` | `/email` | See [§9.4](#94-choosing-a-partition-key) — hard to change later |
| `<SWA_NAME>` | `swa-myapp` | Unique within the resource group |
| `<SWA_REGION>` | `eastasia` | **Only:** `westus2`, `centralus`, `eastus2`, `westeurope`, `eastasia` |
| `<GITHUB_USER>` | `janedoe` | Your GitHub username or org |
| `<REPO_NAME>` | `my-app` | Repository name |
| `<BRANCH>` | `main` | Branch that triggers deployment |

> **Globally unique** means unique across all of Azure, not just your account. If
> creation fails with a name conflict, add digits: `cosmos-myapp-4821`.

> `<SWA_REGION>` is independent of `<REGION>`. Static Web Apps exists in only five
> regions; your resource group and Cosmos account can be anywhere.

---

## 1. Architecture

```
                    ┌────────────────────────────────────────────┐
   Browser ────────►│    Azure Static Web Apps  (Free tier)      │
                    │                                            │
                    │   /*        → static files  (CDN edge)     │
                    │   /api/*    → managed Azure Functions      │
                    └───────────────────┬────────────────────────┘
                                        │  connection details from app settings
                                        ▼
                    ┌────────────────────────────────────────────┐
                    │   Azure Cosmos DB for NoSQL (serverless)   │
                    │   <DB_NAME> / <CONTAINER_NAME>             │
                    └────────────────────────────────────────────┘
```

**One Azure resource serves both** the site and the API. Consequences:

- `fetch('/api/...')` is a **same-origin** request — no CORS setup, no absolute URLs
  differing between local and production.
- The database credential lives **server-side** in app settings, never in browser code.
- Deployment is a single `git push`.

**Three moving parts:**

| Part | What it is | Where it runs |
|---|---|---|
| Static files | HTML/CSS/JS | CDN edge nodes worldwide |
| API | Node.js Azure Functions | Managed serverless runtime, on demand |
| Database | Cosmos DB for NoSQL | Your chosen region |

---

## 2. Do you need this?

**A purely static host (GitHub Pages, Netlify free, S3) is enough if** your site only
displays content, or submits to a third-party form service.

**You need this architecture the moment you need to store data yourself**, because of
three things a file server cannot provide:

1. **Code that runs on a server** — a file server executes nothing.
2. **A database connection** — requires an authenticated network call.
3. **Somewhere to keep the secret** — this is decisive.

That third point deserves emphasis. Everything shipped to a static host is public by
definition. A database key in frontend JavaScript is a **published** key: anyone can open
DevTools, copy it, and read or delete your entire database. There is no way around this
with obfuscation or minification.

**Server-side validation is the second reason.** Browser validation is a convenience, not
a guarantee — anyone can bypass your page entirely:

```bash
curl -X POST https://yoursite.com/api/submit -d '{"plan":"premium","price":0}'
```

Only server code can enforce that the price is real. Never trust a value the client sent
when it matters.

### Do you need Azure Functions specifically?

You need *something* server-side. Options:

| Option | Verdict |
|---|---|
| **SWA managed API** (this guide) | Best for most cases — one resource, free, no CORS |
| Separate Function App | Only if the API is shared by multiple sites |
| App Service / container | Needed for long-running processes, WebSockets, non-HTTP work |
| **SWA Database Connections** | No backend code at all — see below |

**Database Connections** (Data API Builder) exposes Cosmos DB directly as REST/GraphQL
with zero backend code: `az staticwebapp dbconnection create`. Genuinely useful for
simple CRUD.

Avoid it when you need **business logic between the client and the database** — deriving
prices server-side, rejecting fields, enforcing allow-lists, checking for duplicates.
Exposing a database directly means the client controls exactly what is written.

---

## 3. Permissions required

### The simple answer

**Contributor on the resource group** covers everything except two subscription-level
actions.

### Subscription-scope actions

These cannot be done at resource-group scope. If an admin does them once, everything
afterwards works with RG-scoped Contributor.

| Action | Permission |
|---|---|
| Create the resource group | `Microsoft.Resources/subscriptions/resourceGroups/write` |
| Register resource providers | `Microsoft.Resources/subscriptions/providers/register/action` |

### Least-privilege alternative

Two built-in roles scoped to the resource group are sufficient:

| Role | Role GUID | Grants |
|---|---|---|
| **DocumentDB Account Contributor** | `5bd9cd88-fe45-4216-938b-f97437e15450` | Create the Cosmos account, database, container; **list and regenerate keys** |
| **Website Contributor** | `de139f84-1756-47ae-9be6-808fbbe84772` | Create/read the Static Web App; set app settings |

```cmd
az role assignment create --assignee <user@domain> --role "DocumentDB Account Contributor" --scope /subscriptions/<SUB_ID>/resourceGroups/<RG_NAME>

az role assignment create --assignee <user@domain> --role "Website Contributor" --scope /subscriptions/<SUB_ID>/resourceGroups/<RG_NAME>
```

> ⚠️ **Do not use "Cosmos DB Operator"** (`230815da-be43-4aae-9cb4-875f7bd000aa`). It can
> create accounts but explicitly **cannot list keys**, so `az cosmosdb keys list` fails
> and you cannot configure the API. A common dead end.

### Control plane vs data plane

Azure RBAC roles are **control plane only** — they let you *manage* the Cosmos account but
grant **no access to the documents inside it**. Reading or writing data requires either
the account key (what this guide uses) or a separate Cosmos data-plane role assignment.

This is why "I'm Owner but I can't query my data" surprises people.

### GitHub permission

`az staticwebapp create --login-with-github` requires **admin rights on the repository** —
it commits a workflow file and adds a deployment secret. Write access is not enough.

### Verify what you have

```cmd
az login
az account show --output table
az role assignment list --assignee <user@domain> --output table
```

---

## 4. Install the tools

Run in **Command Prompt** (`cmd`). Open a **new terminal** after installing so `PATH`
updates apply.

### 4.1 Git

```cmd
winget install -e --id Git.Git
git --version
```

> **Exit code 1 saying a package is already installed** → Git is present; only the
> *upgrade* failed (files in use). Harmless.

> **`'git' is not recognized`** → it installed per-user and isn't on `PATH`. Check with
> `where git`. The per-user path is `%LOCALAPPDATA%\Programs\Git\cmd`. For the current
> window only:
> ```cmd
> set PATH=%PATH%;%LOCALAPPDATA%\Programs\Git\cmd
> ```
> Permanent: **Settings → System → About → Advanced system settings → Environment
> Variables → Path → New**.

### 4.2 Node.js — must be 18, 20, or 22

```cmd
winget install -e --id OpenJS.NodeJS.LTS
node --version
```

> ⚠️ **Azure Functions Core Tools v4 does not support Node 24+.** If `node --version`
> shows 24 or higher, `swa start` fails with:
> ```
> ✖ Found Azure Functions Core Tools v4 which is incompatible with your current Node.js v24.x
> ```
> The winget catalogue often carries only the current (non-LTS) line. Install 22 from the
> official MSI:
> ```cmd
> winget uninstall -e --id OpenJS.NodeJS.LTS
> curl -L -o "%TEMP%\node22.msi" https://nodejs.org/dist/v22.23.2/node-v22.23.2-x64.msi
> msiexec /i "%TEMP%\node22.msi"
> ```
> Then open a **new** terminal and confirm `node --version` prints `v22.x`.
> Check the current 22.x release at <https://nodejs.org/dist/latest-v22.x/>.

### 4.3 Azure Functions Core Tools

```cmd
winget install -e --id Microsoft.Azure.FunctionsCoreTools
func --version
```

> ⚠️ **Do not install this with npm.** `npm install -g azure-functions-core-tools@4`
> requests a CDN artifact that does not exist:
> ```
> Error downloading zip file from https://cdn.functions.azure.com/public/.../Azure.Functions.Cli.win-x64.4.13.2.zip
> Expected: 200, Actual: 404
> ```
> Remove a partial npm install first:
> ```cmd
> rmdir /s /q "%APPDATA%\npm\node_modules\azure-functions-core-tools"
> ```

Needed **only for local development** — Azure builds and runs the API itself.

### 4.4 Static Web Apps CLI

```cmd
npm install -g @azure/static-web-apps-cli
swa --version
```

Deprecation and `keytar` warnings during install are expected and harmless.

### 4.5 Azure CLI

```cmd
winget install -e --id Microsoft.AzureCLI
az version
az login
az account show --output table
```

> Multiple subscriptions? Select one:
> ```cmd
> az account list --output table
> az account set --subscription "<subscription name or id>"
> ```

> The warning `You are using cryptography on a 32-bit Python on a 64-bit Windows
> Operating System` is cosmetic. Ignore it.

### 4.6 Verify everything

```cmd
git --version && node --version && npm --version && func --version && swa --version && az version
```

All six must succeed before continuing.

---

## 5. Project structure

```
<REPO_NAME>/
├── index.html                     ← your site (app root)
├── css/  js/  assets/
├── staticwebapp.config.json       ← routing, MIME types, headers, API runtime
├── .gitignore
└── api/                           ← the managed Functions app
    ├── index.js                   ← HTTP handler
    ├── validation.js              ← server-side validation
    ├── db.js                      ← Cosmos client
    ├── package.json
    ├── host.json
    ├── .funcignore
    ├── local.settings.json        ← secrets, git-ignored, NEVER committed
    └── local.settings.json.example
```

**Why a monorepo?** Static Web Apps builds both halves from one repository in one
workflow. Separate repos would mean two deployments and manual CORS configuration.

Create the folders:

```cmd
mkdir <REPO_NAME> && cd <REPO_NAME>
mkdir api
git init
```

### 5.1 `.gitignore` (repo root)

Create this **before your first commit** — it is what keeps your database key out of Git.

```gitignore
node_modules/

# Local Azure Functions configuration — contains connection strings and keys
api/local.settings.json
.env
.env.*
!.env.example

# Functions build output
api/bin/
api/obj/
.azure/

.DS_Store
Thumbs.db
```

---

## 6. Write the API

### 6.1 `api/package.json`

```json
{
  "name": "<REPO_NAME>-api",
  "version": "1.0.0",
  "main": "index.js",
  "scripts": {
    "test": "node --test"
  },
  "dependencies": {
    "@azure/cosmos": "^4.1.1",
    "@azure/functions": "^4.5.1"
  },
  "engines": {
    "node": ">=18"
  }
}
```

> **`main` is what registers your functions.** The Functions v4 model loads this entry
> point and discovers everything it `require`s. Filenames are otherwise irrelevant —
> there are no `function.json` files.

### 6.2 `api/host.json`

```json
{
  "version": "2.0",
  "logging": {
    "applicationInsights": {
      "samplingSettings": { "isEnabled": true, "excludedTypes": "Request" }
    }
  }
}
```

> ⚠️ **Deliberately no `extensionBundle`.** HTTP triggers are built into the runtime, and
> the bundle is downloaded at startup from a CDN — which fails behind corporate TLS
> inspection with:
> ```
> Error building configuration in an external startup class.
> System.Net.Http: The SSL connection could not be established
> ```
> Add the bundle back **only** if you use non-HTTP bindings (Cosmos triggers, Timers,
> Service Bus, Blob).

### 6.3 `api/.funcignore`

Keeps development files out of the deployed API.

```
local.settings.json
local.settings.json.example
*.test.js
*.md
.vscode/
```

### 6.4 `api/local.settings.json.example`

Commit **this**, never the real file.

```json
{
  "IsEncrypted": false,
  "Values": {
    "FUNCTIONS_WORKER_RUNTIME": "node",
    "AzureWebJobsStorage": "",
    "COSMOS_ENDPOINT": "https://<COSMOS_NAME>.documents.azure.com:443/",
    "COSMOS_KEY": "PASTE_PRIMARY_KEY_HERE",
    "COSMOS_DATABASE": "<DB_NAME>",
    "COSMOS_CONTAINER": "<CONTAINER_NAME>"
  },
  "Host": { "CORS": "*" }
}
```

### 6.5 `api/db.js` — the Cosmos client

```js
'use strict';

const { CosmosClient } = require('@azure/cosmos');

const DATABASE_ID = process.env.COSMOS_DATABASE || '<DB_NAME>';
const CONTAINER_ID = process.env.COSMOS_CONTAINER || '<CONTAINER_NAME>';

let containerPromise;

function createClient() {
  const connectionString = process.env.COSMOS_CONNECTION_STRING;
  if (connectionString) return new CosmosClient(connectionString);

  const endpoint = process.env.COSMOS_ENDPOINT;
  const key = process.env.COSMOS_KEY;
  if (!endpoint || !key) {
    throw new Error(
      'Cosmos DB is not configured. Set COSMOS_CONNECTION_STRING, or COSMOS_ENDPOINT and COSMOS_KEY.'
    );
  }
  return new CosmosClient({ endpoint, key });
}

/**
 * Resolves the container, creating the database/container on first use.
 * The promise is cached so warm invocations skip the setup round-trips;
 * a failure clears the cache so the next request retries.
 */
function getContainer() {
  if (!containerPromise) {
    containerPromise = (async () => {
      const client = createClient();
      const { database } = await client.databases.createIfNotExists({ id: DATABASE_ID });
      const { container } = await database.containers.createIfNotExists({
        id: CONTAINER_ID,
        partitionKey: { paths: ['<PARTITION_KEY>'] },
      });
      return container;
    })().catch((error) => {
      containerPromise = undefined;
      throw error;
    });
  }
  return containerPromise;
}

async function findItem(partitionValue, field, value) {
  const container = await getContainer();
  const { resources } = await container.items
    .query(
      {
        query: `SELECT TOP 1 * FROM c WHERE c.email = @pk AND c.${field} = @value`,
        parameters: [
          { name: '@pk', value: partitionValue },
          { name: '@value', value },
        ],
      },
      { partitionKey: partitionValue }
    )
    .fetchAll();

  return resources[0];
}

async function createItem(record) {
  const container = await getContainer();
  const { resource } = await container.items.create(record);
  return resource;
}

module.exports = { getContainer, findItem, createItem, DATABASE_ID, CONTAINER_ID };
```

**Two details that matter:**

*Caching the container promise.* Serverless functions reuse warm instances. Without the
cache, every request pays for two extra round-trips.

*Passing `partitionKey` to the query.* This makes it a **single-partition query** —
Cosmos looks in one place instead of fanning out across every partition. The difference
is a query costing ~2.8 RU versus one whose cost grows with the container.

### 6.6 `api/validation.js` — the trust boundary

Adapt the rules; keep the shape.

```js
'use strict';

/**
 * Server-side validation. Nothing from the client is trusted here:
 * options are checked against an allow-list and derived values are
 * computed on the server rather than read from the request.
 */

// Allow-list of valid options and their server-side values.
const OPTIONS = Object.freeze({
  Basic: '9.99',
  Pro: '19.99',
  Enterprise: '49.99',
});

/**
 * Fields that must never reach this API. Card data belongs to a
 * PCI-compliant payment provider (Stripe, Adyen, PayMongo) which returns
 * a token; PCI DSS 3.3.1 forbids retaining a CVV under any circumstances.
 */
const FORBIDDEN_FIELDS = Object.freeze([
  'cardNumber', 'cardnumber', 'expiryDate', 'cvv', 'cvc', 'cardholderName',
  'password', 'ssn',
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

function validateSubmission(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return { valid: false, errors: [{ field: 'body', message: 'Request body must be a JSON object.' }] };
  }

  // Presence alone is a violation, so test `in` rather than truthiness.
  const forbidden = FORBIDDEN_FIELDS.filter((field) => field in body);
  if (forbidden.length > 0) {
    return {
      valid: false,
      errors: forbidden.map((field) => ({
        field,
        message: 'Sensitive data must never be sent to this endpoint.',
      })),
    };
  }

  const errors = [];
  const firstName = asTrimmedString(body.firstName);
  const lastName = asTrimmedString(body.lastName);
  const email = asTrimmedString(body.email).toLowerCase();
  const option = asTrimmedString(body.option);

  validateName(firstName, 'firstName', 'First name', errors);
  validateName(lastName, 'lastName', 'Last name', errors);

  if (!email) {
    errors.push({ field: 'email', message: 'Email address is required.' });
  } else if (email.length > MAX_EMAIL_LENGTH) {
    errors.push({ field: 'email', message: `Email must be ${MAX_EMAIL_LENGTH} characters or fewer.` });
  } else if (!EMAIL_PATTERN.test(email)) {
    errors.push({ field: 'email', message: 'Please enter a valid email address.' });
  }

  if (!option) {
    errors.push({ field: 'option', message: 'An option is required.' });
  } else if (!Object.prototype.hasOwnProperty.call(OPTIONS, option)) {
    errors.push({ field: 'option', message: `Unknown option. Choose one of: ${Object.keys(OPTIONS).join(', ')}.` });
  }

  if (errors.length > 0) return { valid: false, errors };

  return {
    valid: true,
    // Price is looked up here on purpose — a client-supplied price is ignored.
    value: { firstName, lastName, email, option, price: OPTIONS[option] },
  };
}

module.exports = { validateSubmission, OPTIONS, FORBIDDEN_FIELDS };
```

**Four principles worth carrying into any project:**

1. **Allow-list, never deny-list.** Check membership in a known-good set.
2. **Derive values server-side.** Never store a price, role, or total the client sent.
3. **Collect all errors.** Return every problem at once, not one per round trip.
4. **Normalise before storing.** Lower-case emails, trim whitespace.

### 6.7 `api/index.js` — the HTTP handler

```js
'use strict';

const { app } = require('@azure/functions');
const { randomUUID } = require('node:crypto');
const { validateSubmission } = require('./validation');
const { findItem, createItem } = require('./db');

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

app.http('submissions', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'submissions',
  handler: async (request, context) => {
    const body = await readJsonBody(request);
    if (body === undefined) {
      return jsonResponse(400, { error: 'Request body must be valid JSON.' });
    }

    const result = validateSubmission(body);
    if (!result.valid) {
      return jsonResponse(400, { error: 'Validation failed.', details: result.errors });
    }

    // Destructure the VALIDATOR'S OUTPUT, never the raw request body.
    const { firstName, lastName, email, option, price, ...rest } = result.value;

    try {
      const existing = await findItem(email, 'option', option);
      if (existing) {
        context.log(`Submission already exists for option "${option}"`);
        return jsonResponse(200, {
          id: existing.id, option, price,
          createdAt: existing.createdAt, alreadyExists: true,
        });
      }

      const saved = await createItem({
        id: randomUUID(),
        type: 'submission',
        firstName, lastName, email, option, price,
        ...rest,
        source: 'web',
        createdAt: new Date().toISOString(),
      });

      context.log(`Stored submission ${saved.id}`);
      return jsonResponse(201, {
        id: saved.id, option, price,
        createdAt: saved.createdAt, alreadyExists: false,
      });
    } catch (error) {
      // Log the failure, never the submitted personal data.
      context.error('Failed to store submission', error);

      // Opt-in diagnostics: set DEBUG_ERRORS=1 temporarily while debugging.
      const debug = process.env.DEBUG_ERRORS === '1'
        ? { code: error.code, message: error.message }
        : undefined;

      return jsonResponse(500, {
        error: 'Could not store the submission. Please try again later.',
        debug,
      });
    }
  },
});
```

> 🔑 **The single most important line:**
> ```js
> const { firstName, ..., ...rest } = result.value;   // ✅ validator output
> const doc = { ...body };                            // ❌ never do this
> ```
> Building the document from `result.value` means only validated fields can be stored.
> Spreading `body` would let an attacker inject `{"isAdmin": true}` or any other field
> directly into your database.

> **`authLevel: 'anonymous'`** is required — Static Web Apps handles authentication at the
> platform layer. Any other value breaks the managed API.

### 6.8 `api/validation.test.js` — tests

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { validateSubmission, OPTIONS } = require('./validation');

const validBody = {
  firstName: 'Ada', lastName: 'Lovelace',
  email: 'Ada@Example.com', option: 'Pro',
};

test('accepts a valid payload and normalises the email', () => {
  const result = validateSubmission(validBody);
  assert.equal(result.valid, true);
  assert.equal(result.value.email, 'ada@example.com');
});

test('derives the price on the server and ignores a client-supplied one', () => {
  const result = validateSubmission({ ...validBody, price: '0.01' });
  assert.equal(result.value.price, OPTIONS.Pro);
});

test('rejects requests carrying sensitive fields', () => {
  for (const field of ['cardNumber', 'cvv', 'password']) {
    const result = validateSubmission({ ...validBody, [field]: 'x' });
    assert.equal(result.valid, false);
    assert.equal(result.errors[0].field, field);
  }
});

test('rejects an unknown option', () => {
  const result = validateSubmission({ ...validBody, option: 'Platinum' });
  assert.equal(result.valid, false);
});

test('rejects malformed emails', () => {
  for (const email of ['not-an-email', 'missing@domain', '']) {
    assert.equal(validateSubmission({ ...validBody, email }).valid, false);
  }
});

test('rejects non-object bodies', () => {
  for (const body of [null, 'string', 42, ['array']]) {
    const result = validateSubmission(body);
    assert.equal(result.valid, false);
    assert.equal(result.errors[0].field, 'body');
  }
});

test('reports every invalid field at once', () => {
  const result = validateSubmission({ firstName: '', lastName: '', email: 'nope', option: '' });
  assert.equal(result.errors.length, 4);
});
```

Install and run:

```cmd
cd api
npm install
npm test
```

### 6.9 `api/list-items.js` — inspect stored data

A local utility. Excluded from deployment via `.funcignore`.

```js
// Usage (from the api/ folder):  node list-items.js
const fs = require('node:fs');
const path = require('node:path');
const { CosmosClient } = require('@azure/cosmos');

function loadLocalSettings() {
    const file = path.join(__dirname, 'local.settings.json');
    if (!fs.existsSync(file)) return;
    const { Values } = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const [key, value] of Object.entries(Values || {})) {
        if (!process.env[key]) process.env[key] = value;
    }
}

async function main() {
    loadLocalSettings();
    const endpoint = process.env.COSMOS_ENDPOINT;
    const key = process.env.COSMOS_KEY;
    if (!endpoint || !key) throw new Error('Set COSMOS_ENDPOINT and COSMOS_KEY in api/local.settings.json.');

    const container = new CosmosClient({ endpoint, key })
        .database(process.env.COSMOS_DATABASE)
        .container(process.env.COSMOS_CONTAINER);

    const { resources } = await container.items.query('SELECT * FROM c').fetchAll();
    console.log(`\n${resources.length} item(s) found:\n`);
    console.table(resources);
}

main().catch((err) => { console.error('Query failed:', err.message); process.exit(1); });
```

> The Azure CLI has **no data-plane query command** — `az cosmosdb sql container query`
> does not exist. Use this script or the Portal's **Data Explorer**.

---

## 7. Write the frontend

The only part that matters is the fetch call. Adapt to your framework.

```js
const ENDPOINT = '/api/submissions';   // same-origin: no CORS, no absolute URL

async function submitForm(form) {
    const data = Object.fromEntries(new FormData(form).entries());

    // Build the payload from an ALLOW-LIST: name every field explicitly.
    // Sensitive inputs are simply never referenced, so they cannot be sent.
    const payload = {
        firstName: data.firstName,
        lastName:  data.lastName,
        email:     data.email,
        option:    data.option,
    };

    setSubmitting(true);
    try {
        const response = await fetch(ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });

        if (!response.ok) throw new Error(await readErrorMessage(response));

        showSuccess("You're all set!");
    } catch (error) {
        showError(error.message);
    } finally {
        setSubmitting(false);      // always re-enable, even on failure
    }
}

async function readErrorMessage(response) {
    if (response.status === 404) {
        // No API behind the site — a static host, or a routing misconfiguration.
        return 'The service is unavailable in this environment.';
    }
    const body = await response.json().catch(() => null);
    if (body && Array.isArray(body.details) && body.details.length > 0) {
        return body.details.map((d) => d.message).join(' ');
    }
    return (body && body.error) || 'Something went wrong. Please try again.';
}
```

**Three habits worth keeping:**

- **Allow-list the payload.** Construct a new object naming each field. Never
  `JSON.stringify(data)` straight from a form — a field added to the HTML later would be
  silently transmitted.
- **Re-enable the button in `finally`.** Otherwise a failed request leaves the form stuck.
- **Handle 404 distinctly.** It's the signature of "no API here," and pointing that out
  saves hours of debugging.

---

## 8. Configure routing

### `staticwebapp.config.json` (repo root)

Static Web Apps **ignores `nginx.conf`, `.htaccess`, and `web.config`**. This file is the
only routing configuration.

```json
{
  "platform": {
    "apiRuntime": "node:20"
  },
  "navigationFallback": {
    "rewrite": "/index.html",
    "exclude": [
      "/api/*",
      "/assets/*",
      "/css/*",
      "/js/*",
      "/*.{png,jpg,jpeg,gif,svg,ico,webp,css,js,json,woff,woff2,otf,mp3,mp4}"
    ]
  },
  "mimeTypes": {
    ".json": "application/json",
    ".webp": "image/webp",
    ".otf": "font/otf",
    ".mp3": "audio/mpeg"
  },
  "globalHeaders": {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "SAMEORIGIN",
    "Referrer-Policy": "strict-origin-when-cross-origin"
  },
  "routes": [
    { "route": "/api/submissions", "methods": ["POST"], "allowedRoles": ["anonymous"] },
    { "route": "/assets/*", "headers": { "Cache-Control": "public, max-age=604800, immutable" } },
    { "route": "/*.html", "headers": { "Cache-Control": "no-cache" } },
    { "route": "/README.md", "statusCode": 404 }
  ],
  "responseOverrides": {
    "404": { "rewrite": "/index.html", "statusCode": 404 }
  }
}
```

> ⚠️ **`/api/*` must appear in `navigationFallback.exclude`.** Without it, API calls are
> rewritten to `index.html`: `fetch` receives HTML with a 200 status, and
> `response.json()` fails with a baffling parse error. This is the single most common
> Static Web Apps misconfiguration.

**`platform.apiRuntime`** pins the Node version (`node:18`, `node:20`). Without it Azure
picks a default that may differ from what you tested.

**`mimeTypes`** — any extension the platform doesn't know is served as
`application/octet-stream` and downloads instead of rendering. Add unusual ones
explicitly.

---

## 9. Create the Azure resources

### 9.1 Register resource providers

New subscriptions have these disabled. Without registration, creation fails with
`MissingSubscriptionRegistration`.

```cmd
az provider register --namespace Microsoft.DocumentDB
az provider register --namespace Microsoft.Web
```

Registration is asynchronous. Poll until both report `Registered` (1–3 minutes):

```cmd
az provider show --namespace Microsoft.DocumentDB --query registrationState -o tsv
az provider show --namespace Microsoft.Web --query registrationState -o tsv
```

### 9.2 Resource group

```cmd
az group create --name <RG_NAME> --location <REGION>
```

### 9.3 Cosmos DB account

Takes ~5 minutes.

```cmd
az cosmosdb create --name <COSMOS_NAME> --resource-group <RG_NAME> --locations regionName=<REGION> failoverPriority=0 isZoneRedundant=False --capabilities EnableServerless --enable-free-tier true
```

| Flag | Why |
|---|---|
| `--capabilities EnableServerless` | Billed per request. No idle cost. Ideal for low/spiky traffic |
| `--enable-free-tier true` | First 1000 RU/s and 25 GB free, forever |

> **One free-tier account per subscription.** If it errors, drop `--enable-free-tier true`
> — serverless alone still costs pennies at low volume.

> **Name already taken?** Cosmos names are globally unique. Add digits.

> The warning `enable_pbe is not a known attribute...` is a harmless CLI/SDK version
> mismatch.

### 9.4 Choosing a partition key

**This decision is effectively permanent** — changing it requires migrating to a new
container.

Cosmos distributes documents across physical partitions by hashing this value. A good key
has:

1. **High cardinality** — many distinct values (`/email`, `/userId`, `/tenantId`). A key
   with 3 possible values creates 3 hot partitions.
2. **Even distribution** — no single value dominating.
3. **Query alignment** — the value you most often filter by, so queries stay
   single-partition and cheap.

| Use case | Good key | Avoid |
|---|---|---|
| User submissions | `/email`, `/userId` | `/country`, `/status` |
| Multi-tenant app | `/tenantId` | `/plan` |
| Event logging | `/deviceId` | `/date` (hot on today) |

**Anti-pattern:** a key with few distinct values, or one that concentrates writes on one
value (like today's date).

### 9.5 Database and container

```cmd
az cosmosdb sql database create -a <COSMOS_NAME> -g <RG_NAME> -n <DB_NAME>

az cosmosdb sql container create -a <COSMOS_NAME> -g <RG_NAME> -d <DB_NAME> -n <CONTAINER_NAME> --partition-key-path "<PARTITION_KEY>"
```

`createIfNotExists` in [§6.5](#65-apidbjs--the-cosmos-client) also creates these, but
pre-creating makes the partition key explicit and reviewable.

### 9.6 Retrieve the credentials

```cmd
az cosmosdb show --name <COSMOS_NAME> --resource-group <RG_NAME> --query documentEndpoint -o tsv

az cosmosdb keys list --name <COSMOS_NAME> --resource-group <RG_NAME> --query primaryMasterKey -o tsv
```

> 🔐 **The primary key grants full read/write to the entire account.** Never commit it,
> paste it into chat/tickets/screenshots, or send it to third parties. If exposed, rotate
> it ([§17](#17-security-checklist)).

---

## 10. Run it locally

Test against the real database **before** deploying — it catches configuration errors in
seconds rather than through 3-minute deploy cycles.

### 10.1 Configure

```cmd
copy api\local.settings.json.example api\local.settings.json
```

Paste the endpoint and key from §9.6 into `api/local.settings.json`.

> Confirm it is git-ignored: `git status --short` must **not** list it.

### 10.2 Start

```cmd
swa start . --api-location ./api
```

Open **http://localhost:4280**.

| | Meaning |
|---|---|
| `.` | Serve the current folder as the website |
| `--api-location ./api` | Start the Functions host and proxy `/api/*` to it |
| Port **4280** | The site — use this |
| Port **7071** | Raw API only, no website |

> ❌ **Do not open the HTML file directly.** Under `file://` or a plain static server
> there is no `/api/*` proxy and every call fails.

Watch for `Functions: submissions: [POST] http://localhost:7071/api/submissions`. If you
instead see **"No job functions found"**, the Node worker crashed — the stack trace
immediately above names the file and line.

### 10.3 Verify

Submit the form, then:

```cmd
cd api
node list-items.js
```

Or test the API directly (**in `cmd`**, not PowerShell):

```cmd
curl -s -X POST http://localhost:4280/api/submissions -H "Content-Type: application/json" -d "{\"firstName\":\"Test\",\"lastName\":\"User\",\"email\":\"test@example.com\",\"option\":\"Pro\"}"
```

Expect `{"id":"...","alreadyExists":false}`. Running it again returns
`"alreadyExists":true` — the idempotency check working.

---

## 11. Push to GitHub

Static Web Apps deploys **from the repository**, so the code must be there first.

```cmd
git add -A
git status --short
```

> 🛑 **Read that output before committing.** `api/local.settings.json` and `node_modules/`
> must not appear. A key committed to Git is in the history permanently — rewriting it
> requires `git filter-repo` and a force-push.

```cmd
git commit -m "feat: static site with Functions API and Cosmos DB"
git branch -M <BRANCH>
git remote add origin https://github.com/<GITHUB_USER>/<REPO_NAME>.git
git push -u origin <BRANCH>
```

### Filename casing

Windows and macOS are case-insensitive; the Linux hosts behind Static Web Apps are not.
`Logo.png` referenced as `logo.png` works locally and 404s in production.

Git on Windows needs two steps to record a case-only rename:

```cmd
git mv assets/Logo.png assets/logo.tmp.png
git mv assets/logo.tmp.png assets/logo.png
```

---

## 12. Create the Static Web App

```cmd
az staticwebapp create --name <SWA_NAME> --resource-group <RG_NAME> --source https://github.com/<GITHUB_USER>/<REPO_NAME> --branch <BRANCH> --location <SWA_REGION> --app-location "/" --api-location "api" --output-location "" --login-with-github
```

| Flag | Meaning |
|---|---|
| `--location` | **Must** be a SWA region: `eastasia`, `westus2`, `centralus`, `eastus2`, `westeurope` |
| `--app-location "/"` | Site files at the repo root |
| `--api-location "api"` | The Functions app folder — **omit to deploy without an API** |
| `--output-location ""` | No build step; files served as-is (see [§15](#15-framework-builds-react-vue-angular)) |

A device code appears — open <https://github.com/login/device>, paste it, authorize.

Azure commits a workflow to `.github/workflows/`, so sync it:

```cmd
git pull origin <BRANCH>
```

**Every push to `<BRANCH>` now redeploys automatically.**

---

## 13. Configure app settings

The deployed API **cannot read `local.settings.json`** — it isn't deployed. Supply the
same values as app settings:

```cmd
az staticwebapp appsettings set --name <SWA_NAME> --resource-group <RG_NAME> --setting-names COSMOS_ENDPOINT=https://<COSMOS_NAME>.documents.azure.com:443/ COSMOS_DATABASE=<DB_NAME> COSMOS_CONTAINER=<CONTAINER_NAME> COSMOS_KEY=<your-primary-key>
```

> ⚠️ **This command REPLACES the entire set.** Any setting you omit is **deleted**. Always
> pass every setting together, every time.

> ⚠️ **Settings apply to the running app, not to builds.** If the site deployed *before*
> the settings existed, the API returns 500 until the next deployment or restart. **This
> is the most common cause of "could not store" errors.**

Verify (`null` values are redaction, not empty):

```cmd
az staticwebapp appsettings list --name <SWA_NAME> --resource-group <RG_NAME>
```

---

## 14. Verify

### 14.1 Watch the build

```
https://github.com/<GITHUB_USER>/<REPO_NAME>/actions
```

2–4 minutes. **It must be green before testing.**

### 14.2 Get the URL

```cmd
az staticwebapp show --name <SWA_NAME> --resource-group <RG_NAME> --query defaultHostname -o tsv
```

### 14.3 Test the API directly

Run in **`cmd`** — PowerShell aliases `curl` to `Invoke-WebRequest`, which parses this
quoting differently.

```cmd
curl -s -X POST https://<hostname>/api/submissions -H "Content-Type: application/json" -d "{\"firstName\":\"Diag\",\"lastName\":\"Test\",\"email\":\"diag@example.com\",\"option\":\"Pro\"}"
```

| Response | Meaning |
|---|---|
| `{"id":"...","alreadyExists":false}` | ✅ Working end to end |
| `{"id":"...","alreadyExists":true}` | ✅ Idempotency check working (run twice) |
| `{"error":"Could not store..."}` | App settings missing or wrong → §13 |
| HTML instead of JSON | `/api/*` missing from `navigationFallback.exclude` → §8 |
| 404 | API not deployed — check `--api-location` and the build log |

### 14.4 Test the site

Open `https://<hostname>` and submit the form.

> **Hard-refresh (Ctrl+Shift+R)** after every deployment. Browsers cache JavaScript
> aggressively, and testing stale JS against a new API wastes a lot of time.

### 14.5 Confirm storage

```cmd
cd api
node list-items.js
```

### 14.6 It is public

The URL is reachable by **anyone on the internet** — no login, no IP restriction. Test
from your phone on mobile data to confirm.

The API is public too. Anyone can POST to it, which is exactly why server-side validation
([§6.6](#66-apivalidationjs--the-trust-boundary)) is load-bearing rather than
belt-and-braces.

---

## 15. Framework builds (React, Vue, Angular)

For a framework, change one flag and let Azure run the build:

| Framework | `--app-location` | `--output-location` |
|---|---|---|
| Plain HTML | `/` | `""` |
| React (CRA) | `/` | `build` |
| React (Vite) | `/` | `dist` |
| Vue | `/` | `dist` |
| Angular | `/` | `dist/<project-name>` |
| Next.js (static export) | `/` | `out` |

```cmd
az staticwebapp create ... --app-location "/" --output-location "dist" --api-location "api"
```

Azure runs `npm install && npm run build` in `--app-location`, then publishes
`--output-location`. Adjust the same values in `.github/workflows/azure-static-web-apps-*.yml`
if you change them later.

> Frameworks that need a Node server at runtime (Next.js SSR, Nuxt SSR) require **hybrid
> rendering** or Azure App Service instead. Static export works on Static Web Apps;
> server-side rendering generally does not.

---

## 16. Troubleshooting

### Installation

| Symptom | Cause | Fix |
|---|---|---|
| `'git' is not recognized` | Per-user install not on `PATH` | `set PATH=%PATH%;%LOCALAPPDATA%\Programs\Git\cmd` |
| `winget install Git.Git` exits 1, says already installed | Upgrade failed (files in use) | Harmless — Git works |
| `✖ Found Azure Functions Core Tools v4 which is incompatible with your current Node.js` | Node 24+ | Install Node 22 (§4.2) |
| Core Tools npm install → `Expected: 200, Actual: 404` | npm wrapper points at a non-existent CDN artifact | Install via winget (§4.3) |
| `node`/`npm` not found after install | New `PATH` not loaded | Open a **new** terminal |
| `az` not recognized after install | Same | Open a **new** terminal |

### Azure resource creation

| Symptom | Cause | Fix |
|---|---|---|
| `MissingSubscriptionRegistration` | Provider not registered | `az provider register` (§9.1) |
| `ResourceNotFound` on database/container create | The account creation above it failed | Fix that first; these errors are cascading |
| Cosmos create fails on the name | Names are globally unique | Add digits |
| `--enable-free-tier` rejected | Subscription already has a free-tier account | Drop the flag |
| `RequestDisallowedByPolicy` | Corporate Azure Policy | Ask your admin — often a required tag or an allowed-region list |
| `AuthorizationFailed` | Insufficient RBAC | §3 |
| `enable_pbe is not a known attribute` | CLI/SDK version mismatch | Cosmetic — ignore |

### Local development

| Symptom | Cause | Fix |
|---|---|---|
| `The SSL connection could not be established` at startup | Corporate TLS inspection blocking the extension bundle CDN | Remove `extensionBundle` from `host.json` (§6.2) |
| `No job functions found` + all `/api/*` 404 | The Node worker crashed at import; the static server keeps serving | Read the stack trace directly above the message |
| `ReferenceError: X is not defined` | A constant was removed/commented out but is still referenced or exported | Restore the declaration or remove **all** its usages |
| `ERR_CONNECTION_REFUSED` on :4280 | `swa start` isn't running | Restart; keep the terminal open |
| API calls 404 from a page that loads fine | Opened via `file://` or Live Server | Use `swa start` and port 4280 |
| `Cosmos DB is not configured` | `local.settings.json` missing or unfilled | §10.1 |
| Changes not reflected | Functions host caches modules | Restart `swa start` |

### Deployment

| Symptom | Cause | Fix |
|---|---|---|
| Build fails on the API step | Missing `package-lock.json`, or a Node version mismatch | Commit the lock file; set `platform.apiRuntime` |
| Site deploys, `/api/*` returns 404 | `--api-location` not set, or the folder name is wrong | Recreate, or edit the workflow YAML |
| `fetch` gets HTML instead of JSON | `/api/*` missing from `navigationFallback.exclude` | §8 |
| Image 404s in production but works locally | Filename casing | Two-step `git mv` (§11) |
| 500 "could not store" | App settings missing, or set after deployment | §13, then redeploy |
| Settings disappeared | `appsettings set` replaces the whole set | Always pass all settings together |
| Old code still running | Browser cache | Ctrl+Shift+R |
| Deployment doesn't trigger | Pushed to a different branch | Push to `<BRANCH>` |

### Diagnosing a 500

1. Temporarily enable diagnostics — **include every existing setting**:
   ```cmd
   az staticwebapp appsettings set --name <SWA_NAME> --resource-group <RG_NAME> --setting-names DEBUG_ERRORS=1 COSMOS_ENDPOINT=... COSMOS_DATABASE=... COSMOS_CONTAINER=... COSMOS_KEY=...
   ```
2. Retry the request; read the `debug` object in the response (DevTools → Network →
   Response).
3. Interpret:

| `code` | Meaning | Fix |
|---|---|---|
| `401` / `403` | Bad or rotated key; metadata-write restrictions | Re-fetch the key; pre-create the DB/container |
| `404` | Database or container doesn't exist | §9.5, or check names |
| `ENOTFOUND` / `ETIMEDOUT` | Endpoint wrong or firewall | Verify the endpoint; check Cosmos networking |
| `Cosmos DB is not configured` | App settings absent from the runtime | §13, then redeploy |

4. **Remove `DEBUG_ERRORS` when finished** — it exposes internals publicly.

---

## 17. Security checklist

- [ ] `api/local.settings.json` is git-ignored and was never committed
- [ ] `git log --all -- api/local.settings.json` returns nothing
- [ ] The key exists only in app settings and your local file
- [ ] `DEBUG_ERRORS` is **not** set in production
- [ ] Validation rejects sensitive fields (`FORBIDDEN_FIELDS`)
- [ ] Prices/roles/totals are derived server-side, never read from the request
- [ ] The stored document is built from validator output, never `...body`
- [ ] Logs record IDs and outcomes, never personal data
- [ ] The public URL is intentional — anyone can find and use it

### Rotate an exposed key

Treat pasting a key into chat, a ticket, a screenshot, or a log as disclosure.

```cmd
az cosmosdb keys regenerate --name <COSMOS_NAME> --resource-group <RG_NAME> --key-kind primary
```

Then update **both** `api/local.settings.json` and the app settings (§13).

> Rotate the *secondary* key first in production systems, switch traffic to it, then
> rotate the primary — this avoids downtime.

### Payment data

If your form touches card details: **never store the full card number or CVV.** PCI DSS
3.3.1 prohibits retaining the verification code after authorization under all
circumstances.

Send card data directly to a PCI-compliant provider (Stripe, Adyen, PayMongo) using their
JS SDK — it never touches your server — and store only the returned token. If you must
display card info, store **brand + last 4 + expiry** only, exactly as real billing pages
do.

> Cosmos DB is **schema-less**: it will happily store a `cvv` field. There is no
> database-level protection. Your validator **is** the schema — which is why it needs
> tests.

### Consider adding

- **Rate limiting** — the endpoint is public and unthrottled. Azure Front Door or a
  simple per-IP counter.
- **CAPTCHA** — for public forms attracting bots.
- **Managed identity** — replace the key with Entra ID + a Cosmos data-plane role
  assignment. No secret to rotate.

---

## 18. Cost and limits

**$0/month** for typical small projects.

| Service | Free allowance | Then |
|---|---|---|
| Static Web Apps (Free) | 100 GB bandwidth/month, 250 MB app size, free SSL, 2 custom domains | Standard ~$9/month |
| Cosmos DB free tier | 1000 RU/s + 25 GB, forever, one account per subscription | ~$0.25 per million RU |
| Cosmos serverless | No idle charge | Billed per request |

**Free-tier limits worth knowing:**

- **250 MB deployed app size.** Large media (video, audio) will exceed this — move it to
  Blob Storage.
- **No SLA** on the Free tier.
- **Staging environments** are limited to 3.

**Scaling behaviour:** static files come from CDN edges and scale effectively without
limit. The API scales out per request, with a 1–3 second cold start after idle. Cosmos
scales by partition — which is why [§9.4](#94-choosing-a-partition-key) matters.

---

## 19. Teardown

Deleting the resource group removes **everything** — Static Web App, Cosmos account, and
all data. Irreversible.

```cmd
az group delete --name <RG_NAME> --yes --no-wait
```

Then remove the workflow file and the `AZURE_STATIC_WEB_APPS_API_TOKEN` secret from the
GitHub repository settings.

---

## 20. Command reference

```cmd
:: ---------- One-time setup ----------
az login
az provider register --namespace Microsoft.DocumentDB
az provider register --namespace Microsoft.Web
az group create --name <RG_NAME> --location <REGION>

:: ---------- Cosmos DB ----------
az cosmosdb create --name <COSMOS_NAME> --resource-group <RG_NAME> --locations regionName=<REGION> failoverPriority=0 isZoneRedundant=False --capabilities EnableServerless --enable-free-tier true
az cosmosdb sql database create -a <COSMOS_NAME> -g <RG_NAME> -n <DB_NAME>
az cosmosdb sql container create -a <COSMOS_NAME> -g <RG_NAME> -d <DB_NAME> -n <CONTAINER_NAME> --partition-key-path "<PARTITION_KEY>"
az cosmosdb keys list --name <COSMOS_NAME> --resource-group <RG_NAME> --query primaryMasterKey -o tsv

:: ---------- Static Web App ----------
az staticwebapp create --name <SWA_NAME> --resource-group <RG_NAME> --source https://github.com/<GITHUB_USER>/<REPO_NAME> --branch <BRANCH> --location <SWA_REGION> --app-location "/" --api-location "api" --output-location "" --login-with-github
az staticwebapp appsettings set --name <SWA_NAME> --resource-group <RG_NAME> --setting-names COSMOS_ENDPOINT=... COSMOS_DATABASE=... COSMOS_CONTAINER=... COSMOS_KEY=...

:: ---------- Daily use ----------
swa start . --api-location ./api
cd api && npm test
cd api && node list-items.js
git add -A && git commit -m "..." && git push origin <BRANCH>

:: ---------- Inspect ----------
az staticwebapp show --name <SWA_NAME> --resource-group <RG_NAME> --query defaultHostname -o tsv
az staticwebapp appsettings list --name <SWA_NAME> --resource-group <RG_NAME>
az staticwebapp environment list --name <SWA_NAME> --resource-group <RG_NAME>

:: ---------- Security ----------
az cosmosdb keys regenerate --name <COSMOS_NAME> --resource-group <RG_NAME> --key-kind primary

:: ---------- Teardown ----------
az group delete --name <RG_NAME> --yes --no-wait
```

---

## Checklist

**Setup**
- [ ] Tools installed; all six version checks pass
- [ ] Node is 18/20/22 (**not** 24+)
- [ ] `az login` works; correct subscription selected
- [ ] Providers registered

**Build**
- [ ] `.gitignore` created **before** the first commit
- [ ] API: `package.json` (`main` set), `host.json` (no `extensionBundle`), `.funcignore`
- [ ] Validation rejects sensitive fields and derives values server-side
- [ ] Document built from validator output, never `...body`
- [ ] `staticwebapp.config.json` excludes `/api/*` from navigation fallback
- [ ] `npm test` passes

**Deploy**
- [ ] Cosmos account, database, container created; partition key deliberate
- [ ] Works locally via `swa start`, verified against the real database
- [ ] `git status --short` shows no `local.settings.json`, no `node_modules`
- [ ] Filename casing corrected
- [ ] Static Web App created; workflow pulled
- [ ] **App settings configured** and redeployed afterwards

**Verify**
- [ ] Actions build is green
- [ ] `curl` against the deployed API returns 201
- [ ] Form works after a hard refresh
- [ ] Data confirmed in Cosmos
- [ ] `DEBUG_ERRORS` removed
- [ ] Key rotated if it was ever exposed
