# Deploying on Google Cloud

One command provisions the database, the image, both services, the schema and the
regulation snapshot. This page states exactly what that command does, what it cannot do,
and what it costs.

## What the one command does

`deploy/gcp/bootstrap.sh` runs these steps in order and is safe to re-run:

1. Enables the required APIs (Run, Cloud Build, Artifact Registry, Secret Manager,
   Cloud Storage, Cloud SQL, IAM, Logging).
2. Creates an Artifact Registry repository and a runtime service account with least
   privilege (secret access, bucket objects, Cloud SQL client, log writing).
3. Creates a Cloud SQL for MySQL 8 instance, a database and a user, generates a password,
   and stores the connection string in Secret Manager. **First run takes 8–12 minutes.**
4. Creates a versioned, public-access-prevented Cloud Storage bucket for evidence.
5. Generates the settings-encryption key into Secret Manager.
6. Builds the image with Cloud Build from `deploy/gcp/Dockerfile`.
7. Deploys `part21-app` (Cloud Run, private) and optionally `part21-worker`.
8. Runs `part21-migrate` as a Cloud Run job to apply the schema.
9. Runs `part21-ingest-ecfr` as a Cloud Run job to ingest Part 21 and Appendix B.

## What it does not do

Stated up front, because these are the things that used to turn "one command" into a list:

| Not done | Why | What you do |
|---|---|---|
| **Temporal server** | A stateful Temporal server cannot live in a Cloud Run container | Create a Temporal Cloud namespace, then re-run with `DEPLOY_WORKER=true TEMPORAL_ADDRESS=...` |
| **Browser login (IAP)** | Needs a load balancer and an OAuth brand | Use `gcloud run services proxy` now; add IAP for shared access |
| **Agent Registry** | Needs the API enabled in your org and your governance project | See the registration section below |
| **Vertex AI model** | Optional; the app runs with its configured provider | Set `PART21_LLM_MODEL` and provider credentials if you want Gemini |

The clock engine still computes deadlines without Temporal. Only the durable timers and
automatic notices need it.

## Prerequisites

- A Google Cloud project with billing enabled.
- Permission to create service accounts, Cloud SQL instances and Cloud Run services
  (Owner or Editor plus Service Account Admin).

## Deploy

In [Cloud Shell](https://shell.cloud.google.com), upload the repository archive, then:

```bash
tar xzf part21-assurance-os-gcp.tar.gz
cd part21ops

PROJECT_ID=your-project-id bash deploy/gcp/bootstrap.sh
```

Expect 15–25 minutes on the first run, most of it Cloud SQL.

Options:

```bash
# Use an existing database instead of provisioning Cloud SQL
DATABASE_URL="mysql://user:pass@host:3306/db" PROVISION_SQL=false bash deploy/gcp/bootstrap.sh

# Skip the regulation ingest (faster; the workspace will be empty of provisions)
INGEST_ECFR=false bash deploy/gcp/bootstrap.sh

# Bind the clock worker to Temporal Cloud
DEPLOY_WORKER=true TEMPORAL_ADDRESS=your-namespace.a2dd6.tmprl.cloud:7233 \
  TEMPORAL_NAMESPACE=your-namespace TEMPORAL_TLS=true bash deploy/gcp/bootstrap.sh
```

## Open it

The service is private by default. Proxy it to your machine:

```bash
gcloud run services proxy part21-app --region=us-central1 --port=8080
```

Then browse `http://localhost:8080`. For shared access, put an external Application Load
Balancer with IAP in front of the service.

## Verify

```bash
gcloud run services describe part21-app --region=us-central1 --format='value(status.url)'
gcloud run jobs executions list --job=part21-migrate --region=us-central1 --limit=1
gcloud run jobs executions list --job=part21-ingest-ecfr --region=us-central1 --limit=1
```

Through the proxy:

```bash
curl -s localhost:8080/api/health
curl -s localhost:8080/api/regulatory/coverage | jq '.accountedPercent, .totals'
curl -s localhost:8080/api/regulatory/graph-status | jq '{canProject, reason}'
```

`accountedPercent` should be 100 with 36 references, 34 resolved and 2 declared external.

## Agent Registry

Once the app answers, register it so it appears in the catalog:

```bash
gcloud services enable agentregistry.googleapis.com

gcloud agent-registry services create part21-connector \
  --project=YOUR_PROJECT --location=us \
  --display-name="Part 21 Assurance OS Connector" \
  --agent-spec-type=no-spec \
  --endpoint-url=https://YOUR_RUN_URL/api/v1
```

For the three agents (Compliance, Field, Regulatory), publish an
`agent-card.json` per agent at a public `/.well-known/` path and register with
`--agent-spec-type=a2a-agent-card --agent-spec-content=agent-card.json`. Cards are
metadata only; the invocation endpoint stays authenticated.

## Cost

Approximate monthly, US region, idle:

| Item | Cost |
|---|---|
| Cloud SQL `db-custom-1-3840` | ~$50 |
| Cloud Run app (scale to zero) | ~$0–5 |
| Cloud Run worker (if enabled, min 1) | ~$15–25 |
| Cloud Storage (evidence, small) | ~$1 |
| Secret Manager, Artifact Registry | ~$2 |
| **Total** | **~$70–85/month** |

Temporal Cloud is billed separately by Temporal.

## Teardown

```bash
gcloud run services delete part21-app --region=us-central1 --quiet
gcloud run services delete part21-worker --region=us-central1 --quiet
gcloud run jobs delete part21-migrate --region=us-central1 --quiet
gcloud run jobs delete part21-ingest-ecfr --region=us-central1 --quiet
gcloud sql instances delete part21-mysql --quiet
gcloud storage rm -r gs://YOUR_PROJECT-part21-evidence
gcloud secrets delete part21-database-url --quiet
gcloud secrets delete part21-settings-key --quiet
gcloud artifacts repositories delete part21 --location=us-central1 --quiet
```

Deleting the Cloud SQL instance deletes the audit data. Export first if it matters.

## Honest limits of this deployment

1. **Cloud SQL is on a public IP.** Fine for a pilot; for production use private IP with a
   Serverless VPC connector, or the Cloud SQL Auth Proxy.
2. **No IAP yet.** Access is Cloud Run IAM plus the proxy. Shared browser access needs the
   load balancer.
3. **No Terraform.** This script is imperative. A validation program needs declarative
   infrastructure under configuration control; the Terraform equivalent is the next step.
4. **Demo data is not created.** The database starts empty and the regulation is ingested;
   no synthetic audits are seeded, by design.
5. **This is not a validated deployment.** See `docs/VALIDATION-ROADMAP.md`.
