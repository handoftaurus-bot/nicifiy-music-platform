import { apiJson, apiFetch } from "../api";
import { toast } from "../ui/toast.jsx";

/**
 * Album/EP upload (MVP):
 * - Collect album metadata once
 * - For each track file: call POST /uploads/init to get presigned URLs
 * - PUT audio + (optional) art + meta
 */
export async function uploadAlbum({ artist, album, year, artFile, tracks, onProgress }){
  if (!artist || !album || !tracks?.length) throw new Error("Missing artist/album/tracks");

  let done = 0;
  const total = tracks.length;

  for (const tr of tracks){
    const title = tr.title?.trim() || tr.file?.name || "Untitled";
    const trackNo = tr.no || (done + 1);
    const audioFile = tr.file;
    if (!audioFile) continue;

    const initBody = {
      title,
      artist,
      album,
      track_number: trackNo,
      release_year: year || null,
      audio_filename: audioFile.name,
      audio_content_type: audioFile.type || "application/octet-stream",
      art_filename: artFile ? artFile.name : "",
      art_content_type: artFile ? (artFile.type || "application/octet-stream") : "",
    };

    const init = await apiJson("/uploads/init", { method:"POST", body: JSON.stringify(initBody) });

    // Upload audio
    await putPresigned(init.audio_put_url, audioFile, init.audio_content_type);

    // Upload art (optional)
    if (artFile && init.art_put_url){
      await putPresigned(init.art_put_url, artFile, init.art_content_type);
    }

    // Upload meta json
    const meta = {
      title,
      artist,
      album,
      track_number: trackNo,
      release_year: year || null,
      // keep whatever else backend expects later
    };
    await putPresigned(init.meta_put_url, new Blob([JSON.stringify(meta)], { type:"application/json" }), "application/json");

    done += 1;
    onProgress?.({ done, total, current: title });
  }

  toast("Upload complete");
}

async function putPresigned(url, body, contentType){
  const res = await fetch(url, {
    method: "PUT",
    headers: contentType ? { "Content-Type": contentType } : undefined,
    body,
  });
  if (!res.ok) throw new Error(`Upload failed (${res.status})`);
}
