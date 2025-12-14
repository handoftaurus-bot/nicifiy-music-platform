import json
import os
import uuid
import boto3
import re
import subprocess
from urllib.parse import unquote_plus

# AWS clients
dynamodb = boto3.resource("dynamodb")
s3 = boto3.client("s3")

# Environment variables
TRACKS_TABLE = os.environ["TRACKS_TABLE"]
AUDIO_BUCKET = os.environ["AUDIO_BUCKET"]

table = dynamodb.Table(TRACKS_TABLE)


def normalize_filename(filename: str) -> str:
    """
    Normalize filenames for safe S3 keys:
    - Decode URL encoding (handled before calling)
    - Replace spaces with underscores
    - Remove unsafe characters
    """
    name = filename.replace(" ", "_")
    name = re.sub(r"[^a-zA-Z0-9_.-]", "", name)
    return name


def lambda_handler(event, context):
    print("Received event:", json.dumps(event))

    for record in event.get("Records", []):
        event_name = record.get("eventName", "")
        if not event_name.startswith("ObjectCreated:"):
            continue

        # 🔑 Decode the S3 object key properly
        src_bucket = record["s3"]["bucket"]["name"]
        raw_key = record["s3"]["object"]["key"]
        src_key = unquote_plus(raw_key)

        lower_key = src_key.lower()
        if not (lower_key.endswith(".mp3") or lower_key.endswith(".flac")):
            print(f"Skipping non-audio file: {src_key}")
            continue

        # Extract filename and normalize
        original_filename = src_key.split("/")[-1]
        normalized_filename = normalize_filename(original_filename)

        # Title for display (convert underscores back to spaces)
        title = normalized_filename.rsplit(".", 1)[0].replace("_", " ")

        track_id = f"trk_{uuid.uuid4().hex[:8]}"

        # -----------------------------
        # MP3 uploads (direct copy)
        # -----------------------------
        if lower_key.endswith(".mp3"):
            dest_key = f"tracks/{normalized_filename}"

            print(f"Copying MP3 to audio bucket:")
            print(f"  s3://{src_bucket}/{src_key} -> s3://{AUDIO_BUCKET}/{dest_key}")
            print(f"Object size: {record['s3']['object']['size']} bytes")

            s3.copy_object(
                CopySource={"Bucket": src_bucket, "Key": src_key},
                Bucket=AUDIO_BUCKET,
                Key=dest_key,
                ContentType="audio/mpeg"
            )

            stream_path = dest_key
            source_format = "mp3"

        # -----------------------------
        # FLAC uploads (transcode)
        # -----------------------------
        else:
            flac_name = normalized_filename
            mp3_name = normalized_filename[:-5] + ".mp3"  # replace .flac

            local_flac = f"/tmp/{flac_name}"
            local_mp3 = f"/tmp/{mp3_name}"

            dest_key = f"tracks/{mp3_name}"

            print("Download complete. Starting ffmpeg...")
            print(f"Downloading FLAC:")
            print(f"  s3://{src_bucket}/{src_key} -> {local_flac}")

            s3.download_file(src_bucket, src_key, local_flac)

            print("Running ffmpeg transcoding...")
            subprocess.run(
                [
                    "/opt/bin/ffmpeg",
                    "-y",
                    "-i", local_flac,
                    "-codec:a", "libmp3lame",
                    "-b:a", "192k",
                    local_mp3
                ],
                check=True
            )

            print("ffmpeg complete. Uploading MP3...")
            print(f"Uploading MP3 to audio bucket:")
            print(f"  {local_mp3} -> s3://{AUDIO_BUCKET}/{dest_key}")

            s3.upload_file(
                local_mp3,
                AUDIO_BUCKET,
                dest_key,
                ExtraArgs={"ContentType": "audio/mpeg"}
            )

            stream_path = dest_key
            source_format = "flac"

        # -----------------------------
        # Write to DynamoDB
        # -----------------------------
        item = {
            "track_id": track_id,
            "title": title,
            "stream_path": stream_path,
            "source_format": source_format
        }

        print("Writing DynamoDB item:", item)
        table.put_item(Item=item)

    return {
        "statusCode": 200,
        "body": json.dumps({"message": "Ingest complete"})
    }
