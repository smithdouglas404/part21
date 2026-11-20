#!/usr/bin/env bash
# Provisions the Part 21 Assurance OS on Google Cloud.
#
# Designed to run in Cloud Shell from the repository root:
#   PROJECT_ID=my-project bash deploy/gcp/bootstrap.sh
#
# It is idempotent: re-running it updates the Cloud Run services and leaves
# existing data, buckets and secrets intact.
#
# It does NOT create a Temporal server. A stateful Temporal deployment must not run
# inside a Cloud Run container. Point TEMPORAL_ADDRESS at Temporal Cloud (or a GKE
# deployment) and re-run with DEPLOY_WORKER=true to bind the clock worker.
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-$(gcloud config get-value project 2>/dev/null || true)}"
REGION="${REGION:-us-central1}"
REPO="${REPO:-part21}"
IMAGE_NAME="${IMAGE_NAME:-part21}"
APP_SERVICE="${APP_SERVICE:-part21-app}"
WORKER_SERVICE="${WORKER_SERVICE:-part21-worker}"
SQL_INSTANCE="${SQL_INSTANCE:-part21-mysql}"
SQL_TIER="${SQL_TIER:-db-custom-1-3840}"
DB_NAME="${DB_NAME:-part21}"
DB_USER="${DB_USER:-part21}"
BUCKET="${BUCKET:-${PROJECT_ID}-part21-evidence}"
RUNTIME_SA="${RUNTIME_SA:-part21-runtime}"
DATABASE_URL="${DATABASE_URL:-}"
PROVISION_SQL="${PROVISION_SQL:-auto}"
DEPLOY_WORKER="${DEPLOY_WORKER:-false}"
RUN_MIGRATIONS="${RUN_MIGRATIONS:-true}"
INGEST_ECFR="${INGEST_ECFR:-true}"
TEMPORAL_ADDRESS="${TEMPORAL_ADDRESS:-}"
TEMPORAL_NAMESPACE="${TEMPORAL_NAMESPACE:-default}"
TEMPORAL_TASK_QUEUE="${TEMPORAL_TASK_QUEUE:-part21-clocks}"
TEMPORAL_TLS="${TEMPORAL_TLS:-true}"

log() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
die() { printf '\nERROR: %s\n' "$*" >&2; exit 1; }

[ -n "${PROJECT_ID}" ] || die "Set PROJECT_ID (or run: gcloud config set project YOUR_PROJECT)."
command -v gcloud >/dev/null || die "gcloud is not installed. Run this in Cloud Shell."
[ -f "deploy/gcp/Dockerfile" ] || die "Run this from the repository root."

if [ "${PROVISION_SQL}" = "auto" ]; then
  if [ -n "${DATABASE_URL}" ]; then PROVISION_SQL="false"; else PROVISION_SQL="true"; fi
fi

gcloud config set project "${PROJECT_ID}" --quiet
IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO}/${IMAGE_NAME}:latest"
SA_EMAIL="${RUNTIME_SA}@${PROJECT_ID}.iam.gserviceaccount.com"

log "Enabling APIs (this takes a minute)"
gcloud services enable \
  run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com \
  secretmanager.googleapis.com storage.googleapis.com sqladmin.googleapis.com \
  iam.googleapis.com logging.googleapis.com --quiet

log "Artifact Registry repository"
gcloud artifacts repositories describe "${REPO}" --location="${REGION}" >/dev/null 2>&1 \
  || gcloud artifacts repositories create "${REPO}" --repository-format=docker \
       --location="${REGION}" --description="Part 21 Assurance OS images" --quiet

log "Runtime service account"
gcloud iam service-accounts describe "${SA_EMAIL}" >/dev/null 2>&1 \
  || gcloud iam service-accounts create "${RUNTIME_SA}" --display-name="Part 21 runtime" --quiet

for role in roles/secretmanager.secretAccessor roles/storage.objectAdmin roles/logging.logWriter; do
  gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
    --member="serviceAccount:${SA_EMAIL}" --role="${role}" --condition=None --quiet >/dev/null
done

