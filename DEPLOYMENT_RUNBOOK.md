# Deployment Runbook — my-spotify-web

The **as-built** record of deploying this project: static site + Azure Functions API +
Azure Cosmos DB, running on Azure Static Web Apps.

Every command here was executed on Windows and verified end to end. Errors we actually
hit are documented inline with their fixes — most of them are not obvious from the
official docs.

For deeper background and alternative hosting options (AKS, App Service, containers),
see [AZURE_DEPLOYMENT_GUIDE.md](./AZURE_DEPLOYMENT_GUIDE.md).

---

## Contents

1. [What gets deployed](#1-what-gets-deployed)
2. [Prerequisites](#2-prerequisites)
3. [Azure resources](#3-azure-resources)
4. [Local development](#4-local-development)
5. [Deploy to Azure Static Web Apps](#5-deploy-to-azure-static-web-apps)
6. [Verification](#6-verification)
7. [Post-deployment security](#7-post-deployment-security)
8. [Troubleshooting](#8-troubleshooting)
9. [Why not GitHub Pages](#9-why-not-github-pages)
10. [Resource reference](#10-resource-reference)

---

## 1. What gets deployed

```
Browser  ──►  Azure Static Web Apps (Free)
                ├── static site      (HTML/CSS/JS at repo root)
                └── managed API      (api/ → Node 20 Azure Functions)
                        │
                        └──►  Azure Cosmos DB for NoSQL (serverless, free tier)
                                  database: spotify-web
                                  container: subscriptions   (partition key /email)
```

One resource serves both the site and the API, so `fetch('/api/subscriptions')` is a
same-origin call — no CORS configuration required.

**Cost:** $0/month. Static Web Apps Free tier plus Cosmos DB free tier (first 1000 RU/s
and 25 GB free). Serverless billing means idle time costs nothing.

---

## 2. Prerequisites

Run every `winget` command in a **regular** Command Prompt. Open a **new** terminal
afterwards so `PATH` changes take effect.

### 2.1 Git

```cmd
winget install -e --id Git.Git
```

> **If it fails with exit code 1** and the log says a package is already installed, Git
> is present and the *upgrade* failed (usually because files were in use). Harmless.

> **If `git` is not recognized afterwards**, it installed per-user and isn't on `PATH`.
> Verify with `where git`; the per-user location is
> `%LOCALAPPDATA%\Programs\Git\cmd`. Add it for the current window with:
>
> ```cmd
> set PATH=%PATH%;%LOCALAPPDATA%\Programs\Git\cmd
> ```
>
> To make it permanent, add that folder via **Settings → System → About → Advanced
> system settings → Environment Variables**.

### 2.2 Node.js — must be 18, 20 or 22

```cmd
winget install -e --id OpenJS.NodeJS.LTS
node --version
```

> ⚠️ **Azure Functions Core Tools v4 does not support Node 24+.** If `node --version`
> reports 24 or newer, `swa start` fails with:
>
> ```
> ✖ Found Azure Functions Core Tools v4 which is incompatible with your current Node.js v24.x
> ```
>
> The winget catalogue may only carry Node 24+, so install 22 from the official MSI:
>
> ```cmd
> winget uninstall -e --id OpenJS.NodeJS.LTS
> curl -L -o "%TEMP%\node22.msi" https://nodejs.org/dist/v22.23.2/node-v22.23.2-x64.msi
> msiexec /i "%TEMP%\node22.msi"
> ```
>
> Then open a new terminal and confirm `node --version` prints `v22.x`.

### 2.3 Azure Functions Core Tools

```cmd
winget install -e --id Microsoft.Azure.FunctionsCoreTools
```

> ⚠️ **Do not use npm for this.** `npm install -g azure-functions-core-tools@4` requests
> a CDN artifact that does not exist and fails with:
>
> ```
> Error downloading zip file from https://cdn.functions.azure.com/public/.../Azure.Functions.Cli.win-x64.4.13.2.zip
> Expected: 200, Actual: 404
> ```
>
> Clean up a partial npm install first:
> ```cmd
> rmdir /s /q "%APPDATA%\npm\node_modules\azure-functions-core-tools"
> ```

### 2.4 Static Web Apps CLI

```cmd
npm install -g @azure/static-web-apps-cli
swa --version
```

The `keytar` and deprecation warnings during install are expected and harmless.

### 2.5 Azure CLI

```cmd
winget install -e --id Microsoft.AzureCLI
az version
az login
az account show --output table
```

### 2.6 Install the API dependencies

```cmd
cd C:\path\to\my-spotify-web\api
npm install
npm test
```

Expect all tests to pass. Re-run `npm install` after any Node version change.

---

## 3. Azure resources

### 3.1 Register resource providers

A new subscription has these disabled, and resource creation fails with
`MissingSubscriptionRegistration` until they're registered.

```cmd
az provider register --namespace Microsoft.DocumentDB
az provider register --namespace Microsoft.Web
```

Registration runs in the background. Poll until both report `Registered` (1–3 minutes):

```cmd
az provider show --namespace Microsoft.DocumentDB --query registrationState -o tsv
az provider show --namespace Microsoft.Web --query registrationState -o tsv
```

### 3.2 Resource group

```cmd
az group create --name rg-spotify-web-prod --location southeastasia
```

### 3.3 Cosmos DB account

Account names are **globally unique** — change the suffix if the name is taken. Takes
about 5 minutes.

```cmd
az cosmosdb create --name cosmos-spotify-web-0425 --resource-group rg-spotify-web-prod --locations regionName=southeastasia failoverPriority=0 isZoneRedundant=False --capabilities EnableServerless --enable-free-tier true
```

> A subscription may only have **one** free-tier Cosmos account. If it errors, drop
> `--enable-free-tier true`.
>
> The warning `enable_pbe is not a known attribute ...` is a harmless CLI/SDK version
> mismatch.

### 3.4 Database and container

```cmd
az cosmosdb sql database create -a cosmos-spotify-web-0425 -g rg-spotify-web-prod -n spotify-web

az cosmosdb sql container create -a cosmos-spotify-web-0425 -g rg-spotify-web-prod -d spotify-web -n subscriptions --partition-key-path "/email"
```

The application also creates these on first use, but pre-creating them keeps the
partition key explicit and reviewable.

### 3.5 Retrieve the credentials

```cmd
az cosmosdb show --name cosmos-spotify-web-0425 --resource-group rg-spotify-web-prod --query documentEndpoint -o tsv
az cosmosdb keys list --name cosmos-spotify-web-0425 --resource-group rg-spotify-web-prod --query primaryMasterKey -o tsv
```

⚠️ The primary key grants **full read/write** to the account. Never commit it, paste it
into a chat/ticket, or send it to a third party. See [§7](#7-post-deployment-security).

---

## 4. Local development

### 4.1 Configure

```cmd
copy api\local.settings.json.example api\local.settings.json
```

Fill in the endpoint and key from §3.5:

```json
{
  "IsEncrypted": false,
  "Values": {
    "FUNCTIONS_WORKER_RUNTIME": "node",
    "AzureWebJobsStorage": "",
    "COSMOS_ENDPOINT": "https://cosmos-spotify-web-0425.documents.azure.com:443/",
    "COSMOS_KEY": "<primary key>",
    "COSMOS_DATABASE": "spotify-web",
    "COSMOS_CONTAINER": "subscriptions"
  },
  "Host": { "CORS": "*" }
}
```

`api/local.settings.json` is listed in [.gitignore](./.gitignore) — keep it that way.

### 4.2 Run the whole stack

```cmd
cd C:\path\to\my-spotify-web
swa start . --api-location ./api
```

Open **http://localhost:4280/premium.html**.

- `.` serves the repo root as the website.
- `--api-location ./api` starts the Functions host and proxies `/api/*` to it.
- Port **4280** is the site. Port **7071** is the raw API, no website.
- Do **not** open the HTML file directly — under `file://` the API path doesn't resolve.

### 4.3 Inspect stored data

```cmd
cd api
node list-subscriptions.js
```

Reads `local.settings.json` and prints every stored subscription. Excluded from
deployment via [.funcignore](./api/.funcignore). Azure Portal → Cosmos account → **Data
Explorer** shows the same records.

---

## 5. Deploy to Azure Static Web Apps

### 5.1 Push to GitHub

Static Web Apps builds from the repository, so the code must be pushed first.

```cmd
git add -A
git status --short
```

**Check the output before committing** — `api/local.settings.json` and `node_modules/`
must not appear.

```cmd
git commit -m "feat: add subscriptions API, Cosmos storage, and Azure deployment config"
git push origin main
```

### 5.2 Fix asset filename casing

Windows and macOS are case-insensitive; the Linux hosts behind Static Web Apps are not.
`assets/Benefit_2.png` referenced as `./assets/benefit_2.png` in
[premium.html](./premium.html) returns 404 once deployed. Git on Windows needs two steps
to record a case-only rename:

```cmd
git mv assets/Benefit_2.png assets/benefit_2.tmp.png
git mv assets/benefit_2.tmp.png assets/benefit_2.png
```

### 5.3 Create the Static Web App

```cmd
az staticwebapp create --name swa-spotify-web --resource-group rg-spotify-web-prod --source https://github.com/candare109/my-spotify-web --branch main --location eastasia --app-location "/" --api-location "api" --output-location "" --login-with-github
```

- `--location` must be a **Static Web Apps** region: `eastasia`, `westus2`, `centralus`,
  `eastus2`, `westeurope`. It is independent of the resource group's region.
- `--app-location "/"` — site files at the repo root.
- `--api-location "api"` — the Functions app.
- `--output-location ""` — no build step; files are served as-is.

Follow the device-code prompt to authorize GitHub. Azure then commits a workflow to
`.github/workflows/`, so sync it locally:

```cmd
git pull origin main
```

Every push to `main` now triggers a redeploy.

### 5.4 Configure the API's app settings

The deployed API cannot read `local.settings.json`. Supply the same values as app
settings:

```cmd
az staticwebapp appsettings set --name swa-spotify-web --resource-group rg-spotify-web-prod --setting-names COSMOS_ENDPOINT=https://cosmos-spotify-web-0425.documents.azure.com:443/ COSMOS_DATABASE=spotify-web COSMOS_CONTAINER=subscriptions COSMOS_KEY=<primary key>
```

> ⚠️ **This command replaces the entire set.** Any setting you omit is deleted. Always
> pass every setting together.

> ⚠️ **Settings apply to the running app, not the build.** If the site was deployed
> before the settings existed, the API returns 500 until the next deployment or restart.
> This is the most common cause of *"Could not store the subscription"*.

The `null` values shown in the response are redaction, not empty values. Confirm with:

```cmd
az staticwebapp appsettings list --name swa-spotify-web --resource-group rg-spotify-web-prod
```

### 5.5 Runtime configuration

[staticwebapp.config.json](./staticwebapp.config.json) at the repo root controls routing,
MIME types, headers and the API runtime. Static Web Apps **ignores `nginx.conf`**.

Key entries:

- `platform.apiRuntime: "node:20"` — pins the managed Functions runtime.
- `navigationFallback.exclude` — must list `/api/*`, or API calls get rewritten to
  `index.html` and appear as 404s.
- `mimeTypes` — `.jfif`, `.otf` and `.mp3` need explicit entries.

[api/host.json](./api/host.json) deliberately has **no `extensionBundle`**. HTTP triggers
are built into the runtime, and the bundle download fails behind TLS-inspecting corporate
networks (see [§8](#8-troubleshooting)).

---

## 6. Verification

### 6.1 Watch the build

`https://github.com/<owner>/<repo>/actions` — 2–4 minutes. It must be green before
testing.

### 6.2 Get the URL

```cmd
az staticwebapp show --name swa-spotify-web --resource-group rg-spotify-web-prod --query defaultHostname -o tsv
```

### 6.3 Test the API directly

Run in **cmd**, not PowerShell — PowerShell aliases `curl` to `Invoke-WebRequest`, which
parses the quoting differently.

```cmd
curl -s -X POST https://<hostname>/api/subscriptions -H "Content-Type: application/json" -d "{\"firstName\":\"Diag\",\"lastName\":\"Test\",\"email\":\"diag-probe@example.com\",\"plan\":\"Individual\"}"
```

Expected first call:

```json
{"id":"...","plan":"Individual","price":"179 RS/month","createdAt":"...","alreadySubscribed":false}
```

Running it again returns `"alreadySubscribed":true` — the same email and plan is
idempotent rather than creating a duplicate.

### 6.4 Test the site

Open `https://<hostname>/premium.html` and subscribe. **Hard-refresh (Ctrl+Shift+R)**
after a deployment, or the browser may run cached JavaScript.

### 6.5 Confirm storage

```cmd
cd api
node list-subscriptions.js
```

A record created through the form contains `cardBrand`, `cardLast4`, `cardExpiryMonth`
and `cardExpiryYear` — and never a full card number or CVV.

---

## 7. Post-deployment security

### 7.1 Rotate the Cosmos key if it was ever exposed

Treat pasting a key into a chat, ticket, screenshot or log as a disclosure.

```cmd
az cosmosdb keys regenerate --name cosmos-spotify-web-0425 --resource-group rg-spotify-web-prod --key-kind primary
```

Then update **both** `api/local.settings.json` and the app settings (§5.4).

### 7.2 Disable diagnostics in production

`DEBUG_ERRORS=1` makes the API return internal exception details. Useful while
debugging, but it leaks implementation detail publicly. Remove it by re-running §5.4
without it.

### 7.3 Card data policy

The full card number and CVV are **never transmitted or stored**. Enforced in three
independent layers:

| Layer | File | Mechanism |
|-------|------|-----------|
| Browser | [component/subscribeModal.js](./component/subscribeModal.js) | Payload built from an allow-list; only brand, last 4 and expiry are sent |
| API validation | [api/validation.js](./api/validation.js) | `FORBIDDEN_FIELDS` rejects any request containing `cardNumber`, `cvv`, `cvc`, `expiryDate` with a 400 |
| Persistence | [api/index.js](./api/index.js) | The document is built from the validator's output, never from the raw request body |

PCI DSS 3.3.1 prohibits retaining the card verification code after authorization under
all circumstances. Cosmos DB is schema-less and will store whatever it is sent — these
code paths are the *only* thing preventing it, which is why
[api/validation.test.js](./api/validation.test.js) asserts on them.

A production payment flow would send card details directly to a PCI-compliant provider
(Stripe, PayMongo, Adyen) and store only the returned token.

---

## 8. Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `'git' is not recognized` | Per-user install not on `PATH` | `set PATH=%PATH%;%LOCALAPPDATA%\Programs\Git\cmd` |
| `Found Azure Functions Core Tools v4 which is incompatible with your current Node.js` | Node 24+ | Install Node 22 (§2.2) |
| Core Tools npm install → `Expected: 200, Actual: 404` | npm wrapper points at a non-existent CDN artifact | Install via winget (§2.3) |
| `MissingSubscriptionRegistration` | Resource provider not registered | `az provider register` (§3.1) |
| `The SSL connection could not be established` during `func`/`swa` startup | Corporate TLS inspection blocking the extension bundle CDN | Remove `extensionBundle` from `api/host.json` — unnecessary for HTTP-only functions |
| `No job functions found` + every `/api/*` returns 404 | The Node worker crashed at import; the static server keeps running | Read the stack trace directly above the message; fix the module error |
| `ReferenceError: X is not defined` in `validation.js` | A constant was commented out but is still referenced/exported | Restore the declaration or remove all its usages |
| `ERR_CONNECTION_REFUSED` on `localhost:4280` | `swa start` isn't running | Restart it and leave the terminal open |
| *"The subscription service is unavailable in this environment."* | 404 from `/api/*` — no API behind the site | Serve via `swa start . --api-location ./api`, not Live Server or `file://` |
| *"Could not store the subscription."* | 500 — the API can't reach Cosmos | Check app settings exist (§5.4) and redeploy; enable `DEBUG_ERRORS=1` to see the real error |
| Deployed site 404s an image that works locally | Filename casing | §5.2 |
| Changes not visible after deploy | Browser cache | Hard-refresh (Ctrl+Shift+R) |
| `az cosmosdb sql container query` → *not recognized* | No such command; the CLI has no data-plane query | Use `node api/list-subscriptions.js` or Data Explorer |

---

## 9. Why not GitHub Pages

GitHub Pages serves **static files only**. There is no server to run the Functions API,
so `POST /api/subscriptions` returns 404 and the form fails with *"The subscription
service is unavailable in this environment."*

Moving the Cosmos key into frontend JavaScript is not a workaround — anyone could read it
in DevTools and gain full read/write access to the database.

If the site must stay on Pages, the API has to be hosted separately (Azure Functions or
Static Web Apps), `SUBSCRIBE_ENDPOINT` in
[component/subscribeModal.js](./component/subscribeModal.js) changed to that absolute
URL, and CORS configured. That means maintaining two deployments for one site.

**Custom domain conflict:** this repo contains a [CNAME](./CNAME) file and a Pages
workflow. A hostname can only point at one host. To use the custom domain on Azure,
remove the CNAME and the Pages workflow, then repoint DNS. Otherwise Azure's free
`*.azurestaticapps.net` hostname works immediately and the two can coexist.

---

## 10. Resource reference

| Item | Value |
|------|-------|
| Resource group | `rg-spotify-web-prod` (southeastasia) |
| Cosmos account | `cosmos-spotify-web-0425` (serverless, free tier) |
| Cosmos endpoint | `https://cosmos-spotify-web-0425.documents.azure.com:443/` |
| Database / container | `spotify-web` / `subscriptions` (partition key `/email`) |
| Static Web App | `swa-spotify-web` (eastasia, Free) |
| Default hostname | `gentle-wave-04296dc00.7.azurestaticapps.net` |
| API endpoint | `POST /api/subscriptions` |
| Local dev | `http://localhost:4280` (site), `http://localhost:7071` (API) |

### Repository layout

```
my-spotify-web/
├── index.html, premium.html, ...      static site (app root)
├── staticwebapp.config.json           routing, MIME, headers, apiRuntime
├── component/subscribeModal.js        subscribe form + client validation
├── api/                               managed Functions API
│   ├── index.js                       POST /api/subscriptions
│   ├── validation.js                  server-side validation, price derivation
│   ├── cosmos.js                      Cosmos client and queries
│   ├── validation.test.js             npm test
│   ├── list-subscriptions.js          local inspection tool
│   ├── host.json, package.json, .funcignore
│   └── local.settings.json            git-ignored, holds the Cosmos key
└── .github/workflows/                 deployment workflow (generated by Azure)
```

### Command quick reference

```cmd
:: Local development
swa start . --api-location ./api
cd api && npm test
cd api && node list-subscriptions.js

:: Deploy (any push to main)
git add -A && git commit -m "..." && git push origin main

:: Inspect
az staticwebapp show --name swa-spotify-web --resource-group rg-spotify-web-prod --query defaultHostname -o tsv
az staticwebapp appsettings list --name swa-spotify-web --resource-group rg-spotify-web-prod

:: Tear down everything
az group delete --name rg-spotify-web-prod --yes --no-wait
```
