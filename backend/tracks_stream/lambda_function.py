import json
import os
import boto3
from boto3.dynamodb.conditions import Key

dynamodb = boto3.resource("dynamodb")
table = dynamodb.Table(os.environ["TRACKS_TABLE"])
AUDIO_BASE_URL = os.environ["AUDIO_BASE_URL"]  # e.g. https://d456...cloudfront.net

def lambda_handler(event, context):
    """
    HTTP API Lambda that returns a streaming URL for a given track_id.

    Route: GET /tracks/{track_id}/stream
    Path param: track_id
    Response: { "stream_url": "https://...cloudfront.net/tracks/song.mp3" }
    """
    try:
        # HTTP API (v2.0) puts path params here:
        path_params = event.get("pathParameters") or {}
        track_id = path_params.get("track_id")

        if not track_id:
            return _response(400, {"error": "Missing track_id in path"})

        # Lookup the track in DynamoDB
        resp = table.get_item(Key={"track_id": track_id})
        item = resp.get("Item")

        if not item:
            return _response(404, {"error": f"Track '{track_id}' not found"})

        # Expecting attribute 'stream_path', e.g. "tracks/Wires.flac"
        stream_path = item.get("stream_path")
        if not stream_path:
            return _response(500, {"error": "Track is missing 'stream_path' field"})

        # Build full URL using audio CloudFront base URL
        # Ensure no double slashes
        stream_url = f"{AUDIO_BASE_URL.rstrip('/')}/{stream_path.lstrip('/')}"

        return _response(200, {"stream_url": stream_url})

    except Exception as e:
        return _response(500, {"error": str(e)})


def _response(status_code, body_dict):
    return {
        "statusCode": status_code,
        "headers": {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
        },
        "body": json.dumps(body_dict),
    }
