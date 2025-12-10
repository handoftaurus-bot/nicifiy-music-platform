import json
import os
import boto3

dynamodb = boto3.resource("dynamodb")
table = dynamodb.Table(os.environ["TRACKS_TABLE"])

def lambda_handler(event, context):
    # Simple handler to return all tracks.
    # Later you can filter/paginate, but for demo this is enough.
    try:
        resp = table.scan()
        items = resp.get("Items", [])
    except Exception as e:
        # Basic error handling for now
        return {
            "statusCode": 500,
            "headers": {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*",
            },
            "body": json.dumps({"error": str(e)})
        }

    return {
        "statusCode": 200,
        "headers": {
            "Content-Type": "application/json",
            # Allow frontend (on CloudFront domain) to call this
            "Access-Control-Allow-Origin": "*",
        },
        "body": json.dumps({"tracks": items})
    }
