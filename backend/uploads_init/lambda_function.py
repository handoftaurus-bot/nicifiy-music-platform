import json
import os
import re
import time
import boto3
from botocore.config import Config

INGEST_BUCKET = os.environ["INGEST_BUCKET"]

# Force SigV4 (critical) and pin region
s3 = boto3.client("s3", config=Config(signature_version="s3v4", region_name="us-east-1"))

def _headers():
    return {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Cache-Control": "no-store",
    }

def _safe(s: str) -> str:
    s = (s or "").strip()
    s = re.sub(r"\s+", " ", s)
    s = re.sub(r"[^a-zA-Z0-9 _.\-]", "", s)
    return s

def _slug(s: str) -> str:
    s = _safe(s).lower().replace(" ", "_")
    return s or "unknown"

def lambda_handler(event, context):
    method = (
        event.get("requestContext", {}).get("http", {}).get("method")
        or event.get("httpMethod")
        or ""
    ).upper()

    if method == "OPTIONS":
        return {"statusCode": 204, "headers": _headers(), "body": ""}

    body = event.get("body") or "{}"
    if isinstance(body, str):
        body = json.loads(body)

    title = _safe(body.get("title"))
    artist = _safe(body.get("artist"))
    album = _safe(body.get("album"))

    audio_filename = _safe(body.get("audio_filename"))
    audio_content_type = (body.get("audio_content_type") or "application/octet-stream").strip()

    art_filename = _safe(body.get("art_filename") or "")
    art_content_type = (body.get("art_content_type") or "application/octet-stream").strip()

    if not (title and artist and album and audio_filename):
        return {"statusCode": 400, "headers": _headers(), "body": json.dumps({"error": "Missing required fields"})}

    # Foldering: raw/<artist>/<album>/<timestamp>__<filename>
    ts = int(time.time())
    artist_key = _slug(artist)
    album_key = _slug(album)

    audio_key = f"raw/{artist_key}/{album_key}/{ts}__{audio_filename}"

    audio_put_url = s3.generate_presigned_url(
        ClientMethod="put_object",
        Params={
            "Bucket": INGEST_BUCKET,
            "Key": audio_key,
            # You can include ContentType if you want strict matching;
            # if you include it, the browser must send the exact same header.
            # "ContentType": audio_content_type,
        },
        ExpiresIn=900,
        HttpMethod="PUT",
    )

    art_put_url = None
    art_key = None
    if art_filename:
        art_key = f"raw/{artist_key}/{album_key}/{ts}__{art_filename}"
        art_put_url = s3.generate_presigned_url(
            ClientMethod="put_object",
            Params={"Bucket": INGEST_BUCKET, "Key": art_key},
            ExpiresIn=900,
            HttpMethod="PUT",
        )

    return {
        "statusCode": 200,
        "headers": _headers(),
        "body": json.dumps({
            "audio_put_url": audio_put_url,
            "audio_key": audio_key,
            "art_put_url": art_put_url,
            "art_key": art_key,
        }),
    }
