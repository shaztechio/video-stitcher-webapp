# video-stitcher — Web App

[![CI](https://github.com/shaztechio/video-stitcher-webapp/actions/workflows/ci.yml/badge.svg)](https://github.com/shaztechio/video-stitcher-webapp/actions/workflows/ci.yml)

A web application to stitch videos and images into a single MP4 using FFmpeg.

For the CLI tool, see [video-stitcher](https://github.com/shaztechio/video-stitcher).

## Prerequisites

- Node.js 20+
- FFmpeg installed and added to your system PATH

## Getting Started

### Run both together (recommended)

```sh
npm install       # install concurrently (one-time)
npm run dev       # starts server on :3000 and client on :5173 concurrently
```

Authentication is disabled automatically (`DISABLE_AUTH=true`) so no Google login is required locally.

### Server only (port 3000)

```sh
cd server
npm install
DISABLE_AUTH=true node index.js
```

### Client only (port 5173)

```sh
cd client
npm install
npm run dev
```

Open your browser at `http://localhost:5173`.

### Using Docker

1. Ensure Docker and Docker Compose are installed.
2. Build and start the containers:

   ```sh
   docker-compose up --build
   ```

3. Access the application:
   - Client: `http://localhost:8080`
   - Server: `http://localhost:3000`

### Configuration

You can configure the file retention period for the server output files using the `OUTPUT_RETENTION_MINUTES` environment variable.

- **OUTPUT_RETENTION_MINUTES**: Time in minutes to keep files. Default is `5` (5 minutes). Minimum value is `5`; if set lower it defaults to 5. The cleanup check interval is automatically set to 1/24th of this value (minimum 1 minute).

## Deploy to Google Cloud Run

Both deployment methods (shell script and GitHub Actions) share the same one-time GCP setup and post-deployment step.

### One-time GCP Setup

#### 1. Create a GCP project with billing enabled

If you don't have one, create a project in [Google Cloud Console](https://console.cloud.google.com/) and enable billing.

#### 2. Create a Service Account

1. In Google Cloud Console, select your project
2. Go to **IAM & Admin → Service Accounts**
3. Click **+ Create Service Account**
   - Name: `deploy-account` (or similar)
   - Description: `Deployment account`
4. Click **Create and Continue**

#### 3. Grant Required Roles

Add all of the following roles (click **+ Add Another Role** after each):

| Role | Purpose |
|------|---------|
| Cloud Run Admin (`roles/run.admin`) | Deploy Cloud Run services |
| Cloud Build Editor (`roles/cloudbuild.builds.editor`) | Submit Cloud Build jobs |
| Artifact Registry Administrator (`roles/artifactregistry.admin`) | Push/pull container images |
| Service Account User (`roles/iam.serviceAccountUser`) | Act as the Cloud Run service account |
| Service Usage Admin (`roles/serviceusage.serviceUsageAdmin`) | Enable APIs |
| Storage Admin (`roles/storage.admin`) | Cloud Build uses GCS for build artifacts |

Click **Done**.

#### 4. Configure `gcp_config.json`

Copy the example file and fill in your values:

```sh
cp example.gcp_config.json gcp_config.json
```

`gcp_config.json` is gitignored and will not be committed. See `example.gcp_config.json` for the required fields.

> **Note:** `allowedUsers` must be semicolon-separated. Commas are not supported here because the value is passed directly inside the `--set-env-vars` flag, which uses commas as its delimiter.

### Option A: Deploy via Shell Script

**Additional prerequisites:**
- [Google Cloud SDK](https://cloud.google.com/sdk/docs/install) installed and initialized
- Logged in: `gcloud auth login && gcloud auth application-default login`
- Your account granted the Service Account User role on the service account (see step 3 above)

**Run the script:**

```sh
./scripts/deploy_gcp.sh
```

This reads `gcp_config.json`, enables the required GCP APIs, deploys the Server, then builds and deploys the Client pointed at the Server URL. Deployed URLs are printed when complete.

> **Note:** Cloud Run uses ephemeral storage. The script enables Session Affinity to mitigate this, but active jobs may be lost if the instance restarts or scales.

### Option B: Deploy via GitHub Actions

A manual-dispatch workflow (`.github/workflows/deploy.yml`) handles deployment without a local `gcloud` install. All config is stored as GitHub Secrets and Variables.

**Additional prerequisites:**
- [GitHub CLI](https://cli.github.com) (`gh`) installed and authenticated (`gh auth login`)
- A JSON key downloaded for the Service Account (see below)

**Download a JSON key for the Service Account:**

1. In Google Cloud Console, go to **IAM & Admin → Service Accounts** and click the account you created
2. Go to the **Keys** tab
3. Click **Add Key → Create new key**, select **JSON**, click **Create**
4. The key file downloads automatically — keep it safe

**Upload the key and config to GitHub:**

```sh
npm run set-secret path/to/downloaded-key.json   # sets GCP_SA_KEY secret
npm run set-vars                                  # sets all variables from gcp_config.json
```

This populates the following in **Settings → Secrets and variables → Actions**:

| Type | Name | Value |
|------|------|-------|
| Secret | `GCP_SA_KEY` | Full JSON content of the GCP Service Account key |
| Variable | `GCP_PROJECT_ID` | GCP project ID |
| Variable | `GCP_REGION` | Region e.g. `us-west1` |
| Variable | `GCP_SERVER_SERVICE` | Cloud Run service name |
| Variable | `GCP_CLIENT_SERVICE` | Cloud Run service name |
| Variable | `ALLOWED_USERS` | Semicolon-separated email allowlist |
| Variable | `GOOGLE_CLIENT_ID` | Google OAuth client ID |

**Trigger a deployment:**

Go to **Actions → Deploy to Google Cloud Run → Run workflow** and click **Run workflow**. Deployed URLs appear in the job summary when complete.

### Post-Deployment: Authorize the Client Origin

After the first deployment, add the client URL to your Google OAuth client so sign-in works:

1. Go to [Google Cloud Console](https://console.cloud.google.com/) → **APIs & Services → Credentials**
2. Click the OAuth 2.0 Client ID matching your `clientId` in `gcp_config.json`
3. Under **Authorized JavaScript origins**, click **Add URI**
4. Paste the client URL from the deployment output (e.g. `https://video-stitch-client-xxxxx-uw.a.run.app`)
5. Click **Save** — changes take effect within a few minutes

> This step is required once after the first deployment, and again only if the Cloud Run URL ever changes.

### Map a Custom Domain (Limited Availability / Preview)

Cloud Run supports [domain mapping](https://cloud.google.com/run/docs/mapping-custom-domains) to serve your client from a custom domain with an automatically provisioned and renewed HTTPS certificate.

> **Note:** Domain mapping is in **Preview** and only available in select regions: `asia-east1`, `asia-northeast1`, `asia-southeast1`, `europe-north1`, `europe-west1`, `europe-west4`, `us-central1`, `us-east1`, `us-east4`, `us-west1`. For other regions, use a load balancer or Firebase Hosting instead.

#### Prerequisites

- A domain you own (from any registrar, or purchased via Google)
- Domain ownership verified with Google Search Console

Check verification status:

```sh
gcloud domains list-user-verified
```

If your domain is not listed, verify it:

```sh
gcloud domains verify YOUR-DOMAIN
```

#### 1. Create the domain mapping

```sh
gcloud beta run domain-mappings create \
  --service video-stitch-client \
  --domain YOUR-DOMAIN \
  --region YOUR-REGION
```

To reassign a domain already mapped to another service, add `--force-override`.

#### 2. Configure DNS records

Retrieve the DNS records to add at your registrar:

```sh
gcloud beta run domain-mappings describe \
  --domain YOUR-DOMAIN \
  --region YOUR-REGION
```

Look for the `resourceRecords` section and add the returned `A`, `AAAA`, or `CNAME` records at your registrar:

| Name | Type | Value |
|------|------|-------|
| `@` (root) or `www` | A / AAAA / CNAME | (from output above) |

DNS propagation typically takes a few minutes to a few hours.

#### 3. Wait for certificate provisioning

Google automatically issues and renews an HTTPS certificate for your domain. This can take **15 minutes to 24 hours** after DNS propagates.

#### 4. Update your OAuth authorized origins

Once the custom domain is live, add it to your Google OAuth client (same as [Post-Deployment](#post-deployment-authorize-the-client-origin)):

1. Go to **APIs & Services → Credentials** and click your OAuth 2.0 Client ID
2. Under **Authorized JavaScript origins**, add your custom domain (e.g. `https://example.com`)
3. Click **Save**

#### Remove a domain mapping

```sh
gcloud beta run domain-mappings delete \
  --domain YOUR-DOMAIN \
  --region YOUR-REGION
```

## Usage

See [USAGE.md](./USAGE.md) on how to use the web app.
