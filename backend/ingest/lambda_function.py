import json
import os
import uuid
import boto3
import re
import subprocess
import time
from urllib.parse import unquote_plus
from botocore.exceptions import ClientError

dynamodb = boto3.resource("dynamodb")
s3 = boto3.client("s3")

TRACKS_TABLE = os.environ["TRACKS_TABLE"]
AUDIO_BUCKET = os.environ["AUDIO_BUCKET"]

table = dynamodb.Table(TRACKS_TABLE)

SUPPORTED_AUDIO_EXTS = (".mp3", ".flac", ".wav", ".mp4", ".m4a", ".aac", ".ogg")
SUPPORTED_ART_EXTS = (".jpg", ".jpeg", ".png", ".webp")  # raw can include png; audio will be jpg


def normalize_filename(filename: str) -> str:
    name = (filename or "").replace(" ", "_")
    name = re.sub(r"[^a-zA-Z0-9_.-]", "", name)
    return name


def title_from_filename(filename: str) -> str:
    base = filename.rsplit("/", 1)[-1]
    base = base.rsplit(".", 1)[0]
    base = re.sub(r"^\d{9,12}__", "", base)  # strip ts prefix
    base = base.replace("_", " ").strip()
    return base or "Untitled"


def parse_artist_album_from_key(src_key: str):
    # raw/<artist_slug>/<album_slug>/<file>
    parts = (src_key or "").split("/")
    if len(parts) >= 4 and parts[0] == "raw":
        artist_slug = parts[1]
        album_slug = parts[2]
        return artist_slug, album_slug
    return None, None


def extract_ts_prefix(filename: str):
    m = re.match(r"^(\d{9,12})__", filename or "")
    return m.group(1) if m else None


def try_load_meta(src_bucket: str, folder_prefix: str, ts: str):
    """
    Attempts to read raw/<artist>/<album>/<ts>__meta.json
    Returns (meta_dict_or_none, meta_key)
    """
    meta_key = f"{folder_prefix}/{ts}__meta.json"
    try:
        obj = s3.get_object(Bucket=src_bucket, Key=meta_key)
        raw = obj["Body"].read().decode("utf-8")
        return json.loads(raw), meta_key
    except ClientError as e:
        code = e.response.get("Error", {}).get("Code", "")
        if code in ("NoSuchKey", "404"):
            return None, meta_key
        raise


def load_meta_with_retries(src_bucket: str, folder_prefix: str, ts: str, tries=6, delay=0.4):
    """
    S3 events can arrive out of order (audio object created before meta.json).
    This retries briefly to find meta before proceeding.
    """
    meta = None
    meta_key = f"{folder_prefix}/{ts}__meta.json"
    for i in range(tries):
        meta, meta_key = try_load_meta(src_bucket, folder_prefix, ts)
        if isinstance(meta, dict):
            return meta, meta_key
        time.sleep(delay)
    return None, meta_key


def slug_for_audio_path(display: str, fallback: str) -> str:
    """
    For AUDIO bucket object keys only. Stable + safe.
    """
    s = (display or "").strip().lower().replace(" ", "_")
    s = re.sub(r"[^a-z0-9_.-]", "", s)
    return s or (fallback or "unknown")


def _is_image_key(key: str) -> bool:
    lk = (key or "").lower()
    return lk.endswith(SUPPORTED_ART_EXTS)


def _head_exists(bucket: str, key: str) -> bool:
    try:
        s3.head_object(Bucket=bucket, Key=key)
        return True
    except ClientError as e:
        code = e.response.get("Error", {}).get("Code", "")
        if code in ("404", "NoSuchKey", "NotFound"):
            return False
        # If permission issue, raise so you see it
        raise


def _copy_image_to_audio_as_jpg(src_bucket: str, src_key: str, dest_bucket: str, dest_key: str):
    """
    Copies raw image to audio bucket as a normalized JPG.
    - If src is already JPG/JPEG: do a direct copy_object to dest_key (cover.jpg)
    - If src is PNG/WEBP: download -> ffmpeg convert -> upload as JPG
    """
    lower = (src_key or "").lower()

    # Direct copy for jpg/jpeg
    if lower.endswith(".jpg") or lower.endswith(".jpeg"):
        # Copy + force ContentType
        s3.copy_object(
            CopySource={"Bucket": src_bucket, "Key": src_key},
            Bucket=dest_bucket,
            Key=dest_key,
            ContentType="image/jpeg",
            MetadataDirective="REPLACE",
        )
        return

    # Otherwise transcode with ffmpeg to jpg
    # Download raw
    src_name = normalize_filename(src_key.split("/")[-1])
    local_in = f"/tmp/{src_name}"
    local_out = f"/tmp/cover.jpg"

    s3.download_file(src_bucket, src_key, local_in)

    # ffmpeg image convert
    # -q:v controls jpeg quality (2 is high). scale keeps within 3000x3000 defensively.
    subprocess.run(
        [
            "/opt/bin/ffmpeg",
            "-y",
            "-i", local_in,
            "-vf", "scale='min(3000,iw)':'min(3000,ih)':force_original_aspect_ratio=decrease",
            "-q:v", "2",
            local_out
        ],
        check=True
    )

    s3.upload_file(
        local_out,
        dest_bucket,
        dest_key,
        ExtraArgs={"ContentType": "image/jpeg"}
    )


