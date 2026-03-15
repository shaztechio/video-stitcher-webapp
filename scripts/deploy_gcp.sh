#!/bin/bash
set -e

echo "=================================================="
echo "   Video Stitcher - Google Cloud Run Deployer"
echo "=================================================="

# Load config from gcp_config.json at repo root
CONFIG_FILE="$(dirname "$0")/../gcp_config.json"

if [ ! -f "$CONFIG_FILE" ]; then
  echo "Error: gcp_config.json not found."
  exit 1
fi

PROJECT_ID=$(python3 -c "import json; print(json.load(open('$CONFIG_FILE'))['projectId'])")
REGION=$(python3 -c "import json; print(json.load(open('$CONFIG_FILE'))['region'])")
SERVER_SERVICE=$(python3 -c "import json; print(json.load(open('$CONFIG_FILE'))['server-serviceName'])")
CLIENT_SERVICE=$(python3 -c "import json; print(json.load(open('$CONFIG_FILE'))['client-serviceName'])")
GOOGLE_CLIENT_ID=$(python3 -c "import json; print(json.load(open('$CONFIG_FILE'))['clientId'])")
ALLOWED_USERS=$(python3 -c "import json; print(json.load(open('$CONFIG_FILE'))['allowedUsers'])")

echo "Project:       $PROJECT_ID"
echo "Region:        $REGION"
echo "Server:        $SERVER_SERVICE"
echo "Client:        $CLIENT_SERVICE"
echo "Client ID:     $GOOGLE_CLIENT_ID"
echo "Allowed Users: $ALLOWED_USERS"

MISSING=0
[ -z "$PROJECT_ID" ]      && echo "Error: projectId is missing in gcp_config.json."      && MISSING=1
[ -z "$REGION" ]          && echo "Error: region is missing in gcp_config.json."          && MISSING=1
[ -z "$SERVER_SERVICE" ]  && echo "Error: server-serviceName is missing in gcp_config.json." && MISSING=1
[ -z "$CLIENT_SERVICE" ]  && echo "Error: client-serviceName is missing in gcp_config.json." && MISSING=1
[ -z "$GOOGLE_CLIENT_ID" ] && echo "Error: clientId is missing in gcp_config.json."      && MISSING=1
[ -z "$ALLOWED_USERS" ]   && echo "Error: allowedUsers is missing in gcp_config.json."   && MISSING=1
[ $MISSING -eq 1 ] && exit 1

echo "Setting project to $PROJECT_ID..."
gcloud config set project $PROJECT_ID

echo "Enabling required APIs (run, cloudbuild, artifactregistry)..."
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com

# 2. Deploy Server
echo ""
echo "--------------------------------------------------"
echo "🚀 Deploying Server Service..."
echo "--------------------------------------------------"

gcloud run deploy $SERVER_SERVICE \
  --source ./server \
  --region $REGION \
  --allow-unauthenticated \
  --memory 2Gi \
  --timeout 900 \
  --session-affinity \
  --set-env-vars "OUTPUT_RETENTION_MINUTES=10,ALLOWED_USERS=$ALLOWED_USERS"

# Capture Server URL
SERVER_URL=$(gcloud run services describe $SERVER_SERVICE --region $REGION --format 'value(status.url)')
echo "✅ Server deployed at: $SERVER_URL"

# 3. Deploy Client
echo ""
echo "--------------------------------------------------"
echo "🚀 Deploying Client Service..."
echo "--------------------------------------------------"

echo "Building with VITE_API_URL=$SERVER_URL"

# Build image first to pass build-arg
IMAGE_NAME="gcr.io/$PROJECT_ID/$CLIENT_SERVICE"
echo "Building Client image: $IMAGE_NAME"

# Create a temporary cloudbuild.yaml
cat > client/cloudbuild.yaml <<EOF
steps:
- name: 'gcr.io/cloud-builders/docker'
  args: [ 'build', '-t', '\$_IMAGE_NAME', '--build-arg', 'VITE_API_URL=\$_VITE_API_URL', '--build-arg', 'VITE_GOOGLE_CLIENT_ID=\$_VITE_GOOGLE_CLIENT_ID', '.' ]
images:
- '\$_IMAGE_NAME'
EOF

gcloud builds submit ./client \
  --config client/cloudbuild.yaml \
  --substitutions=_IMAGE_NAME=$IMAGE_NAME,_VITE_API_URL=$SERVER_URL,_VITE_GOOGLE_CLIENT_ID=$GOOGLE_CLIENT_ID

rm client/cloudbuild.yaml

echo "Deploying Client container..."
gcloud run deploy $CLIENT_SERVICE \
  --image $IMAGE_NAME \
  --region $REGION \
  --allow-unauthenticated \
  --port 80

CLIENT_URL=$(gcloud run services describe $CLIENT_SERVICE --region $REGION --format 'value(status.url)')

echo ""
echo "=================================================="
echo "🎉 Deployment Complete!"
echo "=================================================="
echo "Web Client: $CLIENT_URL"
echo "API Server: $SERVER_URL"
echo ""
echo "IMPORTANT: Ensure you have added $CLIENT_URL to 'Authorized JavaScript origins' in your Google Cloud Console."
echo "=================================================="
