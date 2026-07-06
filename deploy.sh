#!/usr/bin/env bash
set -euo pipefail

# ═══════════════════════════════════════════════════════════════════════════════
# Ambient Clinical Documentation Demo — One-Command Deployment
# ═══════════════════════════════════════════════════════════════════════════════
#
# Usage:
#   ./deploy.sh --domain <route53-domain> [--region REGION] [--skip-openemr] [--skip-data-load]
#
# Example:
#   ./deploy.sh --domain <your-route53-domain> --connect-health-domain <your-domain-name>
#
# Prerequisites:
#   - AWS CLI configured with credentials
#   - Node.js 20+, npm 10+, Python 3.9+, AWS CDK CLI 2.150+
#   - A Route53 hosted zone for the provided domain
#   - Docker (for CDK asset bundling)
#
# This script:
#   1. Creates an ACM certificate for the domain (DNS-validated via Route53)
#   2. Deploys OpenEMR on ECS Fargate (FHIR R4 API)
#   3. Deploys the Demo Application on ECS Fargate (Next.js + Connect Health)
#   4. Loads synthetic patient data (optional)
#
# Estimated time: 45-60 minutes
# Estimated cost: ~$0.50-0.65/hr while running
# ═══════════════════════════════════════════════════════════════════════════════

REGION="us-east-1"
DOMAIN=""
CONNECT_HEALTH_DOMAIN=""
SKIP_OPENEMR=false
SKIP_DATA_LOAD=false
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ─── Parse Arguments ──────────────────────────────────────────────────────────

while [[ $# -gt 0 ]]; do
  case $1 in
    --domain) DOMAIN="$2"; shift 2 ;;
    --connect-health-domain) CONNECT_HEALTH_DOMAIN="$2"; shift 2 ;;
    --region) REGION="$2"; shift 2 ;;
    --skip-openemr) SKIP_OPENEMR=true; shift ;;
    --skip-data-load) SKIP_DATA_LOAD=true; shift ;;
    -h|--help)
      echo "Usage: ./deploy.sh --domain <route53-domain> --connect-health-domain <name> [--region REGION] [--skip-openemr] [--skip-data-load]"
      echo ""
      echo "Required:"
      echo "  --domain DOMAIN                   Route53 hosted zone domain (e.g., hda.example.people.aws.dev)"
      echo "  --connect-health-domain NAME      Amazon Connect Health domain name (created via console)"
      echo ""
      echo "Options:"
      echo "  --region REGION     AWS region (default: us-east-1, must be us-east-1 or us-west-2)"
      echo "  --skip-openemr      Skip OpenEMR stack deployment (if already deployed)"
      echo "  --skip-data-load    Skip synthetic patient data loading"
      exit 0
      ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

# ─── Helpers ──────────────────────────────────────────────────────────────────

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log()   { echo -e "${BLUE}[deploy]${NC} $1"; }
ok()    { echo -e "${GREEN}  ✓${NC} $1"; }
warn()  { echo -e "${YELLOW}  ⚠${NC} $1"; }
fail()  { echo -e "${RED}  ✗ ERROR:${NC} $1"; exit 1; }

# ─── Preflight Checks ────────────────────────────────────────────────────────

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  Ambient Clinical Documentation Demo — Deployment"
echo "═══════════════════════════════════════════════════════════════"
echo ""

log "Running preflight checks..."

# Validate domain is provided
if [[ -z "$DOMAIN" ]]; then
  fail "Domain is required. Usage: ./deploy.sh --domain <route53-domain> --connect-health-domain <name>"
fi
ok "Domain: $DOMAIN"

# Validate Connect Health domain is provided
if [[ -z "$CONNECT_HEALTH_DOMAIN" ]]; then
  fail "Connect Health domain is required. Create one in the AWS console first, then pass: --connect-health-domain <name>"
fi
ok "Connect Health domain: $CONNECT_HEALTH_DOMAIN"

