import json
import os
import re
import time
import boto3
from botocore.config import Config

INGEST_BUCKET = os.environ["INGEST_BUCKET"]

# Force SigV4 and pin region (good)
s3 = boto3.client("s3", config=Config(signature_version="s3v4", region_name="us-east-1"))

def _headers():
    return {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Cache-Control": "no-store",
    }

def _clean_display(s: str) -> str:
    """Preserve casing, just normalize whitespace + strip weird chars."""
    s = (s or "").strip()
    s = re.sub(r"\s+", " ", s)
    # keep letters/numbers/space/_/./- (preserve casing)
    s = re.sub(r"[^a-zA-Z0-9 _.\-]", "", s)
    return s

def _slug_key(s: str) -> str:
    """
    For S3 folder keys only.
    We DO lowercase here to keep foldering stable/consistent.
    """
    s = _clean_display(s).lower()
    s = s.replace(" ", "_")
    s = re.sub(r"_+", "_", s).strip("_")
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

    # Display/original values (preserve casing)
    title = _clean_display(body.get("title"))
    artist = _clean_display(body.get("artist"))
    album = _clean_display(body.get("album"))
    track_number = body.get("track_number")
    release_year = body.get("release_year")

    audio_filename = _clean_display(body.get("audio_filename"))
    audio_content_type = (body.get("audio_content_type") or "application/pythoctet-stream").strip()

    art_filename = _clean_display(body.get("art_filename") or "")
    art_content_type = (body.get("art_content_type") or "application/octet-stream").strip()

    if not (title and artist and album and audio_filename):
        return {
            "statusCode": 400,
            "headers": _headers(),
            "body": json.dumps({"error": "Missing required fields: title, artist, album, audio_filename"})
        }

    # Foldering keys (slugged) — stable S3 layout
    ts = int(time.time())
    artist_key = _slug_key(artist)
    album_key = _slug_key(album)

    # Put uploads under raw/<artist_key>/<album_key>/
    audio_key = f"raw/{artist_key}/{album_key}/{ts}__{audio_filename}"
    art_key = f"raw/{artist_key}/{album_key}/{ts}__{art_filename}" if art_filename else None
    meta_key = f"raw/{artist_key}/{album_key}/{ts}__meta.json"

    # Presign PUT URLs (IMPORTANT: If you include ContentType here, browser MUST send exact header)
    audio_put_url = s3.generate_presigned_url(
        ClientMethod="put_object",
        Params={"Bucket": INGEST_BUCKET, "Key": audio_key},
        ExpiresIn=900,
        HttpMethod="PUT",
    )

    art_put_url = None
    if art_key:
        art_put_url = s3.generate_presigned_url(
            ClientMethod="put_object",
            Params={"Bucket": INGEST_BUCKET, "Key": art_key},
            ExpiresIn=900,
            HttpMethod="PUT",
        )

    # Meta JSON: this is where we preserve exact casing + full form fields
    meta_put_url = s3.generate_presigned_url(
        ClientMethod="put_object",
        Params={"Bucket": INGEST_BUCKET, "Key": meta_key, "ContentType": "application/json"},
        ExpiresIn=900,
        HttpMethod="PUT",
    )

    return {
        "statusCode": 200,
        "headers": _headers(),
        "body": json.dumps({
            "audio_key": audio_key,
            "audio_put_url": audio_put_url,
            "audio_content_type": audio_content_type,

            "art_key": art_key,
            "art_put_url": art_put_url,
            "art_content_type": art_content_type,

            "meta_key": meta_key,
            "meta_put_url": meta_put_url,

            # Echo back preserved-casing fields for debugging
            "meta_fields": {
                "title": title,
                "artist": artist,
                "album": album,
                "track_number": track_number,
                "release_year": release_year,
            }
        }),
    }