def lambda_handler(event, context):
    print("Received event:", json.dumps(event))

    for record in event.get("Records", []):
        event_name = record.get("eventName", "")
        if not event_name.startswith("ObjectCreated:"):
            continue

        src_bucket = record["s3"]["bucket"]["name"]
        raw_key = record["s3"]["object"]["key"]
        src_key = unquote_plus(raw_key)

        lower_key = (src_key or "").lower()

        # Only process audio file creates (not meta.json, not art)
        if not lower_key.endswith(SUPPORTED_AUDIO_EXTS):
            print(f"Skipping non-audio object: {src_key}")
            continue

        folder_parts = src_key.split("/")
        folder_prefix = "/".join(folder_parts[:-1])  # raw/<artist>/<album>
        filename = folder_parts[-1]

        ts = extract_ts_prefix(filename)

        # Defaults
        title = title_from_filename(filename)
        artist_display = "Unknown Artist"
        album_display = "Unknown Album"
        track_number = None
        release_year = None
        art_key = None
        meta = None
        meta_key = None

        # Load meta if we have ts
        if ts:
            try:
                meta, meta_key = load_meta_with_retries(src_bucket, folder_prefix, ts)
            except Exception as e:
                print("Meta read error:", str(e))
                meta = None
                meta_key = f"{folder_prefix}/{ts}__meta.json"

        # If meta exists, use exact casing + read art_key
        if isinstance(meta, dict):
            title = (meta.get("title") or title).strip()
            artist_display = (meta.get("artist") or artist_display).strip()
            album_display = (meta.get("album") or album_display).strip()
            track_number = meta.get("track_number")
            release_year = meta.get("release_year")
            art_key = meta.get("art_key") or meta.get("art_path")

        # Decide output paths in AUDIO bucket
        artist_slug_from_key, album_slug_from_key = parse_artist_album_from_key(src_key)
        artist_path = slug_for_audio_path(artist_display, artist_slug_from_key or "unknown_artist")
        album_path = slug_for_audio_path(album_display, album_slug_from_key or "unknown_album")

        track_id = f"trk_{uuid.uuid4().hex[:8]}"

        # --- AUDIO: copy or transcode to MP3 ---
        normalized_filename = normalize_filename(filename)

        if lower_key.endswith(".mp3"):
            dest_key = f"tracks/{artist_path}/{album_path}/{normalized_filename}"
            print(f"Copying MP3 to audio bucket: s3://{src_bucket}/{src_key} -> s3://{AUDIO_BUCKET}/{dest_key}")

            s3.copy_object(
                CopySource={"Bucket": src_bucket, "Key": src_key},
                Bucket=AUDIO_BUCKET,
                Key=dest_key,
                ContentType="audio/mpeg",
                MetadataDirective="REPLACE",
            )
            stream_path = dest_key
            source_format = "mp3"
        else:
            base_no_ext = normalized_filename.rsplit(".", 1)[0]
            mp3_name = f"{base_no_ext}.mp3"

            local_in = f"/tmp/{normalized_filename}"
            local_mp3 = f"/tmp/{mp3_name}"
            dest_key = f"tracks/{artist_path}/{album_path}/{mp3_name}"

            print(f"Downloading source: s3://{src_bucket}/{src_key} -> {local_in}")
            s3.download_file(src_bucket, src_key, local_in)

            print("Running ffmpeg transcoding to MP3...")
            subprocess.run(
                ["/opt/bin/ffmpeg", "-y", "-i", local_in, "-vn", "-codec:a", "libmp3lame", "-b:a", "192k", local_mp3],
                check=True
            )

            print(f"Uploading MP3: {local_mp3} -> s3://{AUDIO_BUCKET}/{dest_key}")
            s3.upload_file(local_mp3, AUDIO_BUCKET, dest_key, ExtraArgs={"ContentType": "audio/mpeg"})

            stream_path = dest_key
            source_format = normalized_filename.rsplit(".", 1)[-1].lower()

        # --- ALBUM ART: normalize to a single cover.jpg in AUDIO bucket ---
        # Canonical cover location (one per album)
        cover_dest_key = f"albums/{artist_path}/{album_path}/cover.jpg"
        art_path = None

        try:
            # If cover already exists, reuse it (dedupe)
            if _head_exists(AUDIO_BUCKET, cover_dest_key):
                art_path = cover_dest_key
            else:
                # If meta provided an art_key and it exists and is image, copy/convert it
                if art_key and _is_image_key(art_key):
                    print(f"Creating album cover in audio bucket: {cover_dest_key} from raw {art_key}")
                    _copy_image_to_audio_as_jpg(src_bucket, art_key, AUDIO_BUCKET, cover_dest_key)
                    art_path = cover_dest_key
                else:
                    # No art uploaded this time; leave art_path empty
                    art_path = None
        except Exception as e:
            print("Album art processing error:", str(e))
            art_path = None

        # --- Write DynamoDB ---
        item = {
            "track_id": track_id,
            "title": title,                 # exact casing (from meta)
            "artist": artist_display,       # exact casing (from meta)
            "album": album_display,         # exact casing (from meta)
            "track_number": track_number,
            "release_year": release_year,
            "stream_path": stream_path,
            "source_format": source_format,

            # NEW: canonical art path in AUDIO bucket (CloudFront will serve this)
            "art_path": art_path,

            # Debug
            "raw_key": src_key,
            "meta_key": meta_key,
        }

        # Remove null/empty values
        item = {k: v for k, v in item.items() if v is not None and v != ""}

        print("Writing DynamoDB item:", item)
        table.put_item(Item=item)

    return {"statusCode": 200, "body": json.dumps({"message": "Ingest complete"})}
