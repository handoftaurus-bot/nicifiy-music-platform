import json
import os
import boto3
from decimal import Decimal

dynamodb = boto3.resource("dynamodb")

TRACKS_TABLE = os.environ["TRACKS_TABLE"]
AUDIO_CLOUDFRONT_DOMAIN = os.environ.get("AUDIO_CLOUDFRONT_DOMAIN", "").replace("https://", "").strip("/")

table = dynamodb.Table(TRACKS_TABLE)


def _headers():
    return {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",  # tighten later to your site domain
        "Access-Control-Allow-Methods": "GET,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Cache-Control": "no-store",
    }


def _json_default(o):
    # DynamoDB numbers come back as Decimal; convert for JSON
    if isinstance(o, Decimal):
        return int(o) if o % 1 == 0 else float(o)
    raise TypeError(f"Object of type {type(o).__name__} is not JSON serializable")


def _cf_url(path: str | None) -> str | None:
    if not path or not AUDIO_CLOUDFRONT_DOMAIN:
        return None
    return f"https://{AUDIO_CLOUDFRONT_DOMAIN}/{path.lstrip('/')}"


def _to_track(item: dict) -> dict:
    track_id = item.get("track_id")
    stream_path = item.get("stream_path") or item.get("stream_key")

    return {
        "track_id": track_id,
        "id": track_id,  # alias
        "title": item.get("title") or item.get("song_title") or item.get("name"),
        "artist": item.get("artist"),
        "album": item.get("album"),
        "track_number": item.get("track_number"),
        "release_year": item.get("release_year"),
        "duration": item.get("duration"),
        "stream_path": stream_path,
        "stream_url": _cf_url(stream_path),
        "art_path": item.get("art_path"),
        "art_url": _cf_url(item.get("art_path")),
        "status": item.get("status"),
    }


def lambda_handler(event, context):
    # HTTP API v2 preflight support
    method = (
        event.get("requestContext", {}).get("http", {}).get("method")
        or event.get("httpMethod")
        or ""
    ).upper()

    if method == "OPTIONS":
        return {"statusCode": 204, "headers": _headers(), "body": ""}

    try:
        # Scan with pagination (won't silently truncate at 1MB)
        items = []
        scan_kwargs = {}
        while True:
            resp = table.scan(**scan_kwargs)
            items.extend(resp.get("Items", []))
            lek = resp.get("LastEvaluatedKey")
            if not lek:
                break
            scan_kwargs["ExclusiveStartKey"] = lek

    except Exception as e:
        print("tracks_api scan error:", repr(e))
        return {
            "statusCode": 500,
            "headers": _headers(),
            "body": json.dumps({"error": "Failed to scan tracks table", "detail": str(e)}),
        }

    tracks = [_to_track(i) for i in items]

    # Filter out broken rows so UI doesn't choke
    tracks = [t for t in tracks if t.get("track_id") and t.get("stream_url")]

    # Optional: stable sort for UI
    def sort_key(t):
        artist = (t.get("artist") or "").lower()
        album = (t.get("album") or "").lower()
        tn = t.get("track_number")
        try:
            tn_val = int(tn) if tn is not None else 10**9
        except Exception:
            tn_val = 10**9
        title = (t.get("title") or "").lower()
        return (artist, album, tn_val, title)

    tracks.sort(key=sort_key)

    return {
        "statusCode": 200,
        "headers": _headers(),
        # returns an array (as your frontend expects)
        "body": json.dumps(tracks, default=_json_default),
    }
