# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A full-stack web application that stitches videos and images into a single MP4 using FFmpeg. It consists of a Node.js/Express backend and a React/Vite frontend, with Google OAuth for authentication.

## Development Commands

### Run both together (recommended)
```sh
npm install          # install concurrently (one-time)
npm run dev          # starts server on :3000 and client on :5173 concurrently
```
The server runs with `DISABLE_AUTH=true` so no Google login is required locally.

### Server only (port 3000)
```sh
cd server
npm install
DISABLE_AUTH=true node index.js
# With pretty logs:
DISABLE_AUTH=true node index.js | npx pino-pretty
```

### Client only (port 5173)
```sh
cd client
npm install
npm run dev       # Development server
npm run build     # Production build
npm run lint      # ESLint
npm run preview   # Preview production build
```

### Testing
```sh
npm test                       # run server + client tests concurrently (from root)

cd server && npm test          # server tests only (Vitest)
cd server && npm run test:coverage  # server tests with v8 coverage report
cd server && npm run lint      # ESLint (eslint-config-standard)

cd client && npm test          # client tests only (Vitest + jsdom)
cd client && npm run test:coverage  # client tests with v8 coverage report
cd client && npm run lint      # ESLint
```
Both server and client enforce **100% code coverage** (statements, branches, functions, lines).

### Docker (local, auth disabled)
```sh
docker-compose -f docker-compose.yml up --build
# Client: http://localhost:8080  Server: http://localhost:3000
```

### Deploy to Google Cloud Run
```sh
./scripts/deploy_gcp.sh
```
Requires a `gcp_config.json` in this folder:
```json
{
  "projectId": "your-gcp-project-id",
  "region": "us-west1",
  "server-serviceName": "video-stitch-server",
  "client-serviceName": "video-stitch-client",
  "clientId": "your-google-oauth-client-id",
  "allowedUsers": "user1@example.com;user2@example.com"
}
```
Note: `allowedUsers` must be semicolon-separated (commas would break the `--set-env-vars` flag in the deploy script).

## Environment Variables

**Server:**
- `OUTPUT_RETENTION_MINUTES` — How long to keep stitched files (default: 5, minimum: 5)
- `DISABLE_AUTH=true` — Bypass Google auth (used in docker-compose for local dev)
- `ALLOWED_USERS` — Semicolon or comma separated allowlist of emails (use semicolons in `gcp_config.json` since the deploy script passes this inside `--set-env-vars` which uses commas as a delimiter)

**Client (Vite build args):**
- `VITE_API_URL` — Backend URL (default: `http://localhost:3000`)
- `VITE_GOOGLE_CLIENT_ID` — Google OAuth client ID
- `VITE_DISABLE_AUTH=true` — Bypass auth on the client side

## Architecture

### Request Flow
1. Client uploads files via `POST /api/stitch` (multipart, Google ID token in `Authorization: Bearer`)
2. Server middleware (`middleware/googleAuth.js`) verifies the Google ID token and checks the email allowlist
3. `routes/upload.js` saves files via multer to `server/uploads/`, creates a job, and starts async FFmpeg processing
4. `services/ffmpegService.js` probes all files, builds an FFmpeg `complexFilter` pipeline (scale → pad → setsar → concat), and saves output to `server/output/`
5. Client polls `GET /api/status/:jobId` every second until `status === 'completed'`
6. Completed file is served at `GET /download/<filename>` (static files from `server/output/`)
7. A periodic cleanup task deletes output files older than `OUTPUT_RETENTION_MINUTES`

### FFmpeg Pipeline (ffmpegService.js)
For each input (video or image):
- **Images**: use `-loop 1 -t <duration>` input options; silence generated via `anullsrc` + `atrim`
- **Videos without audio**: silence injected same way
- **Videos with audio**: audio resampled to 44100Hz
- All streams normalized to same resolution (default 1920×1080, or 1080×1920 if first video is portrait) using `scale` + `pad` (letterbox/pillarbox with black bars) + `setsar=1`
- Final `concat` filter joins all video+audio stream pairs
- **Background audio** (optional): looped with `-stream_loop -1`, volume-scaled via `volume` filter, mixed into the concat output with `amix` (`duration: first` so it trims to video length)

### Job State
Jobs are stored in-memory (`const jobs = {}` in `routes/upload.js`). There is no persistence — jobs are lost on server restart. This is intentional for simplicity and noted as a known limitation for Cloud Run deployments.

### Module Format
The server uses **ESM** (`import`/`export`, `"type": "module"` in `server/package.json`). `__filename`/`__dirname` are polyfilled via `import.meta.url` where needed. The client is also ESM (standard for Vite/React projects).

### Authentication
- Production: Google Identity Services (`window.google.accounts.id`) renders a sign-in button; the ID token is stored in `localStorage` and sent as `Authorization: Bearer <token>` on all API calls
- Local/Docker: `DISABLE_AUTH=true` on both client and server bypasses auth entirely
- The audience claim check in `googleAuth.js` is intentionally commented out for flexibility across deployment URLs
