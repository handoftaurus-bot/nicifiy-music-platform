import { apiJson } from "../api";

export async function fetchPendingApplications(){
  const data = await apiJson("/admin/artist-applications");
  return data.items || [];
}

export async function approveArtist(sub){
  return apiJson(`/admin/artist-applications/${encodeURIComponent(sub)}/approve`, { method:"POST" });
}

export async function rejectArtist(sub, reason){
  return apiJson(`/admin/artist-applications/${encodeURIComponent(sub)}/reject`, {
    method:"POST",
    body: JSON.stringify({ reason })
  });
}
