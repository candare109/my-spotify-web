# Deploying **my-spotify-web** to Azure — Detailed Step-by-Step Guide

A complete, copy-paste-able runbook for publishing this static site to Azure, including
prerequisites, required repo fixes, five hosting options, custom domains, CI/CD,
monitoring, cost control, troubleshooting and teardown.

> **TL;DR** — Use **Azure Static Web Apps (Free tier)**. Jump to
> [5. Option A — Azure Static Web Apps](#5-option-a--azure-static-web-apps-recommended).
> But do **not** skip [4. Pre-deployment fixes](#4-pre-deployment-fixes-do-these-first) —
> there is a file-name casing bug that breaks an image on any Linux-based host.

---

## Table of contents

1. [What you are deploying](#1-what-you-are-deploying)
2. [Choose a hosting option](#2-choose-a-hosting-option)
3. [Prerequisites](#3-prerequisites)
4. [Pre-deployment fixes (do these first)](#4-pre-deployment-fixes-do-these-first)
5. [Option A — Azure Static Web Apps (recommended)](#5-option-a--azure-static-web-apps-recommended)
6. [Option B — App Service for Containers](#6-option-b--app-service-for-containers)
7. [Option C — Azure Container Apps](#7-option-c--azure-container-apps)
8. [Option D — Azure Kubernetes Service (AKS)](#8-option-d--azure-kubernetes-service-aks)
9. [Option E — Storage static website + Front Door](#9-option-e--storage-static-website--front-door)
10. [Custom domain and TLS](#10-custom-domain-and-tls)
11. [After deployment: monitoring, security, cost](#11-after-deployment-monitoring-security-cost)
12. [CI/CD reference workflows](#12-cicd-reference-workflows)
13. [Troubleshooting](#13-troubleshooting)
14. [Rollback and teardown](#14-rollback-and-teardown)
15. [Appendix: checklists](#15-appendix-checklists)

---

## 1. What you are deploying

| Fact | Value |
| --- | --- |
| Type | Static site — plain HTML, CSS, vanilla JS Web Components + an Azure Functions API |
| Build step | **None for the site.** [`api/`](./api) has its own `package.json`; Static Web Apps runs `npm install` for it automatically |
| Entry point | [`index.html`](./index.html) at the repo root |
| Other pages | [`premium.html`](./premium.html), [`download.html`](./download.html), [`help.html`](./help.html), [`Spotify-songs/songs.html`](./Spotify-songs/songs.html) |
| Components | [`component/header.js`](./component/header.js), [`footer.js`](./component/footer.js), [`payPlan.js`](./component/payPlan.js), [`subscribeModal.js`](./component/subscribeModal.js), [`whyCard.js`](./component/whyCard.js) |
| Styles | [`css/main.css`](./css/main.css), `fonts.css`, `animation.css`, `responsive.css` |
| Media | `assets/` (images, svg, `.otf` font) and `Spotify-songs/songs/*.mp3` + `covers/*.jpg` |
| Backend / API | Azure Functions (Node 18+) in [`api/`](./api) — `POST /api/subscriptions` validates the form and stores it in Cosmos DB |
| Database | Azure Cosmos DB for NoSQL (serverless), database `spotify-web`, container `subscriptions`, partition key `/email` |
| Container assets | [`Dockerfile`](./Dockerfile) (nginx:1.27-alpine) + [`nginx.conf`](./nginx.conf) |
| Kubernetes assets | [`k8s-manifests.yaml`](./k8s-manifests.yaml) (Namespace, Deployment, Service, Ingress) |
| Existing CI | [`.github/workflows/static.yml`](./.github/workflows/static.yml) → **GitHub Pages**, not Azure |
| Custom domain today | [`CNAME`](./CNAME) → `my-spotify-player.com` (used by GitHub Pages) |

Two consequences of the above:

- Because the **site** has no build step, every Azure option below is a "copy files and
  serve them" deployment for the front end. Anywhere you are asked for a build command or
  an output folder, leave it empty — but set the **API location to `api`** so the Functions
  backend ships with it.
- Because the site currently ships **audio files**, watch the app-size limits noted in
  [3.6](#36-know-the-limits-and-costs).

---

## 2. Choose a hosting option

| Option | Best for | Effort | Typical cost | HTTPS | CI/CD |
| --- | --- | --- | --- | --- | --- |
| **A. Static Web Apps** ⭐ | This repo, exactly | Low | **Free tier: $0** | Automatic | Auto-generated GitHub Action |
| B. App Service (container) | You want the nginx config in [`nginx.conf`](./nginx.conf) honoured | Medium | ~Linux B1 plan + ACR Basic | Automatic + managed cert | GH Action or ACR webhook |
| C. Container Apps | Same container, scale-to-zero, no plan to manage | Medium | Consumption, can idle near $0 | Automatic | GH Action / `containerapp up` |
| D. AKS | You specifically want Kubernetes (repo has manifests) | High | Node pool + ACR (highest) | Bring your own (cert-manager) | `kubectl`/GitOps |
| E. Storage static website (+ Front Door) | Cheapest raw hosting | Low–Medium | Cents/month + Front Door if used | Only with Front Door for custom domain | `az storage blob upload-batch` |

**Recommendation: Option A.** Options B–E are fully documented so you can pick another
path if you have a platform requirement (containers, Kubernetes, or an internal standard).

---

## 3. Prerequisites

### 3.1 Azure account and permissions

1. An Azure account with an **active subscription**
   (a free trial includes starter credit; a Free-tier Static Web App costs nothing).
2. Your user needs at least the **Contributor** role on the target subscription or
   resource group.
3. For Options B/C/D you additionally need **User Access Administrator** or **Owner** to
   create the role assignment that lets the app pull from the container registry
   (or you can use registry admin credentials instead — noted inline).

Verify after installing the CLI (see 3.3):

```powershell
az login                      # add --use-device-code if the browser popup fails
az account show --output table
az account list --output table
az account set --subscription "<subscription-name-or-id>"
```

### 3.2 GitHub access

- Admin (or maintain) rights on `candare109/my-spotify-web` so Azure can add a workflow
  file and a repository secret.
- GitHub Actions enabled for the repository.
- The branch you want to deploy from — this guide assumes `main`.

### 3.3 Local tooling

| Tool | Needed for | Install (Windows) | Verify |
| --- | --- | --- | --- |
| Git | All options | `winget install -e --id Git.Git` | `git --version` |
| Azure CLI ≥ 2.53 | All CLI steps | `winget install -e --id Microsoft.AzureCLI` | `az version` |
| A modern browser | Portal + verification | — | — |
| Python **or** Node.js | Local preview server | `winget install -e --id Python.Python.3.12` / `winget install -e --id OpenJS.NodeJS.LTS` | `python --version` / `node --version` |
| Docker Desktop | Options B, C, D (local image build) | `winget install -e --id Docker.DockerDesktop` | `docker --version` |
| kubectl | Option D | `az aks install-cli` | `kubectl version --client` |
| SWA CLI (optional) | Local emulation of Static Web Apps | `npm install -g @azure/static-web-apps-cli` | `swa --version` |
| VS Code + **Azure Static Web Apps** extension (optional) | Portal-free deployment | `winget install -e --id Microsoft.VisualStudioCode` | — |

> After installing the Azure CLI, **open a new terminal** so `az` is on `PATH`.

### 3.4 Register the Azure resource providers you will use

Providers only need registering once per subscription.

```powershell
az provider register --namespace Microsoft.Web                 # Static Web Apps + App Service
az provider register --namespace Microsoft.ContainerRegistry   # Options B, C, D
az provider register --namespace Microsoft.App                 # Option C
az provider register --namespace Microsoft.ContainerService    # Option D
az provider register --namespace Microsoft.Storage             # Option E
az provider register --namespace Microsoft.OperationalInsights # logs
```

Check state (repeat until `Registered`):

```powershell
az provider show --namespace Microsoft.Web --query registrationState --output tsv
```

### 3.5 Decide names and region up front

Fill this in and reuse the values everywhere below.

| Thing | Rule | Example used in this guide |
| --- | --- | --- |
| Resource group | 1–90 chars | `rg-spotify-web-prod` |
| Region (general) | Any Azure region near your users | `southeastasia` |
| Region (Static Web Apps) | **Only** `westus2`, `centralus`, `eastus2`, `westeurope`, `eastasia` | `eastasia` |
| Static Web App name | Unique within the RG | `swa-spotify-web` |
| Container registry | **Globally unique**, 5–50 chars, lowercase alphanumeric only | `acrspotifyweb0425` |
| App Service plan | — | `asp-spotify-web-linux` |
| Web App name | **Globally unique** (becomes `<name>.azurewebsites.net`) | `app-spotify-web-0425` |
| Image name:tag | Avoid `latest` in production | `spotify-web:v1` |

Handy PowerShell to keep the values in one place for a session:

```powershell
$RG   = "rg-spotify-web-prod"
$LOC  = "southeastasia"
$SWA  = "swa-spotify-web"
$ACR  = "acrspotifyweb0425"
$PLAN = "asp-spotify-web-linux"
$APP  = "app-spotify-web-0425"
```

Create the resource group once:

```powershell
az group create --name $RG --location $LOC --output table
```

### 3.6 Know the limits and costs

Static Web Apps quotas that matter for this repo:

| Limit | Free | Standard |
| --- | --- | --- |
| Max app size (deployed content) | **250 MB** | 500 MB |
| Custom domains | 2 | 5 |
| Bandwidth included | 100 GB/month | 100 GB/month |
| SLA | none | 99.95% |

This repo ships `.mp3` and image files, so **measure the payload before you deploy**:

```powershell
$bytes = (Get-ChildItem -Recurse -File -Force |
          Where-Object FullName -notmatch '\\\.git\\' |
          Measure-Object Length -Sum).Sum
"{0:N2} MB" -f ($bytes / 1MB)
```

If the total approaches 250 MB, either move to the Standard plan, trim the audio files,
or use Option E (Blob Storage has no such limit).

Rough monthly cost of the other options (varies by region — always confirm with the
[Azure pricing calculator](https://azure.microsoft.com/pricing/calculator/)):
App Service Linux **B1** plan + **ACR Basic** for Option B; Container Apps consumption
(can scale to zero) for Option C; an AKS node pool for Option D — by far the most
expensive; a few cents of storage for Option E.

---

## 4. Pre-deployment fixes (do these first)

Windows file systems are case-insensitive; every Azure host below serves from Linux and
**is** case-sensitive. Fix this before you deploy or you will chase phantom 404s.

### 4.1 REQUIRED — file-name casing bug

[`premium.html`](./premium.html) line 40 requests `./assets/benefit_2.png`, but the file on
disk is **`assets/Benefit_2.png`** (capital `B`). On Azure this image returns **404**.

Because Git on Windows is case-insensitive, rename in two steps:

```powershell
git mv assets/Benefit_2.png assets/benefit_2.tmp.png
git mv assets/benefit_2.tmp.png assets/benefit_2.png
git status                # confirm Git recorded the rename
git commit -m "fix: correct Benefit_2.png filename casing for Linux hosts"
```

Then re-audit every reference (all four `why-card` images, the CSS `url(...)` background
images, and the `.otf` font) against the real file names:

```powershell
git ls-files assets | Sort-Object
```

### 4.2 Decide what happens to the GitHub Pages deployment

- [`.github/workflows/static.yml`](./.github/workflows/static.yml) publishes to GitHub Pages
  on every push to `main`.
- [`CNAME`](./CNAME) points `my-spotify-player.com` at GitHub Pages.

Choose one:

| Goal | Action |
| --- | --- |
| Azure only, keep the domain | Disable/delete the Pages workflow, remove the `CNAME` file, then repoint DNS to Azure in [step 10](#10-custom-domain-and-tls) |
| Run both, Azure on `*.azurestaticapps.net` | Change nothing — they are independent |
| Azure only, drop the domain | Delete the workflow and `CNAME`, and disable Pages in repo settings |

A domain can only resolve to one host at a time, so **do not** leave the Pages DNS records
in place while adding the same hostname to Azure.

### 4.3 Optional hygiene — keep non-site files out of the deployment

Static Web Apps publishes everything under the app location. These files are harmless but
needlessly public: `README.md`, `screenshot.png`, `Dockerfile`, `nginx.conf`,
`k8s-manifests.yaml`, `Material-Ocean/`, and this guide. To exclude them, either move the
site into a `public/` folder and set the app location to `/public`, or block them with
routing rules in `staticwebapp.config.json` (see [5.6](#56-add-staticwebappconfigjson)).
The container options already exclude some of these via [`.dockerignore`](./.dockerignore).

### 4.4 Verify the site locally, exactly as it will be served

Pick one:

```powershell
# Python
python -m http.server 8080

# Node
npx --yes serve -l 8080 .

# Docker — closest to Options B/C/D, uses the repo's nginx.conf
docker build -t spotify-web:local .
docker run --rm -p 8080:80 spotify-web:local
```

Open <http://localhost:8080> and check every item:

- [ ] `index.html` renders, header/footer Web Components hydrate
- [ ] `premium.html` shows **all four** benefit images (validates the 4.1 fix)
- [ ] Plan cards' **START USING** opens the subscribe modal
- [ ] Modal validation behaves: bad `MM/YY`, a past expiry, and a 2-digit CVV are all rejected
- [ ] `download.html`, `help.html` load with images
- [ ] `Spotify-songs/songs.html` plays audio and shows covers
- [ ] Browser DevTools **Console** and **Network** tabs show no 404s or errors

With Docker running, also confirm the health endpoint used by Kubernetes probes:

```powershell
curl.exe -i http://localhost:8080/healthz
```

### 4.5 Commit and push

```powershell
git add -A
git commit -m "chore: prepare site for Azure deployment"
git push origin main
```

Azure deploys **from GitHub**, so anything not pushed will not be published.

---

## 5. Option A — Azure Static Web Apps (recommended)

### 5.1 What Azure will do for you

When you create the resource and point it at GitHub, Azure:

1. commits a workflow file `.github/workflows/azure-static-web-apps-<random-name>.yml`
   to your repository,
2. adds a repository secret `AZURE_STATIC_WEB_APPS_API_TOKEN_<RANDOM_NAME>`,
3. runs that workflow, which uploads the repo contents to a global CDN,
4. issues a free TLS certificate and gives you `https://<random>.<region>.azurestaticapps.net`,
5. re-deploys automatically on every later push to the tracked branch, and builds a
   temporary **preview environment** for each pull request.

Use **either** 5.2 (portal), 5.3 (CLI) or 5.4 (VS Code) — not all three.

### 5.2 Path 1 — Azure Portal (click-by-click)

1. Sign in to the [Azure Portal](https://portal.azure.com/).
2. Select **Create a resource** (top-left **+**), search for **Static Web App**, open it and
   choose **Create**.
3. On the **Basics** tab fill in:
   - **Subscription** — the one you verified in [3.1](#31-azure-account-and-permissions).
   - **Resource Group** — pick `rg-spotify-web-prod` or choose **Create new**.
   - **Name** — `swa-spotify-web`.
   - **Plan type** — **Free** (switch to **Standard** only if you need the 500 MB app size,
     an SLA, or private endpoints).
   - **Azure Functions and staging details / Region** — choose the closest supported
     Static Web Apps region, e.g. **East Asia**.
   - **Deployment details → Source** — **GitHub**.
4. Select **Sign in with GitHub** and authorize *Azure Static Web Apps*. If your repo lives
   in an organization, an org owner may need to approve the OAuth app.
5. Choose:
   - **Organization** — `candare109`
   - **Repository** — `my-spotify-web`
   - **Branch** — `main`
6. Under **Build Details**:
   - **Build Presets** — **Custom**
   - **App location** — `/`
   - **Api location** — `api`
   - **Output location** — *leave empty*

   > These three values are written into the generated workflow. Getting **App location**
   > wrong is the single most common cause of an empty site.
7. *(Optional)* On **Advanced**, keep the defaults. On **Tags**, add e.g. `env=prod`,
   `project=spotify-web`.
8. Select **Review + create**, confirm the summary, then **Create**.
9. Wait for *Deployment succeeded*, then choose **Go to resource**.

### 5.3 Path 2 — Azure CLI

```powershell
az group create --name $RG --location $LOC --output table

az staticwebapp create `
  --name $SWA `
  --resource-group $RG `
  --source "https://github.com/candare109/my-spotify-web" `
  --branch main `
  --location "eastasia" `
  --app-location "/" `
  --api-location "api" `
  --output-location "" `
  --sku Free `
  --login-with-github
```

`--login-with-github` prints a device code; open the URL, paste the code, and approve the
requested repository access. The command then creates the resource **and** pushes the
workflow file to your repo.

Get the public URL:

```powershell
az staticwebapp show --name $SWA --resource-group $RG --query "defaultHostname" --output tsv
```

### 5.4 Path 3 — VS Code extension

1. Install the **Azure Static Web Apps** extension and sign in to Azure from the Azure panel.
2. Open the Command Palette (`Ctrl+Shift+P`) → **Azure Static Web Apps: Create Static Web App…**
3. Answer the prompts: subscription → name `swa-spotify-web` → region **East Asia** →
   framework preset **Custom** → app location `/` → output location *(empty)*.
4. The extension creates the resource and the workflow, then offers **View in browser**.

### 5.5 Sync the workflow Azure just created

Azure committed a file directly to `main`, so your local clone is now behind:

```powershell
git pull origin main
```

Open the new `.github/workflows/azure-static-web-apps-*.yml` and confirm the build block:

```yaml
      - name: Build And Deploy
        uses: Azure/static-web-apps-deploy@v1
        with:
          azure_static_web_apps_api_token: ${{ secrets.AZURE_STATIC_WEB_APPS_API_TOKEN_<RANDOM> }}
          repo_token: ${{ secrets.GITHUB_TOKEN }}
          action: "upload"
          app_location: "/"      # must be "/" for this repo
          api_location: "api"    # the Azure Functions backend
          output_location: ""    # no build output folder
```

If `app_location`, `api_location` or `output_location` is wrong, edit them here, commit,
and push — the workflow re-runs immediately.

### 5.6 `staticwebapp.config.json`

Static Web Apps ignores [`nginx.conf`](./nginx.conf); routing, headers, MIME types and the
404 page are configured with a JSON file at the **app root**. This repo already ships
[`staticwebapp.config.json`](./staticwebapp.config.json):

```json
{
  "navigationFallback": {
    "rewrite": "/index.html",
    "exclude": [
      "/api/*",
      "/assets/*",
      "/css/*",
      "/js/*",
      "/component/*",
      "/Spotify-songs/*",
      "/*.{png,jpg,jpeg,jfif,webp,gif,svg,ico,otf,woff,woff2,mp3,css,js}"
    ]
  },
  "mimeTypes": {
    ".jfif": "image/jpeg",
    ".webp": "image/webp",
    ".otf": "font/otf",
    ".mp3": "audio/mpeg",
    ".json": "application/json"
  },
  "globalHeaders": {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "SAMEORIGIN",
    "Referrer-Policy": "strict-origin-when-cross-origin"
  },
  "routes": [
    {
      "route": "/assets/*",
      "headers": { "Cache-Control": "public, max-age=604800, immutable" }
    },
    {
      "route": "/Spotify-songs/covers/*",
      "headers": { "Cache-Control": "public, max-age=604800, immutable" }
    },
    {
      "route": "/*.html",
      "headers": { "Cache-Control": "no-cache" }
    },
    { "route": "/README.md", "statusCode": 404 },
    { "route": "/Dockerfile", "statusCode": 404 },
    { "route": "/nginx.conf", "statusCode": 404 },
    { "route": "/k8s-manifests.yaml", "statusCode": 404 },
    { "route": "/Material-Ocean/*", "statusCode": 404 }
  ],
  "responseOverrides": {
    "404": { "rewrite": "/index.html", "statusCode": 404 }
  }
}
```

Why each block matters here:

- **navigationFallback.exclude** — without it, a missing image would return `index.html`
  instead of a 404, which hides mistakes like the casing bug in [4.1](#41-required--file-name-casing-bug).
- **mimeTypes** — `.jfif` (used by `assets/b1.jfif`, `b4`, `b5`, `b8`) and `.otf`
  (`CircularStd-Black.otf`) are not mapped by default; without this the font and those
  images can fail to load.
- **globalHeaders** — mirrors the security headers already set in [`nginx.conf`](./nginx.conf).
- **routes** — reproduces the aggressive asset caching / HTML revalidation policy.

Commit and push if you change it — every push triggers a redeploy:

```powershell
git add staticwebapp.config.json
git commit -m "feat: update Static Web Apps routing, MIME and header config"
git push origin main
```

*(Optional)* Test the config locally before pushing:

```powershell
swa start . --host 0.0.0.0 --port 4280
```

### 5.7 Watch the first deployment

1. GitHub → **Actions** → the *Azure Static Web Apps CI/CD* run.
2. Expand **Build And Deploy**. A healthy run ends with an uploaded artifact and a
   deployment URL.
3. In the portal, the Static Web App **Overview** blade shows the URL and
   **Environments** shows `Production`.

A run typically takes 1–3 minutes for a repo this size.

### 5.8 Verify the live site

```powershell
$URL = az staticwebapp show -n $SWA -g $RG --query defaultHostname -o tsv

curl.exe -I "https://$URL/"
curl.exe -I "https://$URL/premium.html"
curl.exe -I "https://$URL/assets/benefit_2.png"     # must be 200, not 404
curl.exe -I "https://$URL/Spotify-songs/songs.html"
curl.exe -I "https://$URL/css/main.css"
```

Then in a browser confirm the same list you used in [4.4](#44-verify-the-site-locally-exactly-as-it-will-be-served),
with DevTools open, and check that `Content-Type` on `assets/b1.jfif` is `image/jpeg`.

### 5.9 Pull-request preview environments

With the generated workflow in place, opening a PR against `main` builds a temporary
environment at `https://<name>-<pr#>.<region>.azurestaticapps.net`, and the workflow's
`close` job deletes it when the PR is merged or closed. List them with:

```powershell
az staticwebapp environment list --name $SWA --resource-group $RG --output table
```

### 5.10 Everyday redeploys and rollback

- **Redeploy:** push to `main`. That's it.
- **Manual re-run:** GitHub → Actions → select the last run → **Re-run all jobs**.
- **Rollback:** `git revert <bad-commit>` and push — the revert triggers a fresh deploy.
  (Static Web Apps has no "swap back to previous build" button on the Free tier, so Git is
  your rollback mechanism.)

### 5.11 Provision Cosmos DB for the subscriptions API

The API in [`api/`](./api) writes to Cosmos DB for NoSQL. Serverless billing means you pay
per request, and the account-level free tier covers a project this size.

```powershell
$COSMOS = "cosmos-spotify-web-0425"   # globally unique, lowercase

az cosmosdb create `
  --name $COSMOS --resource-group $RG `
  --locations regionName=$LOC failoverPriority=0 isZoneRedundant=False `
  --capabilities EnableServerless `
  --enable-free-tier true `
  --default-consistency-level Session
```

> `--enable-free-tier true` fails if the subscription already has a free-tier account —
> drop the flag in that case.

The API creates the database and container on first use, but creating them up front is
faster and lets you set the partition key explicitly:

```powershell
az cosmosdb sql database create -a $COSMOS -g $RG -n spotify-web

az cosmosdb sql container create -a $COSMOS -g $RG `
  -d spotify-web -n subscriptions --partition-key-path "/email"
```

### 5.12 Give the Functions API its connection settings

```powershell
$COSMOS_ENDPOINT = az cosmosdb show -n $COSMOS -g $RG --query documentEndpoint -o tsv
$COSMOS_KEY      = az cosmosdb keys list -n $COSMOS -g $RG --query primaryMasterKey -o tsv

az staticwebapp appsettings set --name $SWA --resource-group $RG --setting-names `
  "COSMOS_ENDPOINT=$COSMOS_ENDPOINT" `
  "COSMOS_KEY=$COSMOS_KEY" `
  "COSMOS_DATABASE=spotify-web" `
  "COSMOS_CONTAINER=subscriptions"

az staticwebapp appsettings list --name $SWA --resource-group $RG --output table
```

`COSMOS_CONNECTION_STRING` is supported as an alternative to the endpoint/key pair. These
values are secrets: they live in Static Web Apps application settings (or Key Vault), never
in the repository. [`.gitignore`](./.gitignore) already excludes `api/local.settings.json`
for the same reason.

### 5.13 Run and test the API locally

```powershell
cd api
npm install
npm test                      # unit tests for the validation rules (node:test)

Copy-Item local.settings.json.example local.settings.json
# edit local.settings.json and paste your Cosmos endpoint + key

npm install -g azure-functions-core-tools@4 --unsafe-perm true
func start                    # API on http://localhost:7071
```

To serve the site and the API together the way Azure does — one origin, `/api/*` routed to
the Functions host — use the Static Web Apps CLI from the repo root:

```powershell
swa start . --api-location ./api
# site + API on http://localhost:4280
```

Smoke-test the endpoint:

```powershell
# happy path -> 201
curl.exe -s -X POST http://localhost:4280/api/subscriptions `
  -H "Content-Type: application/json" `
  -d '{\"firstName\":\"Ada\",\"lastName\":\"Lovelace\",\"email\":\"ada@example.com\",\"plan\":\"Individual\"}'

# unknown plan -> 400 with details[]
curl.exe -s -X POST http://localhost:4280/api/subscriptions `
  -H "Content-Type: application/json" `
  -d '{\"firstName\":\"Ada\",\"lastName\":\"L\",\"email\":\"ada@example.com\",\"plan\":\"Platinum\"}'

# card data present -> 400, request refused outright
curl.exe -s -X POST http://localhost:4280/api/subscriptions `
  -H "Content-Type: application/json" `
  -d '{\"firstName\":\"Ada\",\"lastName\":\"L\",\"email\":\"ada@example.com\",\"plan\":\"Duo\",\"cvv\":\"123\"}'
```

### 5.14 What the API does and does not store

| Stored in Cosmos | Never accepted, never stored |
| --- | --- |
| `firstName`, `lastName`, `email` (lower-cased) | Card number |
| `plan` and the **server-derived** `price` | Expiry date |
| `id`, `createdAt`, `source`, `type` | CVV / CVC, cardholder name |

Design decisions worth knowing before you extend it:

- **Card fields never leave the browser.** [`subscribeModal.js`](./component/subscribeModal.js)
  validates them for UX only and omits them from the request body; the API rejects any
  request containing them with a 400. Before taking real payments, replace those inputs
  with a payment provider's hosted fields (Stripe, PayMongo, Xendit) and store only the
  returned token, `last4` and expiry. Storing PANs puts you in PCI-DSS scope, and a CVV
  must never be persisted.
- **The price is looked up server-side** from the plan allow-list in
  [`api/validation.js`](./api/validation.js), so a tampered request cannot buy Family for
  ₹1.
- **Re-submitting the same email + plan returns 200** with the original record instead of
  creating duplicates.
- **Personal data is never logged** — only the plan name and the generated id.
- Not yet implemented, and worth adding before real traffic: rate limiting/CAPTCHA,
  a confirmation email, an admin read endpoint (authenticated), and a data-retention policy.

### 5.15 Verify the API in production

```powershell
$URL = az staticwebapp show -n $SWA -g $RG --query defaultHostname -o tsv

curl.exe -i -X POST "https://$URL/api/subscriptions" `
  -H "Content-Type: application/json" `
  -d '{\"firstName\":\"Ada\",\"lastName\":\"Lovelace\",\"email\":\"ada@example.com\",\"plan\":\"Individual\"}'
```

Expect `201` and a JSON body with `id`, `plan`, `price` and `createdAt`. Then confirm the
document landed:

```powershell
az cosmosdb sql container query -a $COSMOS -g $RG -d spotify-web -n subscriptions `
  --query-text "SELECT c.id, c.plan, c.createdAt FROM c"
```

Finally, submit the form in the browser on `premium.html` and watch the Network tab: the
`POST /api/subscriptions` should return 201 and the success message should replace the form.

---

## 6. Option B — App Service for Containers

Use this when you want the repo's own [`nginx.conf`](./nginx.conf) (gzip, cache rules,
`/healthz`, security headers) to be the thing actually serving traffic.

### 6.1 Create a container registry and build the image

Azure Container Registry can build the image for you, so Docker Desktop is optional.

```powershell
az acr create --resource-group $RG --name $ACR --sku Basic --output table

# Build remotely from the repo root (uses ./Dockerfile and ./.dockerignore)
az acr build --registry $ACR --image spotify-web:v1 .
```

Local build alternative:

```powershell
az acr login --name $ACR
docker build -t "$ACR.azurecr.io/spotify-web:v1" .
docker push "$ACR.azurecr.io/spotify-web:v1"
```

Confirm the tag exists:

```powershell
az acr repository show-tags --name $ACR --repository spotify-web --output table
```

### 6.2 Create the plan and web app

```powershell
az appservice plan create `
  --resource-group $RG --name $PLAN --is-linux --sku B1 --output table

az webapp create `
  --resource-group $RG `
  --plan $PLAN `
  --name $APP `
  --container-image-name "$ACR.azurecr.io/spotify-web:v1" `
  --output table
```

> On older Azure CLI versions the parameter is `--deployment-container-image-name`.

### 6.3 Let the web app pull from ACR with a managed identity

Preferred (no passwords):

```powershell
$PRINCIPAL = az webapp identity assign -g $RG -n $APP --query principalId -o tsv
$ACR_ID    = az acr show -n $ACR --query id -o tsv

az role assignment create --assignee $PRINCIPAL --role AcrPull --scope $ACR_ID

az resource update `
  --ids "/subscriptions/$(az account show --query id -o tsv)/resourceGroups/$RG/providers/Microsoft.Web/sites/$APP/config/web" `
  --set properties.acrUseManagedIdentityCreds=true
```

Simpler fallback (registry admin user — fine for a demo, avoid in production):

```powershell
az acr update -n $ACR --admin-enabled true
$ACR_USER = az acr credential show -n $ACR --query username -o tsv
$ACR_PASS = az acr credential show -n $ACR --query "passwords[0].value" -o tsv

az webapp config container set `
  --resource-group $RG --name $APP `
  --container-image-name "$ACR.azurecr.io/spotify-web:v1" `
  --container-registry-url "https://$ACR.azurecr.io" `
  --container-registry-user $ACR_USER `
  --container-registry-password $ACR_PASS
```

### 6.4 App settings, logs and health

```powershell
# nginx listens on 80; make it explicit so App Service probes the right port
az webapp config appsettings set -g $RG -n $APP --settings WEBSITES_PORT=80

# Always-on HTTPS + modern TLS
az webapp update -g $RG -n $APP --https-only true
az webapp config set -g $RG -n $APP --min-tls-version 1.2

# Use the container's health endpoint from nginx.conf
az webapp config set -g $RG -n $APP --generic-configurations '{"healthCheckPath": "/healthz"}'

# Stream container logs while you test
az webapp log config -g $RG -n $APP --docker-container-logging filesystem
az webapp log tail   -g $RG -n $APP
```

### 6.5 Verify

```powershell
az webapp show -g $RG -n $APP --query defaultHostName -o tsv
curl.exe -I "https://$APP.azurewebsites.net/"
curl.exe    "https://$APP.azurewebsites.net/healthz"
```

The first request after a new image can take 30–60 seconds while the container is pulled.

### 6.6 Ship a new version

```powershell
az acr build --registry $ACR --image spotify-web:v2 .
az webapp config container set -g $RG -n $APP `
  --container-image-name "$ACR.azurecr.io/spotify-web:v2"
az webapp restart -g $RG -n $APP
```

For zero-downtime releases, add a staging slot (**Standard** plan or higher):

```powershell
az webapp deployment slot create -g $RG -n $APP --slot staging
# deploy the new tag to staging, verify, then:
az webapp deployment slot swap  -g $RG -n $APP --slot staging --target-slot production
```

Rollback = swap back, or re-point the container image to the previous tag.

---

## 7. Option C — Azure Container Apps

Same image as Option B, but serverless: it can scale to zero, so an idle demo costs
almost nothing.

```powershell
az extension add --name containerapp --upgrade
az provider register --namespace Microsoft.App
az provider register --namespace Microsoft.OperationalInsights

az containerapp env create `
  --name cae-spotify-web --resource-group $RG --location $LOC

az containerapp create `
  --name ca-spotify-web `
  --resource-group $RG `
  --environment cae-spotify-web `
  --image "$ACR.azurecr.io/spotify-web:v1" `
  --registry-server "$ACR.azurecr.io" `
  --registry-identity system `
  --target-port 80 `
  --ingress external `
  --min-replicas 0 `
  --max-replicas 3 `
  --cpu 0.25 --memory 0.5Gi `
  --query "properties.configuration.ingress.fqdn" --output tsv
```

Shortcut that builds *and* deploys straight from source:

```powershell
az containerapp up --name ca-spotify-web --resource-group $RG `
  --environment cae-spotify-web --source . --ingress external --target-port 80
```

Update to a new image and inspect:

```powershell
az containerapp update -n ca-spotify-web -g $RG --image "$ACR.azurecr.io/spotify-web:v2"
az containerapp logs show -n ca-spotify-web -g $RG --follow
az containerapp revision list -n ca-spotify-web -g $RG --output table
```

Rollback: activate the previous revision with
`az containerapp revision activate -n ca-spotify-web -g $RG --revision <name>`.

---

## 8. Option D — Azure Kubernetes Service (AKS)

The repo already contains [`k8s-manifests.yaml`](./k8s-manifests.yaml) (Namespace,
Deployment with 2 replicas, readiness/liveness probes on `/healthz`, ClusterIP Service and
an nginx Ingress).

```powershell
# 1. Cluster, attached to the registry so image pulls just work
az aks create -g $RG -n aks-spotify-web `
  --node-count 2 --node-vm-size Standard_B2s `
  --generate-ssh-keys --attach-acr $ACR

az aks get-credentials -g $RG -n aks-spotify-web

# 2. Image
az acr build --registry $ACR --image spotify-web:v1 .

# 3. Ingress controller (required by the manifest's ingressClassName: nginx)
helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx
helm repo update
helm install ingress-nginx ingress-nginx/ingress-nginx `
  --namespace ingress-nginx --create-namespace
```

Before applying, edit [`k8s-manifests.yaml`](./k8s-manifests.yaml):

- replace `<acrName>.azurecr.io/spotify-web:latest` with `$ACR.azurecr.io/spotify-web:v1`
  (pin a real tag — `latest` plus `imagePullPolicy: Always` makes rollbacks ambiguous),
- change the Ingress `host: spotify-web.example.com` to your own hostname, or delete the
  `host` line to match any host.

Then:

```powershell
kubectl apply -f k8s-manifests.yaml
kubectl -n spotify-web rollout status deployment/spotify-web
kubectl -n spotify-web get pods,svc,ingress
kubectl -n ingress-nginx get svc ingress-nginx-controller   # note EXTERNAL-IP for DNS
```

Update and roll back:

```powershell
kubectl -n spotify-web set image deployment/spotify-web spotify-web="$ACR.azurecr.io/spotify-web:v2"
kubectl -n spotify-web rollout undo deployment/spotify-web
```

For TLS, install cert-manager, create a `ClusterIssuer`, then uncomment the
`cert-manager.io/cluster-issuer` annotation and the `tls:` block in the manifest.

---

## 9. Option E — Storage static website + Front Door

The cheapest way to host these files.

```powershell
$ST = "stspotifyweb0425"   # 3-24 chars, lowercase letters and numbers only, globally unique

az storage account create -g $RG -n $ST --location $LOC `
  --sku Standard_LRS --kind StorageV2 --allow-blob-public-access true

az storage blob service-properties update --account-name $ST `
  --static-website --index-document index.html --404-document index.html

# Upload the site, skipping repo metadata
az storage blob upload-batch --account-name $ST -s . -d '$web' `
  --pattern "*" --overwrite

az storage account show -n $ST -g $RG --query "primaryEndpoints.web" --output tsv
```

Notes:

- Content types are inferred from extensions; if `.jfif` or `.otf` are served as
  `application/octet-stream`, fix them explicitly:

  ```powershell
  az storage blob update --account-name $ST -c '$web' -n assets/b1.jfif --content-type image/jpeg
  ```

- Static website endpoints do **not** support custom domains with HTTPS on their own —
  put **Azure Front Door** (or CDN) in front for a custom domain, TLS and caching.
- Re-deploy = re-run `upload-batch`; add `--overwrite` and consider
  `--destination-path` if you version releases.

---

## 10. Custom domain and TLS

The repo's [`CNAME`](./CNAME) currently delegates `my-spotify-player.com` to GitHub Pages.
Resolve that first (see [4.2](#42-decide-what-happens-to-the-github-pages-deployment)) —
the same hostname cannot point at Pages and Azure simultaneously.

### 10.1 Static Web Apps

Subdomain (`www`) — easiest:

1. Portal → your Static Web App → **Custom domains** → **+ Add** → **Custom domain on other DNS**.
2. Enter `www.my-spotify-player.com`.
3. At your DNS provider create:

   | Type | Name | Value |
   | --- | --- | --- |
   | `CNAME` | `www` | `<your-app>.<region>.azurestaticapps.net` |

4. Back in Azure select **Validate**, then **Add**. The managed certificate is issued
   automatically (allow a few minutes up to a couple of hours for DNS + issuance).

Apex/root (`my-spotify-player.com`) — needs TXT validation because a root record cannot be
a `CNAME`:

1. Add the domain in Azure and choose validation method **TXT**.
2. Create the records Azure shows you:

   | Type | Name | Value |
   | --- | --- | --- |
   | `TXT` | `@` (or `_dnsauth`) | the token Azure displays |
   | `ALIAS`/`ANAME`/`A` | `@` | as instructed by Azure (an ALIAS to the SWA hostname where supported) |

3. Select **Validate**, wait for **Ready**, then set the default domain if you want the
   apex to be canonical.

CLI equivalent:

```powershell
az staticwebapp hostname set -n $SWA -g $RG --hostname www.my-spotify-player.com
az staticwebapp hostname list -n $SWA -g $RG --output table
```

### 10.2 App Service (Option B)

```powershell
# 1. Prove ownership: add the asuid TXT + CNAME records shown by:
az webapp config hostname list -g $RG --webapp-name $APP --output table

# 2. Bind the hostname
az webapp config hostname add -g $RG --webapp-name $APP `
  --hostname www.my-spotify-player.com

# 3. Free managed certificate + binding
az webapp config ssl create -g $RG --name $APP --hostname www.my-spotify-player.com
az webapp config ssl bind   -g $RG --name $APP `
  --certificate-thumbprint <thumbprint> --ssl-type SNI

az webapp update -g $RG -n $APP --https-only true
```

### 10.3 Verify DNS and the certificate

```powershell
nslookup www.my-spotify-player.com
curl.exe -I https://www.my-spotify-player.com/
```

Expect `HTTP/2 200` and a valid certificate chain in the browser padlock.

---

## 11. After deployment: monitoring, security, cost

### 11.1 Confirm the security headers actually shipped

```powershell
curl.exe -I "https://$URL/" | Select-String -Pattern "x-content-type-options|x-frame-options|referrer-policy|cache-control"
```

For Static Web Apps these come from `globalHeaders` in `staticwebapp.config.json`; for the
container options they come from [`nginx.conf`](./nginx.conf).

### 11.2 Monitoring

- **Static Web Apps**: portal → **Application Insights** → enable, then use
  **Availability** to add a ping test against `/` and `/premium.html`.
- **App Service**: `az webapp log tail`, plus **Diagnose and solve problems** and
  **Health check** (already pointed at `/healthz` in [6.4](#64-app-settings-logs-and-health)).
- **Container Apps**: `az containerapp logs show --follow`, and the environment's
  Log Analytics workspace.
- **AKS**: `kubectl -n spotify-web logs deploy/spotify-web`, or enable Container Insights.

### 11.3 Cost control

```powershell
# See what the resource group contains and what SKUs are in play
az resource list -g $RG --output table

# Create a monthly budget alert (portal: Cost Management → Budgets is easier)
az consumption budget list --output table
```

Stop paying for idle Options B/C/D:

```powershell
az webapp stop -g $RG -n $APP                      # App Service
az containerapp update -n ca-spotify-web -g $RG --min-replicas 0
az aks stop -g $RG -n aks-spotify-web              # AKS node pool
```

Static Web Apps Free has nothing to stop — it's $0.

### 11.4 Routine release process

1. Make the change locally and test with the local server from [4.4](#44-verify-the-site-locally-exactly-as-it-will-be-served).
2. `git commit` → `git push origin main`.
3. GitHub Actions redeploys (Option A) or you rebuild/push the image (Options B–D).
4. Re-run the verification commands in [5.8](#58-verify-the-live-site).
5. Hard-refresh (`Ctrl+F5`) — assets are cached for 7 days by design.

---

## 12. CI/CD reference workflows

### 12.1 Static Web Apps

Azure generates this for you (see [5.5](#55-sync-the-workflow-azure-just-created)). Nothing
else to write.

### 12.2 Container build + deploy to App Service, using OIDC (no stored passwords)

One-time Azure setup:

```powershell
$SUB = az account show --query id -o tsv
$APPID = az ad app create --display-name "gh-spotify-web" --query appId -o tsv
az ad sp create --id $APPID

az role assignment create --assignee $APPID --role Contributor `
  --scope "/subscriptions/$SUB/resourceGroups/$RG"

az ad app federated-credential create --id $APPID --parameters '{
  "name": "gh-main",
  "issuer": "https://token.actions.githubusercontent.com",
  "subject": "repo:candare109/my-spotify-web:ref:refs/heads/main",
  "audiences": ["api://AzureADTokenExchange"]
}'
```

Add repository **variables/secrets**: `AZURE_CLIENT_ID` (`$APPID`), `AZURE_TENANT_ID`,
`AZURE_SUBSCRIPTION_ID`. Then `.github/workflows/azure-container.yml`:

```yaml
name: Build and deploy container to Azure

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  id-token: write
  contents: read

env:
  ACR_NAME: acrspotifyweb0425
  RESOURCE_GROUP: rg-spotify-web-prod
  WEBAPP_NAME: app-spotify-web-0425
  IMAGE: spotify-web

jobs:
  build-and-deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Azure login (OIDC)
        uses: azure/login@v2
        with:
          client-id: ${{ secrets.AZURE_CLIENT_ID }}
          tenant-id: ${{ secrets.AZURE_TENANT_ID }}
          subscription-id: ${{ secrets.AZURE_SUBSCRIPTION_ID }}

      - name: Build image in ACR
        run: az acr build --registry $ACR_NAME --image $IMAGE:${{ github.sha }} .

      - name: Point the web app at the new tag
        run: |
          az webapp config container set \
            --resource-group $RESOURCE_GROUP \
            --name $WEBAPP_NAME \
            --container-image-name $ACR_NAME.azurecr.io/$IMAGE:${{ github.sha }}
          az webapp restart --resource-group $RESOURCE_GROUP --name $WEBAPP_NAME

      - name: Smoke test
        run: curl -fsS -o /dev/null -w "%{http_code}\n" https://$WEBAPP_NAME.azurewebsites.net/
```

### 12.3 Turning off the GitHub Pages workflow

If Azure is now the only target, delete or disable
[`.github/workflows/static.yml`](./.github/workflows/static.yml) (GitHub → Actions →
select the workflow → **⋯** → **Disable workflow**) so two pipelines don't publish the
same commit.

---

## 13. Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| One image 404s, everything else works | Filename casing (`Benefit_2.png` vs `benefit_2.png`) — Linux is case-sensitive | Apply [4.1](#41-required--file-name-casing-bug) |
| Site loads but is completely unstyled | Wrong **App location**, or CSS path case mismatch | Set `app_location: "/"` in the workflow; check `git ls-files css` |
| Missing files return the homepage instead of 404 | `navigationFallback` has no `exclude` list | Add the config in [5.6](#56-add-staticwebappconfigjson) |
| `.jfif` images or the custom font don't render | MIME type not mapped | Add `mimeTypes` entries ([5.6](#56-add-staticwebappconfigjson)); for Storage set `--content-type` |
| Workflow fails: *deployment token was not provided* | Secret missing/renamed, or the run came from a fork | Portal → Static Web App → **Manage deployment token**, re-add the repo secret |
| Workflow fails: *app size exceeds the limit* | Free tier caps deployed content at 250 MB | Trim `Spotify-songs/songs/*.mp3`, switch to Standard, or use Option E |
| Deployment succeeded but you still see the old page | 7-day `immutable` asset cache / browser cache | `Ctrl+F5`, use a private window, or rename the changed asset |
| Azure never sees your commit | Pushed to a different branch than the one configured | Check the workflow's `on: push: branches:` and the SWA branch setting |
| App Service shows *Application Error* / container won't start | Image pull denied or wrong port | Check `az webapp log tail`; verify `AcrPull` role ([6.3](#63-let-the-web-app-pull-from-acr-with-a-managed-identity)) and `WEBSITES_PORT=80` |
| `az acr build` fails: *unauthorized* | Not logged in / no ACR permission | `az login`, then `az acr login --name $ACR` |
| AKS pods stuck `ImagePullBackOff` | Cluster not attached to ACR, or `<acrName>` placeholder left in the manifest | `az aks update -g $RG -n aks-spotify-web --attach-acr $ACR`; fix the image reference |
| AKS pods restart repeatedly | Probe path unreachable | Confirm `/healthz` exists in [`nginx.conf`](./nginx.conf) and `curl` it inside the pod |
| Custom domain stuck on *Validating* | DNS not propagated, or records on the wrong provider | `nslookup`, wait for TTL, confirm you edited the authoritative zone |
| Custom domain returns the old GitHub Pages site | Pages DNS records still present / `CNAME` file still committed | Remove Pages records and [`CNAME`](./CNAME), then re-validate in Azure |
| `az` command not recognised | CLI installed but the terminal predates it | Open a new terminal, or reinstall with `winget` |
| Form shows *"The subscription service is unavailable in this environment"* | `/api` returned 404 — API not deployed, or `api_location` empty | Set `api_location: "api"` in the workflow ([5.5](#55-sync-the-workflow-azure-just-created)) and redeploy |
| Form submit returns 500 | Cosmos settings missing or wrong | `az staticwebapp appsettings list`; re-apply [5.12](#512-give-the-functions-api-its-connection-settings) |
| API returns 400 *"Card details must never be sent to this endpoint"* | Something is posting card fields | Correct the caller — the API refuses card data by design ([5.14](#514-what-the-api-does-and-does-not-store)) |
| `func start` fails: *worker runtime not set* | `local.settings.json` missing | Copy `api/local.settings.json.example` and fill in the Cosmos values |
| API works locally but not in Azure | Settings only in `local.settings.json` (never deployed) | Add them as Static Web App application settings |

Useful diagnostic commands:

```powershell
az staticwebapp show -n $SWA -g $RG --output jsonc
az staticwebapp environment list -n $SWA -g $RG --output table
az webapp log tail -g $RG -n $APP
kubectl -n spotify-web describe pod -l app=spotify-web
curl.exe -I -H "Cache-Control: no-cache" "https://$URL/premium.html"
```

---

## 14. Rollback and teardown

Rollback:

- **Option A** — `git revert <commit>` and push; the workflow redeploys the previous content.
- **Option B** — re-point the container to the previous tag, or swap the staging slot back.
- **Option C** — `az containerapp revision activate` on the last good revision.
- **Option D** — `kubectl -n spotify-web rollout undo deployment/spotify-web`.

Delete individual resources:

```powershell
az staticwebapp delete -n $SWA -g $RG --yes
az webapp delete       -g $RG -n $APP
az appservice plan delete -g $RG -n $PLAN --yes
az containerapp delete -n ca-spotify-web -g $RG --yes
az aks delete -g $RG -n aks-spotify-web --yes
az acr delete -n $ACR -g $RG --yes
```

Delete everything at once (irreversible):

```powershell
az group delete --name $RG --yes --no-wait
```

Also clean up in GitHub: remove the generated
`.github/workflows/azure-static-web-apps-*.yml` and the
`AZURE_STATIC_WEB_APPS_API_TOKEN_*` secret.

---

## 15. Appendix: checklists

### 15.1 Before you deploy

- [ ] `assets/Benefit_2.png` renamed to `benefit_2.png` and committed
- [ ] All other asset references verified against `git ls-files`
- [ ] Decision made about GitHub Pages and the [`CNAME`](./CNAME) file
- [ ] Site verified locally (all 5 pages, modal validation, audio player)
- [ ] `npm test` passes in [`api/`](./api)
- [ ] Cosmos DB account provisioned ([5.11](#511-provision-cosmos-db-for-the-subscriptions-api))
- [ ] Deployed payload measured against the 250 MB Free-tier limit
- [ ] Azure CLI installed, `az login` done, subscription selected
- [ ] Required resource providers registered
- [ ] Names and region chosen ([3.5](#35-decide-names-and-region-up-front))
- [ ] Everything committed and pushed to `main`

### 15.2 During deployment

- [ ] Resource group created
- [ ] Static Web App created with **App location `/`**, **API location `api`**, empty output location
- [ ] Cosmos application settings applied to the Static Web App
- [ ] GitHub authorized; workflow file committed by Azure
- [ ] `git pull` run to sync the generated workflow
- [ ] `staticwebapp.config.json` added, committed and pushed
- [ ] Workflow run finished green

### 15.3 After deployment

- [ ] `https://<app>.azurestaticapps.net` returns 200
- [ ] `premium.html` shows all four benefit images
- [ ] `Spotify-songs/songs.html` plays audio
- [ ] `POST /api/subscriptions` returns 201 and the document appears in Cosmos DB
- [ ] Submitting the form in the browser shows the success message
- [ ] No console or network errors in DevTools
- [ ] Security headers present in the response
- [ ] Custom domain added and TLS valid (if applicable)
- [ ] Monitoring/availability test enabled
- [ ] Budget or cost alert configured (Options B–D)
- [ ] Rollback procedure understood and documented for the team

