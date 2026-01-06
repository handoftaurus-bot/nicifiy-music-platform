import { apiJson } from "../api";

export function normalizeTrack(t){
  const id = t.track_id || t.id || t.pk || t.sk || t.key || "";
  const title = t.title || t.name || t.track_title || "Untitled";
  const artist = t.artist || t.artist_name || t.artistName || "Unknown Artist";
  const album = t.album || t.album_name || t.albumName || "";
  const art = t.art_url || t.artUrl || t.image || t.cover || "";
  const stream = t.stream_url || t.streamUrl || (id ? `/tracks/${encodeURIComponent(id)}/stream` : "");
  return { raw: t, id, title, artist, album, art, stream };
}

export async function fetchCatalog(){
  const data = await apiJson("/tracks");
  const items = Array.isArray(data) ? data : (data.items || data.tracks || []);
  return items.map(normalizeTrack);
}
