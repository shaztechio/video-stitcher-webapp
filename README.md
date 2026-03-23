# video-stitcher — Web App

[![CI](https://github.com/shaztechio/video-stitcher-webapp/actions/workflows/ci.yml/badge.svg)](https://github.com/shaztechio/video-stitcher-webapp/actions/workflows/ci.yml)

A web application to stitch videos and images into a single MP4 using FFmpeg.

For the CLI tool, see [video-stitcher](https://github.com/shaztechio/video-stitcher).

## Prerequisites

- Node.js 20+
- FFmpeg installed and added to your system PATH (see [INSTALLING_FFMPEG.md](./INSTALLING_FFMPEG.md))

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

See [INFRA.md](./INFRA.md) for full deployment instructions, including GCP setup, shell script and GitHub Actions options, post-deployment steps, and custom domain mapping.

## Usage

See [USAGE.md](./USAGE.md) on how to use the web app.
