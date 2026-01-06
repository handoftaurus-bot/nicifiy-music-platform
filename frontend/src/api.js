import { CONFIG } from "./config";
import { state, TOKEN_KEY } from "./state";

/**
 * Low-level fetch wrapper that always:
 * - prefixes CONFIG.API_BASE
 * - attaches Authorization: Bearer <JWT> if available
 * - sets Content-Type to application/json when sending a body
 */
export async function apiFetch(path, opts = {}) {
  const headers = new Headers(opts.headers || {});

  // If a body exists and no content-type is set, default to JSON
  if (opts.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  // Attach YOUR app JWT (not Google credential)
  const token = state.token || localStorage.getItem(TOKEN_KEY);
  if (token) headers.set("Authorization", `Bearer ${token}`);

  return fetch(`${CONFIG.API_BASE}${path}`, { ...opts, headers });
}

/**
 * JSON convenience wrapper:
 * - parses JSON response (or {})
 * - throws useful Error on non-2xx
 */
export async function apiJson(path, opts = {}) {
  const res = await apiFetch(path, opts);
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    const msg = data?.error || data?.message || `Request failed (${res.status})`;
    const err = new Error(msg);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}
