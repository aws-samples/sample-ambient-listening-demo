#!/usr/bin/env bash
set -euo pipefail

# ═══════════════════════════════════════════════════════════════════════════════
# Register an OAuth2 API client in OpenEMR for the Demo App
# ═══════════════════════════════════════════════════════════════════════════════
#
# This script:
# 1. Logs into OpenEMR as admin to get a session
# 2. Registers a new OAuth2 client with client_credentials grant
# 3. Updates the DemoAppStack/fhir-api-credentials secret in Secrets Manager
#
# Prerequisites:
# - OpenEMR is deployed and accessible
# - AWS credentials are configured
# - OpenEMR admin credentials are in Secrets Manager
# ═══════════════════════════════════════════════════════════════════════════════

REGION="${AWS_DEFAULT_REGION:-us-east-1}"
OPENEMR_URL="${OPENEMR_URL:-}"
ADMIN_SECRET_ARN="${ADMIN_SECRET_ARN:-}"
FHIR_CREDS_SECRET_ARN="${FHIR_CREDS_SECRET_ARN:-}"

RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

log()  { echo -e "${BLUE}[register]${NC} $1"; }
ok()   { echo -e "${GREEN}  ✓${NC} $1"; }
fail() { echo -e "${RED}  ✗ ERROR:${NC} $1"; exit 1; }

# ─── Get OpenEMR admin credentials ───────────────────────────────────────────

if [[ -z "$ADMIN_SECRET_ARN" ]]; then
  ADMIN_SECRET_ARN=$(aws cloudformation describe-stacks \
    --stack-name OpenemrEcsStack \
    --region "$REGION" \
    --query 'Stacks[0].Outputs[?OutputKey==`OpenEMRPasswordSecretARN`].OutputValue' \
    --output text 2>/dev/null) || fail "Could not find OpenEMR admin secret ARN"
fi

ADMIN_PASSWORD=$(aws secretsmanager get-secret-value \
  --secret-id "$ADMIN_SECRET_ARN" \
  --region "$REGION" \
  --query 'SecretString' --output text 2>/dev/null) || fail "Could not retrieve admin password"

# The OpenEMR password secret is just the password string directly
ADMIN_USER="admin"

if [[ -z "$OPENEMR_URL" ]]; then
  OPENEMR_URL=$(aws cloudformation describe-stacks \
    --stack-name OpenemrEcsStack \
    --region "$REGION" \
    --query 'Stacks[0].Outputs[?OutputKey==`ApplicationURL`].OutputValue' \
    --output text 2>/dev/null) || fail "Could not find OpenEMR URL"
fi

log "OpenEMR URL: $OPENEMR_URL"
log "Registering OAuth2 client..."

# ─── Register OAuth2 client via OpenEMR API ───────────────────────────────────

# OpenEMR supports dynamic client registration per RFC 7591
# First, we need to get an access token using password grant (admin login)
TOKEN_RESPONSE=$(curl -sk --max-time 30 -X POST \
  "${OPENEMR_URL}/oauth2/default/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=password&username=${ADMIN_USER}&password=${ADMIN_PASSWORD}&client_id=site_admin&scope=openid" \
  2>/dev/null) || fail "Could not get admin token from OpenEMR"

ADMIN_TOKEN=$(echo "$TOKEN_RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('access_token',''))" 2>/dev/null) || true

if [[ -z "$ADMIN_TOKEN" ]]; then
  # Try alternative: use the registration endpoint directly (some OpenEMR versions allow it)
  log "Password grant failed, trying direct registration..."
  
  REGISTER_RESPONSE=$(curl -sk --max-time 30 -X POST \
    "${OPENEMR_URL}/oauth2/default/registration" \
    -H "Content-Type: application/json" \
    -d '{
      "application_type": "private",
      "redirect_uris": [],
      "token_endpoint_auth_method": "client_secret_post",
      "client_name": "DemoApp FHIR Client",
      "grant_types": ["client_credentials"],
      "scope": "openid fhirUser system/Patient.read system/Condition.read system/MedicationRequest.read system/AllergyIntolerance.read system/Encounter.read system/Observation.read system/Procedure.read system/Immunization.read system/DiagnosticReport.read system/DocumentReference.read system/DocumentReference.write"
    }' 2>/dev/null) || fail "Client registration request failed"