# Validate region
if [[ "$REGION" != "us-east-1" && "$REGION" != "us-west-2" ]]; then
  fail "Region must be us-east-1 or us-west-2 (Amazon Connect Health requirement). Got: $REGION"
fi
ok "Region: $REGION"

# Check required tools
command -v aws >/dev/null 2>&1 || fail "AWS CLI not found. Install: https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html"
command -v node >/dev/null 2>&1 || fail "Node.js not found. Install: https://nodejs.org/"
command -v cdk >/dev/null 2>&1 || fail "AWS CDK CLI not found. Install: npm install -g aws-cdk"
command -v python3 >/dev/null 2>&1 || fail "Python 3 not found. Install: https://www.python.org/downloads/"
ok "Required CLI tools found"

# Check Node.js version
NODE_MAJOR=$(node --version | cut -d. -f1 | tr -d 'v')
if [[ "$NODE_MAJOR" -lt 20 ]]; then
  fail "Node.js 20+ required. Found: $(node --version)"
fi
ok "Node.js $(node --version)"

# Check AWS credentials
AWS_ACCOUNT=$(aws sts get-caller-identity --query Account --output text 2>/dev/null) || fail "AWS credentials not configured. Run: aws configure"
ok "AWS Account: $AWS_ACCOUNT"

