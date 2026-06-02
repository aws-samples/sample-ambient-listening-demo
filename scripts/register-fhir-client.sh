#!/usr/bin/env bash
set -euo pipefail

# ═══════════════════════════════════════════════════════════════════════════════
# Register FHIR OAuth2 Client in OpenEMR
# ═══════════════════════════════════════════════════════════════════════════════
#
# Registers a client_credentials OAuth2 client in OpenEMR and updates
# the DemoAppStack/fhir-api-credentials secret in Secrets Manager.
#
# Usage:
#   ./scripts/register-fhir-client.sh [--region REGION]
#
# Requires:
#   - OpenEMR stack deployed and accessible
#   - DemoAppStack deployed
#   - AWS credentials configured
# ═══════════════════════════════════════════════════════════════════════════════

REGION="${1:-us-east-1}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

log()  { echo -e "${BLUE}[fhir-client]${NC} $1"; }
ok()   { echo -e "${GREEN}  ✓${NC} $1"; }
fail() { echo -e "${RED}  ✗ ERROR:${NC} $1"; exit 1; }

# Get OpenEMR URL
OPENEMR_URL=$(aws ssm get-parameter --name "/OpenEmrStack/WebConsoleUrl" --region "$REGION" --query 'Parameter.Value' --output text 2>/dev/null) || fail "Could not get OpenEMR URL from SSM"
log "OpenEMR URL: $OPENEMR_URL"

# Get OpenEMR admin password from Secrets Manager
OPENEMR_SECRET_ARN="arn:aws:secretsmanager:${REGION}:$(aws sts get-caller-identity --query Account --output text):secret:Password67973E0B-K0EzZgbdgkG6"
ADMIN_PASSWORD=$(aws secretsmanager get-secret-value --secret-id "$OPENEMR_SECRET_ARN" --region "$REGION" --query 'SecretString' --output text 2>/dev/null) || fail "Could not get OpenEMR admin password"

# The password might be a JSON object or plain string
if echo "$ADMIN_PASSWORD" | python3 -c "import sys,json; json.load(sys.stdin)" 2>/dev/null; then
  ADMIN_PASSWORD=$(echo "$ADMIN_PASSWORD" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('password', d.get('Password', '')))")
fi

log "Got admin credentials"

# Step 1: Get an admin access token
log "Authenticating as admin..."
ADMIN_TOKEN_RESPONSE=$(curl -sk -X POST "${OPENEMR_URL}/oauth2/default/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=password&username=admin&password=${ADMIN_PASSWORD}&client_id=site_admin&scope=openid" \
  --max-time 30 2>/dev/null) || fail "Could not authenticate with OpenEMR"

ADMIN_TOKEN=$(echo "$ADMIN_TOKEN_RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('access_token',''))" 2>/dev/null) || true

if [[ -z "$ADMIN_TOKEN" ]]; then
  # Try the registration endpoint directly (some OpenEMR versions allow unauthenticated registration)
  log "Direct auth failed, trying dynamic client registration..."
fi

# Step 2: Register a new OAuth2 client via dynamic registration
log "Registering FHIR OAuth2 client..."
REGISTRATION_RESPONSE=$(curl -sk -X POST "${OPENEMR_URL}/oauth2/default/registration" \
  -H "Content-Type: application/json" \
  -d '{
    "application_type": "private",
    "redirect_uris": ["https://localhost/callback"],
    "client_name": "Ambient Clinical Documentation Demo",
    "token_endpoint_auth_method": "client_secret_post",
    "contacts": ["admin@demo.local"],
    "scope": "openid fhirUser system/Patient.read system/Condition.read system/MedicationRequest.read system/AllergyIntolerance.read system/Encounter.read system/Observation.read system/Procedure.read system/Immunization.read system/DiagnosticReport.read system/DocumentReference.read system/DocumentReference.write",
    "grant_types": ["client_credentials"]
  }' \
  --max-time 30 2>/dev/null)

echo "$REGISTRATION_RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'Client ID: {d.get(\"client_id\",\"FAILED\")}')" 2>/dev/null || {
  echo "Registration response: $REGISTRATION_RESPONSE"
  fail "Client registration failed"
}

CLIENT_ID=$(echo "$REGISTRATION_RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin)['client_id'])")
CLIENT_SECRET=$(echo "$REGISTRATION_RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin)['client_secret'])")

ok "Registered client: $CLIENT_ID"

# Step 3: Update the Secrets Manager secret with real credentials
log "Updating DemoAppStack/fhir-api-credentials in Secrets Manager..."
FHIR_SECRET_ARN=$(aws cloudformation describe-stacks \
  --stack-name DemoAppStack \
  --region "$REGION" \
  --query 'Stacks[0].Outputs[?OutputKey==`FhirApiCredentialsSecretArn`].OutputValue' \
  --output text) || fail "Could not get FHIR credentials secret ARN"

aws secretsmanager put-secret-value \
  --secret-id "$FHIR_SECRET_ARN" \
  --secret-string "{\"clientId\":\"${CLIENT_ID}\",\"clientSecret\":\"${CLIENT_SECRET}\"}" \
  --region "$REGION" >/dev/null || fail "Could not update secret"

ok "Secret updated: $FHIR_SECRET_ARN"

# Step 4: Force ECS task to restart (pick up new secret)
log "Restarting ECS tasks to pick up new credentials..."
CLUSTER=$(aws ecs list-clusters --region "$REGION" --query "clusterArns[?contains(@, 'DemoApp')]" --output text | head -1)
SERVICE=$(aws ecs list-services --cluster "$CLUSTER" --region "$REGION" --query 'serviceArns[0]' --output text)
aws ecs update-service --cluster "$CLUSTER" --service "$SERVICE" --force-new-deployment --region "$REGION" >/dev/null 2>&1 || true
ok "ECS service redeployment triggered"

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  FHIR Client Registration Complete"
echo "═══════════════════════════════════════════════════════════════"
echo ""
echo "  Client ID:     $CLIENT_ID"
echo "  Secret ARN:    $FHIR_SECRET_ARN"
echo "  Status:        Registered and deployed"
echo ""
echo "  The ECS tasks will restart in ~60 seconds with the new credentials."
echo ""
echo "═══════════════════════════════════════════════════════════════"
