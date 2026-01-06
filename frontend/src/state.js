export const TOKEN_KEY = "current_token";
export const VOLUME_KEY = "current_volume";

export const state = {
  token: localStorage.getItem(TOKEN_KEY) || null,
  user: null,
  catalog: [],
  player: {
    track: null,
    isPlaying: false,
    progress: 0,
    duration: 0,
    volume: Number(localStorage.getItem(VOLUME_KEY) || 1),
  },
};

export function setToken(token) {
  const raw = (token || "").replace(/^Bearer\s+/i, "").trim();
  state.token = raw || null;

  if (state.token) localStorage.setItem(TOKEN_KEY, state.token);
  else localStorage.removeItem(TOKEN_KEY);
}

export function clearAuth() {
  setToken(null);
  state.user = null;
}

export function setVolume(v) {
  const vol = Math.max(0, Math.min(1, Number(v)));
  state.player.volume = Number.isFinite(vol) ? vol : 1;
  localStorage.setItem(VOLUME_KEY, String(state.player.volume));
}
