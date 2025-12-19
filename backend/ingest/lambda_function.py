import json
import os
import uuid
import boto3
import re
import subprocess
from urllib.parse import unquote_plus

dynamodb = boto3.resource("dynamodb")
s3 = boto3.client("s3")

TRACKS_TABLE = os.environ["TRACKS_TABLE"]
AUDIO_BUCKET = os.environ["AUDIO_BUCKET"]

table = dynamodb.Table(TRACKS_TABLE)

SUPPORTED_EXTS = (".mp3", ".flac", ".wav", ".mp4", ".m4a", ".aac", ".ogg")


def normalize_filename(filename: str) -> str:
    name = filename.replace(" ", "_")
    name = re.sub(r"[^a-zA-Z0-9_.-]", "", name)
    return name


def title_from_filename(filename: str) -> str:
    base = filename.rsplit("/", 1)[-1]
    base = base.rsplit(".", 1)[0]

    # remove timestamp prefix like 1766098177__Title
    base = re.sub(r"^\d{9,12}__", "", base)

    # prettify
    base = base.replace("_", " ").strip()
    return base or "Untitled"


def parse_artist_album_from_key(src_key: str):
    """
    Expected: raw/<artist>/<album>/<file>
    Returns (artist, album) or (None, None) if not present.
    """
    parts = src_key.split("/")
    if len(parts) >= 4 and parts[0] == "raw":
        artist = parts[1].replace("_", " ").strip()
        album = parts[2].replace("_", " ").strip()
        return artist or None, album or None
    return None, None


def lambda_handler(event, context):
    print("Received event:", json.dumps(event))

    for record in event.get("Records", []):
        event_name = record.get("eventName", "")
        if not event_name.startswith("ObjectCreated:"):
            continue

        src_bucket = record["s3"]["bucket"]["name"]
        raw_key = record["s3"]["object"]["key"]
        src_key = unquote_plus(raw_key)

        lower_key = src_key.lower()
        if not lower_key.endswith(SUPPORTED_EXTS):
            print(f"Skipping unsupported file: {src_key}")
            continue

        # Derive metadata from key
        artist, album = parse_artist_album_from_key(src_key)

        original_filename = src_key.split("/")[-1]
        normalized_filename = normalize_filename(original_filename)

        title = title_from_filename(original_filename)

        track_id = f"trk_{uuid.uuid4().hex[:8]}"

        # Decide output key in AUDIO bucket
        # Keep things organized: tracks/<artist>/<album>/<filename>.mp3
        artist_slug = (artist or "unknown_artist").lower().replace(" ", "_")
        album_slug = (album or "unknown_album").lower().replace(" ", "_")

        # Convert everything to MP3 in the audio bucket
        # If input is already mp3, copy; otherwise transcode via ffmpeg layer
        if lower_key.endswith(".mp3"):
            dest_key = f"tracks/{artist_slug}/{album_slug}/{normalized_filename}"

            print("Copying MP3 to audio bucket:")
            print(f"  s3://{src_bucket}/{src_key} -> s3://{AUDIO_BUCKET}/{dest_key}")

            s3.copy_object(
                CopySource={"Bucket": src_bucket, "Key": src_key},
                Bucket=AUDIO_BUCKET,
                Key=dest_key,
                ContentType="audio/mpeg"
            )
            stream_path = dest_key
            source_format = "mp3"

        else:
            # Transcode to mp3
            base_no_ext = normalized_filename.rsplit(".", 1)[0]
            mp3_name = f"{base_no_ext}.mp3"

            local_in = f"/tmp/{normalized_filename}"
            local_mp3 = f"/tmp/{mp3_name}"

            dest_key = f"tracks/{artist_slug}/{album_slug}/{mp3_name}"

            print(f"Downloading source: s3://{src_bucket}/{src_key} -> {local_in}")
            s3.download_file(src_bucket, src_key, local_in)

            print("Running ffmpeg transcoding to MP3...")
            subprocess.run(
                [
                    "/opt/bin/ffmpeg",
                    "-y",
                    "-i", local_in,
                    "-vn",
                    "-codec:a", "libmp3lame",
                    "-b:a", "192k",
                    local_mp3
                ],
                check=True
            )

            print(f"Uploading MP3: {local_mp3} -> s3://{AUDIO_BUCKET}/{dest_key}")
            s3.upload_file(
                local_mp3,
                AUDIO_BUCKET,
                dest_key,
                ExtraArgs={"ContentType": "audio/mpeg"}
            )

            stream_path = dest_key
            source_format = normalized_filename.rsplit(".", 1)[-1].lower()

        item = {
            "track_id": track_id,
            "title": title,
            "artist": artist or "Unknown Artist",
            "album": album or "Unknown Album",
            "stream_path": stream_path,
            "source_format": source_format
        }

        print("Writing DynamoDB item:", item)
        table.put_item(Item=item)

    return {
        "statusCode": 200,
        "body": json.dumps({"message": "Ingest complete"})
    }