else
  # Use the admin token to register the client
  REGISTER_RESPONSE=$(curl -sk --max-time 30 -X POST \
    "${OPENEMR_URL}/oauth2/default/registration" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${ADMIN_TOKEN}" \
    -d '{
      "application_type": "private",
      "redirect_uris": [],
      "token_endpoint_auth_method": "client_secret_post",
      "client_name": "DemoApp FHIR Client",
      "grant_types": ["client_credentials"],
      "scope": "openid fhirUser system/Patient.read system/Condition.read system/MedicationRequest.read system/AllergyIntolerance.read system/Encounter.read system/Observation.read system/Procedure.read system/Immunization.read system/DiagnosticReport.read system/DocumentReference.read system/DocumentReference.write"
    }' 2>/dev/null) || fail "Client registration request failed"
fi

# Extract client_id and client_secret from registration response
CLIENT_ID=$(echo "$REGISTER_RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('client_id',''))" 2>/dev/null) || true
CLIENT_SECRET=$(echo "$REGISTER_RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('client_secret',''))" 2>/dev/null) || true

if [[ -z "$CLIENT_ID" || -z "$CLIENT_SECRET" ]]; then
  echo "Registration response: $REGISTER_RESPONSE"
  fail "Could not extract client_id/client_secret from registration response"
fi

ok "Client registered: $CLIENT_ID"

# ─── Update Secrets Manager ───────────────────────────────────────────────────

if [[ -z "$FHIR_CREDS_SECRET_ARN" ]]; then
  FHIR_CREDS_SECRET_ARN=$(aws cloudformation describe-stacks \
    --stack-name DemoAppStack \
    --region "$REGION" \
    --query 'Stacks[0].Outputs[?OutputKey==`FhirApiCredentialsSecretArn`].OutputValue' \
    --output text 2>/dev/null) || fail "Could not find FHIR credentials secret ARN"
fi

aws secretsmanager put-secret-value \
  --secret-id "$FHIR_CREDS_SECRET_ARN" \
  --secret-string "{\"clientId\":\"${CLIENT_ID}\",\"clientSecret\":\"${CLIENT_SECRET}\"}" \
  --region "$REGION" >/dev/null 2>&1 || fail "Could not update FHIR credentials secret"

ok "Updated Secrets Manager: $FHIR_CREDS_SECRET_ARN"

# ─── Force ECS task restart to pick up new credentials ────────────────────────

log "Restarting ECS tasks to pick up new credentials..."
CLUSTER=$(aws ecs list-clusters --region "$REGION" --query "clusterArns[?contains(@, 'DemoApp')]" --output text 2>/dev/null | head -1) || true
if [[ -n "$CLUSTER" ]]; then
  SERVICE=$(aws ecs list-services --cluster "$CLUSTER" --region "$REGION" --query 'serviceArns[0]' --output text 2>/dev/null) || true
  if [[ -n "$SERVICE" ]]; then
    aws ecs update-service --cluster "$CLUSTER" --service "$SERVICE" --force-new-deployment --region "$REGION" >/dev/null 2>&1 || true
    ok "ECS service redeployment triggered"
  fi
fi

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  OAuth2 Client Registration Complete"
echo "═══════════════════════════════════════════════════════════════"
echo "  Client ID:     $CLIENT_ID"
echo "  Secret ARN:    $FHIR_CREDS_SECRET_ARN"
echo "  ECS tasks will restart with new credentials in ~2 minutes"
echo "═══════════════════════════════════════════════════════════════"
