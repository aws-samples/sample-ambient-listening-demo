"""
Self-signed certificate generator (CloudFormation custom resource).

Generates a self-signed X.509 certificate + RSA key entirely inside Lambda (no
local openssl on the operator's machine), imports it into ACM, and returns the
imported certificate ARN. On stack delete it deletes the imported certificate
once it is no longer in use.

This exists so the `--self-signed` deployment mode has ZERO local tooling
dependency: the operator no longer needs openssl installed, and no private key
material ever touches the operator's machine — it is generated in-cloud and the
key never leaves the Lambda.

Inputs (ResourceProperties):
  CommonName   - CN for the cert (e.g. "*.ambient-demo.local")
  SubjectAltNames - comma-separated DNS SANs
  Region       - AWS region for ACM import

Output (Data):
  CertificateArn - the imported ACM certificate ARN
"""

import os
import datetime

import boto3
from cryptography import x509
from cryptography.x509.oid import NameOID
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa


def _generate_self_signed(common_name, sans):
    """Generate an RSA key + self-signed cert. Returns (cert_pem, key_pem) bytes."""
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)

    subject = issuer = x509.Name([
        x509.NameAttribute(NameOID.COMMON_NAME, common_name),
        x509.NameAttribute(NameOID.ORGANIZATION_NAME, "AmbientDemo"),
        x509.NameAttribute(NameOID.COUNTRY_NAME, "US"),
    ])

    san_entries = [x509.DNSName(s) for s in sans if s]
    now = datetime.datetime.utcnow()

    builder = (
        x509.CertificateBuilder()
        .subject_name(subject)
        .issuer_name(issuer)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - datetime.timedelta(minutes=5))
        .not_valid_after(now + datetime.timedelta(days=365))
        .add_extension(x509.BasicConstraints(ca=True, path_length=None), critical=True)
    )
    if san_entries:
        builder = builder.add_extension(x509.SubjectAlternativeName(san_entries), critical=False)

    cert = builder.sign(private_key=key, algorithm=hashes.SHA256())

    cert_pem = cert.public_bytes(serialization.Encoding.PEM)
    key_pem = key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.TraditionalOpenSSL,
        encryption_algorithm=serialization.NoEncryption(),
    )
    return cert_pem, key_pem


def handler(event, context):
    """CDK custom-resource Provider onEvent handler.

    The CDK `Provider` framework sends the CloudFormation response itself, so this
    handler must simply RETURN a dict of the form
    {"PhysicalResourceId": ..., "Data": {...}} (or raise on failure). It must NOT
    POST to event["ResponseURL"] — doing so conflicts with the framework and
    results in "Vendor response doesn't contain <attr>" errors.
    """
    region = os.environ.get("AWS_REGION", "us-east-1")
    acm = boto3.client("acm", region_name=region)
    props = event.get("ResourceProperties", {})
    request_type = event.get("RequestType", "Create")
    print(f"Cert generator: {request_type}")

    if request_type == "Delete":
        # Best-effort: delete the imported cert if it is no longer in use.
        arn = event.get("PhysicalResourceId", "")
        if arn.startswith("arn:aws:acm:"):
            try:
                in_use = acm.describe_certificate(CertificateArn=arn)["Certificate"].get("InUseBy", [])
                if not in_use:
                    acm.delete_certificate(CertificateArn=arn)
                    print(f"Deleted certificate {arn}")
                else:
                    print(f"Certificate still in use, not deleting: {in_use}")
            except Exception as e:  # noqa: BLE001
                print(f"Delete cleanup skipped: {e}")
        return {"PhysicalResourceId": event.get("PhysicalResourceId", "cert-generator")}

    # Create / Update: generate a fresh self-signed cert and import to ACM.
    common_name = props.get("CommonName", "*.ambient-demo.local")
    sans = [s.strip() for s in props.get("SubjectAltNames", "").split(",") if s.strip()]
    if common_name not in sans:
        sans.insert(0, common_name)

    cert_pem, key_pem = _generate_self_signed(common_name, sans)

    resp = acm.import_certificate(
        Certificate=cert_pem,
        PrivateKey=key_pem,
        Tags=[{"Key": "Purpose", "Value": "ambient-demo-self-signed"}],
    )
    arn = resp["CertificateArn"]
    print(f"Imported self-signed certificate: {arn}")
    # Use the ACM ARN as the PhysicalResourceId so replacement/delete targets it.
    return {"PhysicalResourceId": arn, "Data": {"CertificateArn": arn}}
