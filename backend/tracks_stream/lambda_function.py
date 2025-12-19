import os
import json
import boto3

dynamodb = boto3.resource("dynamodb")

TRACKS_TABLE = os.environ["TRACKS_TABLE"]
AUDIO_CLOUDFRONT_DOMAIN = os.environ["AUDIO_CLOUDFRONT_DOMAIN"]  # domain only, no https://

table = dynamodb.Table(TRACKS_TABLE)

def _headers():
    return {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Cache-Control": "no-store",
    }

def lambda_handler(event, context):
    if event.get("requestContext", {}).get("http", {}).get("method") == "OPTIONS" or event.get("httpMethod") == "OPTIONS":
        return {"statusCode": 204, "headers": _headers(), "body": ""}

    path_params = event.get("pathParameters") or {}
    track_id = path_params.get("track_id") or path_params.get("id")
    if not track_id:
        return {"statusCode": 400, "headers": _headers(), "body": json.dumps({"error": "Missing track_id"})}

    resp = table.get_item(Key={"track_id": track_id})
    item = resp.get("Item")
    if not item:
        return {"statusCode": 404, "headers": _headers(), "body": json.dumps({"error": "Track not found"})}

    stream_path = item.get("stream_path")  # e.g. tracks/Wires.mp3
    if not stream_path:
        return {"statusCode": 500, "headers": _headers(), "body": json.dumps({"error": "Track missing stream_path"})}

    url = f"https://{AUDIO_CLOUDFRONT_DOMAIN}/{stream_path.lstrip('/')}"

    return {
        "statusCode": 200,
        "headers": _headers(),
        "body": json.dumps({"track_id": track_id, "stream_url": url}),
    }
