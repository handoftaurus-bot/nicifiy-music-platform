import { apiJson } from "../api";
import { setToken, state } from "../state";

export async function submitArtistApply(form){
  const payload = {
    displayName: form.artistName.trim(),
    bio: (form.bio || "").trim(),
    links: (form.links || "").trim(),
    genres: (form.genres || "").trim(),
    location: (form.location || "").trim(),
    fullName: (form.fullName || "").trim(),
  };
  const data = await apiJson("/artist/apply", { method:"POST", body: JSON.stringify(payload) });
  if (data.token) setToken(data.token);
  if (data.user) state.user = data.user;
  return data;
}
