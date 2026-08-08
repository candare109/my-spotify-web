# Azure Deployment Guide

This project is a static HTML/CSS/JavaScript site, so the simplest Azure deployment path is **Azure Static Web Apps**.

The repo already contains a GitHub Pages workflow in [`.github/workflows/static.yml`](C:/Users/andrew.j.candare/Documents/my-spotify-web/.github/workflows/static.yml), but that is for GitHub Pages, not Azure. Use the steps below to deploy to Azure instead.

## Recommended deployment method

**Azure Static Web Apps**

Why this is the best fit:

- no server code is required
- HTTPS is included by default
- GitHub-based CI/CD is easy to set up
- perfect for static sites like this repo

---

## Prerequisites

Before you begin, make sure you have:

1. **An Azure account**
   - Active subscription
   - Permission to create resources

2. **A GitHub account**
   - Access to this repository
   - Permission to add GitHub Actions workflows

3. **Git installed locally**
   - Needed if you want to clone, edit, and push changes

4. **A modern browser**
   - To use the Azure portal and verify the site

5. **Optional but helpful**
   - **Azure CLI** if you prefer command-line management
   - **VS Code** for editing the project

---

## Project readiness checklist

Confirm these before deploying:

- [x] The site runs correctly locally
- [x] All pages load without broken assets
- [x] `index.html` is the main entry point
- [x] Static assets are stored in the repo
- [x] No backend/API is required

If you want to keep the current GitHub Pages deployment, it can stay enabled, but Azure deployment will be separate.

---

## Step-by-step Azure Static Web Apps deployment

### Step 1: Push your latest changes to GitHub

Make sure your latest code is committed and pushed to the branch you want Azure to deploy from, usually `main`.

### Step 2: Open Azure Portal

Go to the [Azure Portal](https://portal.azure.com/).

### Step 3: Create a Static Web App resource

1. Click **Create a resource**
2. Search for **Static Web App**
3. Select **Static Web App** and click **Create**

### Step 4: Fill in the basics

Set the following:

- **Subscription**: choose your Azure subscription
- **Resource Group**: create a new one or select an existing one
- **Name**: choose a unique name for the app
- **Plan type**: usually **Free** is enough for a personal project
- **Region**: select the closest region to your users

### Step 5: Connect your GitHub repository

In the deployment section:

1. Sign in to GitHub if prompted
2. Choose the repository that contains this project
3. Choose the branch to deploy from, usually `main`

### Step 6: Configure build settings

Because this is a plain static site, use these settings:

- **App location**: `/`
- **Api location**: leave blank
- **Output location**: leave blank

If Azure asks for a build preset, choose **Custom** or **HTML** if available.

### Step 7: Create the resource

Click **Review + create**, then **Create**.

Azure will generate a GitHub Actions workflow in your repo and start the first deployment.

### Step 8: Wait for the first deployment

Go to GitHub → **Actions** and watch the workflow run.

If it succeeds, Azure will publish a live site URL.

### Step 9: Verify the live site

Open the Azure Static Web App URL and check:

- homepage loads
- navigation works
- images and CSS load correctly
- modal and form behavior still work
- song and premium pages open correctly

### Step 10: Fix any broken paths if needed

If assets are missing in Azure but worked locally, check:

- file name casing
- relative paths
- files stored outside the deployed folder
- references to local-only paths

### Step 11: Set up a custom domain (optional)

If you want your own domain:

1. Open the Static Web App in Azure
2. Go to **Custom domains**
3. Add your domain
4. Follow the DNS instructions Azure provides

HTTPS is handled automatically.

---

## What to do after deployment

Whenever you update the code:

1. make your changes locally
2. commit and push to the connected branch
3. let GitHub Actions rebuild and redeploy
4. verify the new version in Azure

---

## If you prefer Azure App Service instead

This repo also includes a [`Dockerfile`](C:/Users/andrew.j.candare/Documents/my-spotify-web/Dockerfile) and [`nginx.conf`](C:/Users/andrew.j.candare/Documents/my-spotify-web/nginx.conf), so you can deploy it as a containerized static site on **Azure App Service**.

Use this option if:

- you want container-based hosting
- you want full control over nginx
- you already use Docker in your workflow

High-level container steps:

1. Build the Docker image locally
2. Push the image to a container registry
3. Create an Azure App Service for Containers
4. Point App Service to the image
5. Verify the site loads through nginx

For this project, Static Web Apps is still the recommended choice.

---

## Troubleshooting

### The site shows 404 errors

- Confirm `index.html` is in the deployed root
- Check the Azure app location setting
- Make sure asset paths are relative and correct

### CSS or images do not load

- Check for incorrect file names
- Watch for uppercase/lowercase path mismatches
- Verify those files were committed to GitHub

### GitHub Actions fails

- Open the workflow logs in GitHub Actions
- Confirm Azure generated the workflow correctly
- Ensure the repository permissions are allowed

### Changes do not appear on the live site

- Confirm the workflow ran on the correct branch
- Hard refresh the browser
- Check whether another deployment is still in progress

---

## Final deployment checklist

- [ ] Code committed to GitHub
- [ ] Azure Static Web App created
- [ ] GitHub repository connected
- [ ] Build settings set correctly
- [ ] First deployment succeeded
- [ ] Live URL verified
- [ ] Optional custom domain configured