if [ "${PROVISION_SQL}" = "true" ]; then
  log "Cloud SQL for MySQL (8-12 minutes on first run)"
  if ! gcloud sql instances describe "${SQL_INSTANCE}" >/dev/null 2>&1; then
    DB_PASSWORD="$(openssl rand -base64 24 | tr -d '/+=' | cut -c1-24)"
    gcloud sql instances create "${SQL_INSTANCE}" \
      --database-version=MYSQL_8_0 --tier="${SQL_TIER}" --region="${REGION}" \
      --storage-size=10GB --storage-type=SSD --availability-type=zonal \
      --root-password="${DB_PASSWORD}" --quiet
    gcloud sql databases create "${DB_NAME}" --instance="${SQL_INSTANCE}" --quiet || true
    gcloud sql users create "${DB_USER}" --instance="${SQL_INSTANCE}" --password="${DB_PASSWORD}" --quiet
    SQL_IP="$(gcloud sql instances describe "${SQL_INSTANCE}" --format='value(ipAddresses[0].ipAddress)')"
    DATABASE_URL="mysql://${DB_USER}:${DB_PASSWORD}@${SQL_IP}:3306/${DB_NAME}"
    printf '%s' "${DATABASE_URL}" | gcloud secrets create part21-database-url --data-file=- --quiet 2>/dev/null \
      || printf '%s' "${DATABASE_URL}" | gcloud secrets versions add part21-database-url --data-file=- --quiet
    printf '\nNOTE: Cloud SQL is reachable on its public IP. For production, switch to\n'
    printf 'private IP with a Serverless VPC connector, or use the Cloud SQL Auth Proxy.\n'
  else
    log "Cloud SQL instance already exists; leaving data untouched"
    if ! gcloud secrets describe part21-database-url >/dev/null 2>&1; then
      die "Instance ${SQL_INSTANCE} exists but secret part21-database-url does not. Pass DATABASE_URL explicitly."
    fi
  fi
elif [ -n "${DATABASE_URL}" ]; then
  log "Storing the supplied DATABASE_URL in Secret Manager"
  printf '%s' "${DATABASE_URL}" | gcloud secrets create part21-database-url --data-file=- --quiet 2>/dev/null \
    || printf '%s' "${DATABASE_URL}" | gcloud secrets versions add part21-database-url --data-file=- --quiet
fi

gcloud secrets describe part21-database-url >/dev/null 2>&1 || die "No DATABASE_URL secret was created."
gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="serviceAccount:${SA_EMAIL}" --role="roles/cloudsql.client" --condition=None --quiet >/dev/null

log "Encryption key for per-user connector settings"
if ! gcloud secrets describe part21-settings-key >/dev/null 2>&1; then
  openssl rand -base64 32 | tr -d '\n' | gcloud secrets create part21-settings-key --data-file=- --quiet
fi

log "Evidence bucket (versioned; Bucket Lock intentionally not applied)"
gcloud storage buckets describe "gs://${BUCKET}" >/dev/null 2>&1 \
  || gcloud storage buckets create "gs://${BUCKET}" --location="${REGION}" \
       --uniform-bucket-level-access --public-access-prevention --quiet
gcloud storage buckets update "gs://${BUCKET}" --versioning --quiet >/dev/null

log "Building the image with Cloud Build"
gcloud builds submit --config deploy/gcp/cloudbuild.yaml \
  --substitutions="_IMAGE=${IMAGE}" --region="${REGION}" --quiet .

deploy_service() {
  local name="$1" command="$2" args="$3" port="$4" cpu_throttling="$5" min_instances="$6" ingress="$7"
  shift 7
  gcloud run deploy "${name}" \
    --image="${IMAGE}" --region="${REGION}" --platform=managed \
    --service-account="${SA_EMAIL}" --port="${port}" \
    --command="${command}" --args="${args}" \
    --cpu=1 --memory=1Gi --min-instances="${min_instances}" --max-instances=4 \
    --ingress="${ingress}" --no-allow-unauthenticated \
    ${cpu_throttling} --set-secrets="DATABASE_URL=part21-database-url:latest,PART21_SETTINGS_KEY=part21-settings-key:latest" \
    "$@" --quiet
}