# Get caller IP for security group (use /24 to handle IP variance within the same network)
MY_IP=$(curl -s --max-time 5 https://checkip.amazonaws.com 2>/dev/null) || fail "Could not determine your public IP"
MY_CIDR="${MY_IP%.*}.0/24"
ok "Your IP: $MY_IP (allowing ${MY_CIDR})"

# Verify Route53 hosted zone exists
HOSTED_ZONE_ID=$(aws route53 list-hosted-zones-by-name \
  --dns-name "$DOMAIN" \
  --query "HostedZones[?Name=='${DOMAIN}.'].Id" \
  --output text 2>/dev/null | head -1 | sed 's|/hostedzone/||') || true

if [[ -z "$HOSTED_ZONE_ID" || "$HOSTED_ZONE_ID" == "None" ]]; then
  fail "Route53 hosted zone not found for domain: $DOMAIN. Create one first."
fi
ok "Route53 hosted zone: $HOSTED_ZONE_ID"

# Check CDK bootstrap
aws cloudformation describe-stacks --stack-name CDKToolkit --region "$REGION" --query 'Stacks[0].StackStatus' --output text >/dev/null 2>&1 || {
  log "CDK not bootstrapped in $REGION. Bootstrapping now..."
  cdk bootstrap "aws://$AWS_ACCOUNT/$REGION" || fail "CDK bootstrap failed"
  ok "CDK bootstrapped"
}
ok "CDK bootstrapped in $REGION"

echo ""
log "Preflight checks passed. Starting deployment..."
echo ""

# ─── Create ACM Certificate ──────────────────────────────────────────────────

OPENEMR_DOMAIN="openemr.${DOMAIN}"
DEMO_DOMAIN="ambient.${DOMAIN}"
WILDCARD_DOMAIN="*.${DOMAIN}"

log "Checking for existing ACM certificate..."

# Look for an existing wildcard or matching certificate
EXISTING_CERT_ARN=$(aws acm list-certificates \
  --region "$REGION" \
  --query "CertificateSummaryList[?DomainName=='${WILDCARD_DOMAIN}' && Status=='ISSUED'].CertificateArn" \
  --output text 2>/dev/null | head -1) || true

if [[ -z "$EXISTING_CERT_ARN" || "$EXISTING_CERT_ARN" == "None" ]]; then
  # Try exact domain match
  EXISTING_CERT_ARN=$(aws acm list-certificates \
    --region "$REGION" \
    --query "CertificateSummaryList[?DomainName=='${OPENEMR_DOMAIN}' && Status=='ISSUED'].CertificateArn" \
    --output text 2>/dev/null | head -1) || true
fi

if [[ -n "$EXISTING_CERT_ARN" && "$EXISTING_CERT_ARN" != "None" ]]; then
  ok "Using existing certificate: $EXISTING_CERT_ARN"
  CERT_ARN="$EXISTING_CERT_ARN"
else
  log "Creating ACM certificate for *.${DOMAIN}..."

  CERT_ARN=$(aws acm request-certificate \
    --domain-name "${WILDCARD_DOMAIN}" \
    --subject-alternative-names "${DOMAIN}" "${OPENEMR_DOMAIN}" "${DEMO_DOMAIN}" \
    --validation-method DNS \
    --region "$REGION" \
    --query 'CertificateArn' \
    --output text)

  ok "Certificate requested: $CERT_ARN"

  # Wait for DNS validation records to be available
  log "Waiting for DNS validation records..."
  sleep 10

  # Get validation records and create them in Route53
  VALIDATION_OPTIONS=$(aws acm describe-certificate \
    --certificate-arn "$CERT_ARN" \
    --region "$REGION" \
    --query 'Certificate.DomainValidationOptions[*].ResourceRecord' \
    --output json 2>/dev/null)

  # Create Route53 validation records
  CHANGE_BATCH='{"Changes":['
  FIRST=true
  while IFS= read -r record; do
    NAME=$(echo "$record" | python3 -c "import sys,json; r=json.load(sys.stdin); print(r['Name'])")
    VALUE=$(echo "$record" | python3 -c "import sys,json; r=json.load(sys.stdin); print(r['Value'])")
    TYPE=$(echo "$record" | python3 -c "import sys,json; r=json.load(sys.stdin); print(r['Type'])")

    if [[ "$FIRST" == "true" ]]; then
      FIRST=false
    else
      CHANGE_BATCH+=','
    fi
    CHANGE_BATCH+="{\"Action\":\"UPSERT\",\"ResourceRecordSet\":{\"Name\":\"${NAME}\",\"Type\":\"${TYPE}\",\"TTL\":300,\"ResourceRecords\":[{\"Value\":\"${VALUE}\"}]}}"
  done < <(echo "$VALIDATION_OPTIONS" | python3 -c "
import sys, json
records = json.load(sys.stdin)
seen = set()
for r in records:
    if r and r['Name'] not in seen:
        seen.add(r['Name'])
        print(json.dumps(r))
")
  CHANGE_BATCH+=']}'

  aws route53 change-resource-record-sets \
    --hosted-zone-id "$HOSTED_ZONE_ID" \
    --change-batch "$CHANGE_BATCH" \
    --output text >/dev/null 2>&1

  ok "DNS validation records created in Route53"

  # Wait for certificate to be issued
  log "Waiting for certificate validation (this may take 2-5 minutes)..."
  aws acm wait certificate-validated \
    --certificate-arn "$CERT_ARN" \
    --region "$REGION" 2>/dev/null || {
    # Retry with longer timeout
    sleep 30
    aws acm wait certificate-validated \
      --certificate-arn "$CERT_ARN" \
      --region "$REGION" 2>/dev/null || fail "Certificate validation timed out. Check ACM console."
  }

  ok "Certificate issued and validated: $CERT_ARN"
fi

# ─── Step 1: Deploy OpenEMR Stack ────────────────────────────────────────────

if [[ "$SKIP_OPENEMR" == "false" ]]; then
  echo ""
  echo "───────────────────────────────────────────────────────────────"
  log "Step 1/3: Deploying OpenEMR stack (~35 minutes)..."
  echo "───────────────────────────────────────────────────────────────"

  cd "$SCRIPT_DIR/submodules/openemr"

  # Set up Python venv
  if [[ ! -d ".venv" ]]; then
    python3 -m venv .venv
  fi
  source .venv/bin/activate
  pip install -r requirements.txt --quiet

  # Deploy with certificate and domain
  cdk deploy \
    --context "security_group_ip_range_ipv4=${MY_CIDR}" \
    --context "activate_openemr_apis=true" \
    --context "rds_deletion_protection=false" \
    --context "certificate_arn=${CERT_ARN}" \
    --context "route53_domain=${DOMAIN}" \
    --require-approval never \
    --region "$REGION" \
    --outputs-file "$SCRIPT_DIR/.openemr-outputs.json" \
    || fail "OpenEMR CDK deploy failed"

  deactivate 2>/dev/null || true
  cd "$SCRIPT_DIR"

  ok "OpenEMR stack deployed"
else
  log "Skipping OpenEMR deployment (--skip-openemr)"
fi

# ─── Create SSM Parameters from OpenEMR Outputs ──────────────────────────────

log "Publishing OpenEMR outputs to SSM Parameter Store..."

OPENEMR_STACK_NAME="OpenemrEcsStack"

# Get the FHIR API base URL (ApplicationURL + /apis/default/fhir)
OPENEMR_APP_URL=$(aws cloudformation describe-stacks \
  --stack-name "$OPENEMR_STACK_NAME" \
  --region "$REGION" \
  --query 'Stacks[0].Outputs[?OutputKey==`ApplicationURL`].OutputValue' \
  --output text 2>/dev/null) || true

FHIR_BASE_URL="${OPENEMR_APP_URL}/apis/default/fhir"

# Get credentials secret ARN
CREDS_SECRET_ARN=$(aws cloudformation describe-stacks \
  --stack-name "$OPENEMR_STACK_NAME" \
  --region "$REGION" \
  --query 'Stacks[0].Outputs[?OutputKey==`OpenEMRPasswordSecretARN`].OutputValue' \
  --output text 2>/dev/null) || true

# Get database secret ARN (for data loader DB access)
DB_SECRET_ARN=$(aws cloudformation describe-stacks \
  --stack-name "$OPENEMR_STACK_NAME" \
  --region "$REGION" \
  --query 'Stacks[0].Outputs[?OutputKey==`DatabaseSecretARN`].OutputValue' \
  --output text 2>/dev/null) || true

# Get web console URL
WEB_CONSOLE_URL=$(aws cloudformation describe-stacks \
  --stack-name "$OPENEMR_STACK_NAME" \
  --region "$REGION" \
  --query 'Stacks[0].Outputs[?OutputKey==`ApplicationURL`].OutputValue' \
  --output text 2>/dev/null) || true

# Write SSM parameters that the Demo App stack expects
aws ssm put-parameter --name "/OpenEmrStack/FhirApiBaseUrl" --value "$FHIR_BASE_URL" --type String --overwrite --region "$REGION" >/dev/null 2>&1
aws ssm put-parameter --name "/OpenEmrStack/CredentialsSecretArn" --value "$CREDS_SECRET_ARN" --type String --overwrite --region "$REGION" >/dev/null 2>&1
aws ssm put-parameter --name "/OpenEmrStack/DatabaseSecretArn" --value "$DB_SECRET_ARN" --type String --overwrite --region "$REGION" >/dev/null 2>&1
aws ssm put-parameter --name "/OpenEmrStack/WebConsoleUrl" --value "$WEB_CONSOLE_URL" --type String --overwrite --region "$REGION" >/dev/null 2>&1

ok "SSM parameters published"

# Update Route53 record for OpenEMR to point to the current ALB
log "Updating OpenEMR DNS record..."
OPENEMR_ALB_DNS=$(aws elbv2 describe-load-balancers --region "$REGION" \
  --query "LoadBalancers[?contains(LoadBalancerName,'Openem')].DNSName" \
  --output text 2>/dev/null) || true
OPENEMR_ALB_ZONE=$(aws elbv2 describe-load-balancers --region "$REGION" \
  --query "LoadBalancers[?contains(LoadBalancerName,'Openem')].CanonicalHostedZoneId" \
  --output text 2>/dev/null) || true

if [[ -n "$OPENEMR_ALB_DNS" && "$OPENEMR_ALB_DNS" != "None" && -n "$HOSTED_ZONE_ID" ]]; then
  aws route53 change-resource-record-sets \
    --hosted-zone-id "$HOSTED_ZONE_ID" \
    --change-batch "{\"Changes\":[{\"Action\":\"UPSERT\",\"ResourceRecordSet\":{\"Name\":\"${OPENEMR_DOMAIN}\",\"Type\":\"A\",\"AliasTarget\":{\"HostedZoneId\":\"${OPENEMR_ALB_ZONE}\",\"DNSName\":\"dualstack.${OPENEMR_ALB_DNS}\",\"EvaluateTargetHealth\":false}}}]}" \
    --region "$REGION" >/dev/null 2>&1
  ok "OpenEMR DNS updated: ${OPENEMR_DOMAIN} -> ${OPENEMR_ALB_DNS}"
else
  warn "Could not update OpenEMR DNS record"
fi

# ─── Step 2: Deploy Demo App Stack ───────────────────────────────────────────

echo ""
echo "───────────────────────────────────────────────────────────────"
log "Step 2/3: Deploying Demo App stack (~15 minutes)..."
echo "───────────────────────────────────────────────────────────────"

cd "$SCRIPT_DIR/infrastructure/demo-app"
npm install --quiet

# Get the OpenEMR VPC ID to deploy into the same network
OPENEMR_VPC_ID=$(aws ec2 describe-vpcs --region "$REGION" \
  --filters "Name=tag:aws:cloudformation:stack-name,Values=OpenemrEcsStack" \
  --query 'Vpcs[0].VpcId' --output text 2>/dev/null) || true

VPC_CONTEXT=""
if [[ -n "$OPENEMR_VPC_ID" && "$OPENEMR_VPC_ID" != "None" ]]; then
  VPC_CONTEXT="--context vpcId=${OPENEMR_VPC_ID}"
  ok "Deploying into OpenEMR VPC: $OPENEMR_VPC_ID"
fi

# Discover existing Connect Health domain (must be created via console before deploy)
CONNECT_HEALTH_CONTEXT="--context connectHealthDomainName=${CONNECT_HEALTH_DOMAIN}"

cdk deploy \
  --context "allowedCidr=${MY_CIDR}" \
  --context "openemrStackName=OpenEmrStack" \
  --context "certificateArn=${CERT_ARN}" \
  --context "domain=${DEMO_DOMAIN}" \
  $VPC_CONTEXT \
  $CONNECT_HEALTH_CONTEXT \
  --require-approval never \
  --region "$REGION" \
  --outputs-file "$SCRIPT_DIR/.demoapp-outputs.json" \
  || fail "Demo App CDK deploy failed"

cd "$SCRIPT_DIR"
ok "Demo App stack deployed"

# Grant Demo App ECS/Lambda access to the OpenEMR Aurora database
log "Granting Demo App access to OpenEMR database..."
DEMO_ECS_SG=$(aws cloudformation describe-stack-resources \
  --stack-name DemoAppStack \
  --region "$REGION" \
  --query 'StackResources[?LogicalResourceId==`EcsSecurityGroup44008BF1`].PhysicalResourceId' \
  --output text 2>/dev/null) || true

DB_SG=$(aws rds describe-db-clusters --region "$REGION" \
  --query 'DBClusters[?contains(DBClusterIdentifier,`openemr`)].VpcSecurityGroups[0].VpcSecurityGroupId' \
  --output text 2>/dev/null) || true

if [[ -n "$DEMO_ECS_SG" && "$DEMO_ECS_SG" != "None" && -n "$DB_SG" && "$DB_SG" != "None" ]]; then
  aws ec2 authorize-security-group-ingress \
    --group-id "$DB_SG" --protocol tcp --port 3306 \
    --source-group "$DEMO_ECS_SG" --region "$REGION" 2>/dev/null || true
  ok "DB security group updated: $DB_SG allows $DEMO_ECS_SG on port 3306"
else
  warn "Could not configure DB security group access (DB_SG=$DB_SG, ECS_SG=$DEMO_ECS_SG)"
fi

# Grant Demo App ECS tasks access to the OpenEMR ALB (for FHIR API calls)
OPENEMR_ALB_SG=$(aws elbv2 describe-load-balancers --region "$REGION" \
  --query "LoadBalancers[?contains(LoadBalancerName,'Openem')].SecurityGroups[0]" \
  --output text 2>/dev/null) || true
if [[ -n "$DEMO_ECS_SG" && "$DEMO_ECS_SG" != "None" && -n "$OPENEMR_ALB_SG" && "$OPENEMR_ALB_SG" != "None" ]]; then
  aws ec2 authorize-security-group-ingress \
    --group-id "$OPENEMR_ALB_SG" --protocol tcp --port 443 \
    --source-group "$DEMO_ECS_SG" --region "$REGION" 2>/dev/null || true
  ok "OpenEMR ALB security group updated: $OPENEMR_ALB_SG allows $DEMO_ECS_SG on port 443"
fi

# Add NAT gateway IPs to OpenEMR ALB SG (ECS tasks in private subnets reach the
# internet-facing OpenEMR ALB via NAT gateways, so the SG must allow those IPs)
log "Adding NAT gateway IPs to OpenEMR ALB security group..."
NAT_IPS=$(aws ec2 describe-nat-gateways --region "$REGION" \
  --filter "Name=state,Values=available" \
  --query 'NatGateways[*].NatGatewayAddresses[0].PublicIp' --output text 2>/dev/null) || true
if [[ -n "$NAT_IPS" && -n "$OPENEMR_ALB_SG" && "$OPENEMR_ALB_SG" != "None" ]]; then
  for NAT_IP in $NAT_IPS; do
    aws ec2 authorize-security-group-ingress \
      --group-id "$OPENEMR_ALB_SG" --protocol tcp --port 443 \
      --cidr "${NAT_IP}/32" --region "$REGION" 2>/dev/null || true
  done
  ok "NAT gateway IPs added to OpenEMR ALB SG: $NAT_IPS"
fi

# ─── Step 3: Generate and Upload Synthetic Patient Data ───────────────────────

if [[ "$SKIP_DATA_LOAD" == "false" ]]; then
  echo ""
  echo "───────────────────────────────────────────────────────────────"
  log "Step 3/3: Generating synthetic patient data with Synthea..."
  echo "───────────────────────────────────────────────────────────────"

  # Verify Java is available (required for Synthea)
  command -v java >/dev/null 2>&1 || fail "Java not found. Synthea requires Java 11+. Install with: brew install openjdk@11"

  # Get the S3 output bucket name
  OUTPUT_BUCKET=$(aws cloudformation describe-stacks \
    --stack-name DemoAppStack \
    --region "$REGION" \
    --query 'Stacks[0].Outputs[?OutputKey==`OutputBucketName`].OutputValue' \
    --output text 2>/dev/null) || fail "Could not find output bucket from DemoAppStack"

  [[ -z "$OUTPUT_BUCKET" || "$OUTPUT_BUCKET" == "None" ]] && fail "Output bucket not found in DemoAppStack outputs"

  SYNTHEA_DIR="$SCRIPT_DIR/submodules/synthea"
  SYNTHEA_OUTPUT="$SYNTHEA_DIR/output/fhir"

  # Verify Synthea submodule is present
  if [[ ! -f "$SYNTHEA_DIR/run_synthea" ]]; then
    log "Initializing Synthea submodule..."
    git -C "$SCRIPT_DIR" submodule update --init submodules/synthea || fail "Failed to initialize Synthea submodule"
  fi

  # Generate 100 patients in Massachusetts (seed 12345 for reproducibility)
  if [[ ! -d "$SYNTHEA_OUTPUT" ]] || [[ $(ls "$SYNTHEA_OUTPUT"/*.json 2>/dev/null | wc -l) -lt 10 ]]; then
    log "Running Synthea to generate 100 patients..."
    cd "$SYNTHEA_DIR"
    ./run_synthea -p 100 -s 12345 --exporter.fhir.export=true Massachusetts 2>&1 | tail -5
    cd "$SCRIPT_DIR"
  fi

  [[ ! -d "$SYNTHEA_OUTPUT" ]] && fail "Synthea output directory not found after generation"

  BUNDLE_COUNT=$(ls "$SYNTHEA_OUTPUT"/*.json 2>/dev/null | wc -l)
  [[ "$BUNDLE_COUNT" -lt 1 ]] && fail "Synthea generated 0 bundles"

  log "Uploading $BUNDLE_COUNT Synthea bundles to S3..."
  aws s3 sync "$SYNTHEA_OUTPUT" "s3://$OUTPUT_BUCKET/synthea-bundles/" \
    --region "$REGION" --quiet || fail "Failed to upload Synthea bundles to S3"
  ok "Uploaded $BUNDLE_COUNT patient bundles to s3://$OUTPUT_BUCKET/synthea-bundles/"

  # Invoke the data loader Lambda to parse bundles and load into OpenEMR
  log "Invoking data loader to parse Synthea bundles and load into OpenEMR..."
  DATA_LOADER_FN=$(aws cloudformation describe-stack-resources \
    --stack-name DemoAppStack \
    --region "$REGION" \
    --query 'StackResources[?LogicalResourceId==`DataLoaderFunction1D375D3C`].PhysicalResourceId' \
    --output text 2>/dev/null) || true

  if [[ -n "$DATA_LOADER_FN" && "$DATA_LOADER_FN" != "None" ]]; then
    aws lambda invoke \
      --function-name "$DATA_LOADER_FN" \
      --cli-binary-format raw-in-base64-out \
      --payload "{\"RequestType\":\"Create\",\"ResourceProperties\":{\"ForceReload\":\"true\",\"SyntheaBucket\":\"$OUTPUT_BUCKET\",\"SyntheaPrefix\":\"synthea-bundles/\"},\"ResponseURL\":\"\",\"StackId\":\"manual\",\"RequestId\":\"manual-deploy\",\"LogicalResourceId\":\"DataLoader\"}" \
      --region "$REGION" \
      /tmp/data-loader-output.json 2>&1 | tail -3
    
    LOADER_RESULT=$(cat /tmp/data-loader-output.json 2>/dev/null)
    if echo "$LOADER_RESULT" | python3 -c "import sys,json; d=json.load(sys.stdin); exit(0 if d.get('Message','').startswith('Loaded') else 1)" 2>/dev/null; then
      ok "Data loader completed: $(echo "$LOADER_RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('Message',''))")"
    else
      warn "Data loader returned: $LOADER_RESULT"
    fi
  else
    warn "Could not find data loader Lambda function"
  fi

  # The data loader Lambda registers the OAuth client via direct DB insert
  # and updates the FHIR credentials secret automatically.
  # Just verify it worked by checking the secret was updated.
  log "Verifying OAuth client registration (handled by data loader Lambda)..."
  FHIR_CREDS_SECRET=$(aws cloudformation describe-stacks --stack-name DemoAppStack --region "$REGION" \
    --query 'Stacks[0].Outputs[?OutputKey==`FhirApiCredentialsSecretArn`].OutputValue' --output text 2>/dev/null) || true

  if [[ -n "$FHIR_CREDS_SECRET" && "$FHIR_CREDS_SECRET" != "None" ]]; then
    FHIR_CLIENT_ID=$(aws secretsmanager get-secret-value --secret-id "$FHIR_CREDS_SECRET" --region "$REGION" \
      --query 'SecretString' --output text 2>/dev/null | python3 -c "import sys,json; print(json.load(sys.stdin).get('clientId',''))" 2>/dev/null) || true
    if [[ -n "$FHIR_CLIENT_ID" && "$FHIR_CLIENT_ID" != "demo-app-fhir-client" ]]; then
      ok "OAuth client registered and FHIR credentials secret updated (clientId: ${FHIR_CLIENT_ID:0:20}...)"
    else
      warn "FHIR credentials secret may not have been updated by data loader — check Lambda logs"
    fi
  fi

  log "Restarting Demo App to pick up new credentials..."
  DEMO_CLUSTER=$(aws ecs list-clusters --region "$REGION" \
    --query 'clusterArns[?contains(@,`DemoApp`)]' --output text 2>/dev/null | awk -F/ '{print $NF}')
  DEMO_SERVICE=$(aws ecs list-services --cluster "$DEMO_CLUSTER" --region "$REGION" \
    --query 'serviceArns[0]' --output text 2>/dev/null | awk -F/ '{print $NF}')
  if [[ -n "$DEMO_CLUSTER" && -n "$DEMO_SERVICE" ]]; then
    aws ecs update-service --cluster "$DEMO_CLUSTER" --service "$DEMO_SERVICE" \
      --force-new-deployment --region "$REGION" >/dev/null 2>&1
    ok "Demo App restarting with updated credentials"
  fi

  # Update Route53 record for Demo App to point to the current ALB
  log "Updating Demo App DNS record..."
  DEMO_ALB_DNS=$(aws elbv2 describe-load-balancers --region "$REGION" \
    --query "LoadBalancers[?contains(LoadBalancerName,'DemoAp')].DNSName" \
    --output text 2>/dev/null) || true
  DEMO_ALB_ZONE=$(aws elbv2 describe-load-balancers --region "$REGION" \
    --query "LoadBalancers[?contains(LoadBalancerName,'DemoAp')].CanonicalHostedZoneId" \
    --output text 2>/dev/null) || true

  if [[ -n "$DEMO_ALB_DNS" && "$DEMO_ALB_DNS" != "None" && -n "$HOSTED_ZONE_ID" ]]; then
    aws route53 change-resource-record-sets \
      --hosted-zone-id "$HOSTED_ZONE_ID" \
      --change-batch "{\"Changes\":[{\"Action\":\"UPSERT\",\"ResourceRecordSet\":{\"Name\":\"${DEMO_DOMAIN}\",\"Type\":\"A\",\"AliasTarget\":{\"HostedZoneId\":\"${DEMO_ALB_ZONE}\",\"DNSName\":\"dualstack.${DEMO_ALB_DNS}\",\"EvaluateTargetHealth\":false}}}]}" \
      --region "$REGION" >/dev/null 2>&1
    ok "Demo App DNS updated: ${DEMO_DOMAIN} -> ${DEMO_ALB_DNS}"
  else
    warn "Could not update Demo App DNS record"
  fi
else
  log "Skipping data load (--skip-data-load)"
fi

# ─── Summary ──────────────────────────────────────────────────────────────────

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  Deployment Complete!"
echo "═══════════════════════════════════════════════════════════════"
echo ""

APP_URL="https://${DEMO_DOMAIN}"
OPENEMR_URL="https://${OPENEMR_DOMAIN}"

echo -e "  ${GREEN}Demo App URL:${NC}     $APP_URL"
echo -e "  ${GREEN}OpenEMR URL:${NC}      $OPENEMR_URL"
echo -e "  ${GREEN}Region:${NC}           $REGION"
echo -e "  ${GREEN}Account:${NC}          $AWS_ACCOUNT"
echo -e "  ${GREEN}Certificate:${NC}      $CERT_ARN"
echo ""
echo "  Estimated cost: ~\$0.50-0.65/hr while running"
echo ""
echo "  To destroy all resources:"
echo "    ./destroy.sh --domain $DOMAIN --region $REGION"
echo ""
echo "═══════════════════════════════════════════════════════════════"

# Clean up temp output files
rm -f "$SCRIPT_DIR/.openemr-outputs.json" "$SCRIPT_DIR/.demoapp-outputs.json"
