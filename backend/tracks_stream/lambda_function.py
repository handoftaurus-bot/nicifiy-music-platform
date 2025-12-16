import os
import json
from datetime import datetime, timedelta, timezone

import boto3
from botocore.signers import CloudFrontSigner
import rsa  # <-- pure python, no glibc problems

dynamodb = boto3.resource("dynamodb")
secrets = boto3.client("secretsmanager")

TRACKS_TABLE = os.environ["TRACKS_TABLE"]
AUDIO_CLOUDFRONT_DOMAIN = os.environ["AUDIO_CLOUDFRONT_DOMAIN"]  # domain only (no https://, no trailing /)
CF_KEY_PAIR_ID = os.environ["CF_KEY_PAIR_ID"]
CF_PRIVATE_KEY_SECRET_ARN = os.environ["CF_PRIVATE_KEY_SECRET_ARN"]

table = dynamodb.Table(TRACKS_TABLE)

_cached_private_key = None

def _get_private_key():
    global _cached_private_key
    if _cached_private_key is not None:
        return _cached_private_key

    resp = secrets.get_secret_value(SecretId=CF_PRIVATE_KEY_SECRET_ARN)
    secret_str = resp.get("SecretString") or ""
    secret_json = json.loads(secret_str)

    pem_str = secret_json["private_key_pem"]
    pem_bytes = pem_str.encode("utf-8")

    # rsa expects PKCS#1 PEM for private key
    _cached_private_key = rsa.PrivateKey.load_pkcs1(pem_bytes)
    return _cached_private_key

def _rsa_signer(message: bytes) -> bytes:
    private_key = _get_private_key()
    # CloudFront signed URLs use RSA with SHA1
    return rsa.sign(message, private_key, "SHA-1")

def lambda_handler(event, context):
    path_params = event.get("pathParameters") or {}
    track_id = path_params.get("track_id") or path_params.get("id")
    if not track_id:
        return {"statusCode": 400, "body": json.dumps({"error": "Missing track_id"})}

    resp = table.get_item(Key={"track_id": track_id})
    item = resp.get("Item")
    if not item:
        return {"statusCode": 404, "body": json.dumps({"error": "Track not found"})}

    stream_path = item["stream_path"]  # e.g. tracks/Dream_Weaver.mp3
    url = f"https://{AUDIO_CLOUDFRONT_DOMAIN}/{stream_path}"

    expire_at = datetime.now(timezone.utc) + timedelta(seconds=60)
    signer = CloudFrontSigner(CF_KEY_PAIR_ID, _rsa_signer)
    signed_url = signer.generate_presigned_url(url, date_less_than=expire_at)

    return {
        "statusCode": 200,
        "headers": {"Content-Type": "application/json"},
        "body": json.dumps({"track_id": track_id, "stream_url": signed_url}),
    }