log "Deploying the application"
APP_ENV=(--set-env-vars "NODE_ENV=production,PART21_AUTO_SUPERVISE=false")
deploy_service "${APP_SERVICE}" "node" "dist/index.js" "8080" "--cpu-boost" "0" "all" "${APP_ENV[@]}"

if [ "${DEPLOY_WORKER}" = "true" ]; then
  [ -n "${TEMPORAL_ADDRESS}" ] || die "DEPLOY_WORKER=true requires TEMPORAL_ADDRESS (Temporal Cloud endpoint)."
  log "Deploying the clock worker (Temporal Cloud: ${TEMPORAL_ADDRESS})"
  WORKER_ENV=(--set-env-vars "NODE_ENV=production,TEMPORAL_ADDRESS=${TEMPORAL_ADDRESS},TEMPORAL_NAMESPACE=${TEMPORAL_NAMESPACE},TEMPORAL_TASK_QUEUE=${TEMPORAL_TASK_QUEUE},TEMPORAL_TLS=${TEMPORAL_TLS},TEMPORAL_HEALTH_PORT=8090,TEMPORAL_HEALTH_HOST=0.0.0.0,TEMPORAL_WORKFLOW_BUNDLE_PATH=/app/dist/temporal/workflow-bundle.js,TEMPORAL_WORKER_ENTRY=/app/dist/temporal/worker-entry.js")
  deploy_service "${WORKER_SERVICE}" "node" "dist/temporal/worker-entry.js" "8090" "--no-cpu-throttling" "1" "internal" "${WORKER_ENV[@]}"
else
  log "Skipping the worker (DEPLOY_WORKER=false). Clocks still compute on demand; only durable timers need it."
fi


run_job() {
  local name="$1" entrypoint="$2" args="$3"
  log "Job ${name}: ${entrypoint} ${args}"
  if gcloud run jobs describe "${name}" --region="${REGION}" >/dev/null 2>&1; then
    gcloud run jobs update "${name}" --image="${IMAGE}" --region="${REGION}" \
      --service-account="${SA_EMAIL}" --command="${entrypoint}" --args="${args}" \
      --set-secrets="DATABASE_URL=part21-database-url:latest" --quiet
  else
    gcloud run jobs create "${name}" --image="${IMAGE}" --region="${REGION}" \
      --service-account="${SA_EMAIL}" --command="${entrypoint}" --args="${args}" \
      --set-secrets="DATABASE_URL=part21-database-url:latest" --quiet
  fi
  gcloud run jobs execute "${name}" --region="${REGION}" --wait --quiet
}

if [ "${RUN_MIGRATIONS}" = "true" ]; then
  run_job "part21-migrate" "node_modules/.bin/drizzle-kit" "migrate"
else
  log "Skipping migrations (RUN_MIGRATIONS=false)"
fi

if [ "${INGEST_ECFR}" = "true" ]; then
  run_job "part21-ingest-ecfr" "node_modules/.bin/tsx" "scripts/ecfr-ingest-part21.ts"
else
  log "Skipping eCFR ingest (INGEST_ECFR=false)"
fi

APP_URL="$(gcloud run services describe "${APP_SERVICE}" --region="${REGION}" --format='value(status.url)')"

cat <<EOF

────────────────────────────────────────────────────────────────
Part 21 Assurance OS is deployed.

  Service   ${APP_URL}
  Access    private (Cloud Run IAM). Open it locally with:
              gcloud run services proxy ${APP_SERVICE} --region=${REGION} --port=8080
            then browse http://localhost:8080

Next steps
  1. The schema and the eCFR snapshot were applied by Cloud Run jobs
     (part21-migrate, part21-ingest-ecfr). Check them with:
       gcloud run jobs executions list --job=part21-migrate --region=REGION
  2. For durable clocks, point TEMPORAL_ADDRESS at Temporal Cloud and re-run with
       DEPLOY_WORKER=true
  3. For browser access without the proxy, put an external Application Load Balancer
     with IAP in front of the service.
  4. For Agent Registry, enable agentregistry.googleapis.com and register the
     connector as a NO_SPEC service.

To delete everything this script created, see docs/GCP-DEPLOYMENT.md.
────────────────────────────────────────────────────────────────
EOF
