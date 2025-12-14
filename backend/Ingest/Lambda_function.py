import json
import os
import uuid
import boto3

dynamodb = boto3.resource("dynamodb")
s3 = boto3.client("s3")

TRACKS_TABLE = os.environ["TRACKS_TABLE"]
AUDIO_BUCKET = os.environ["AUDIO_BUCKET"]

table = dynamodb.Table(TRACKS_TABLE)


def lambda_handler(event, context):
    """
    Triggered by S3 ObjectCreated events on the raw uploads bucket.
    For each new object:
      - Copy it to the audio bucket under tracks/<filename>
      - Insert a DynamoDB item with track_id, title, and stream_path
    """

    print("Received event:", json.dumps(event))

    for record in event.get("Records", []):
        event_name = record.get("eventName", "")
        if not event_name.startswith("ObjectCreated:"):
            continue

        src_bucket = record["s3"]["bucket"]["name"]
        src_key = record["s3"]["object"]["key"]

        # Only process audio files (basic check)
        lower_key = src_key.lower()
        if not (lower_key.endswith(".mp3") or lower_key.endswith(".flac")):
            print(f"Skipping non-audio file: {src_key}")
            continue

        # Use filename as title (without extension)
        filename = src_key.split("/")[-1]
        title = filename.rsplit(".", 1)[0]

        # Generate a track_id
        track_id = f"trk_{uuid.uuid4().hex[:8]}"

        # Destination key in audio bucket
        dest_key = f"tracks/{filename}"

        print(f"Copying from s3://{src_bucket}/{src_key} to s3://{AUDIO_BUCKET}/{dest_key}")

        # Copy object to audio bucket
        copy_source = {"Bucket": src_bucket, "Key": src_key}

        s3.copy_object(
            CopySource=copy_source,
            Bucket=AUDIO_BUCKET,
            Key=dest_key,
        )

        # Insert into DynamoDB
        item = {
            "track_id": track_id,
            "title": title,
            "stream_path": dest_key,  # e.g. "tracks/your_song.mp3"
        }

        print(f"Putting item into DynamoDB: {item}")
        table.put_item(Item=item)

    return {"statusCode": 200, "body": json.dumps({"message": "Ingest complete"})}
