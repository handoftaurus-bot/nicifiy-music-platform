import { CONFIG } from "../config";
import { apiJson } from "../api";
import { clearAuth, setToken, state } from "../state";

let gisLoaded = false;
let gisInited = false;
let pendingResolvers = [];

/**
 * Load the GIS script once.
 */
function loadGis() {
  return new Promise((resolve, reject) => {
    if (window.google?.accounts?.id) return resolve();
    const existing = document.querySelector('script[src="https://accounts.google.com/gsi/client"]');
    if (existing) {
      // If script tag exists but google not ready yet, wait a tick
      const t = setInterval(() => {
        if (window.google?.accounts?.id) {
          clearInterval(t);
          resolve();
        }
      }, 50);
      setTimeout(() => {
        clearInterval(t);
        reject(new Error("GIS script load timeout"));
      }, 10000);
      return;
    }

    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true;
    s.defer = true;
    s.onload = resolve;
    s.onerror = () => reject(new Error("Failed to load Google GIS script"));
    document.head.appendChild(s);
  });
}

/**
 * Initialize GIS once with our callback that exchanges the Google ID token
 * for our app JWT via POST /auth/google.
 */
async function ensureInitialized() {
  if (!CONFIG.GOOGLE_CLIENT_ID) throw new Error("Missing VITE_GOOGLE_CLIENT_ID");
  if (gisInited) return;

  if (!gisLoaded) {
    await loadGis();
    gisLoaded = true;
  }

  if (gisInited) return;

  window.google.accounts.id.initialize({
    client_id: CONFIG.GOOGLE_CLIENT_ID,
    callback: async (resp) => {
      // This callback fires for both the rendered button AND prompt flow
      try {
        const data = await apiJson("/auth/google", {
          method: "POST",
          body: JSON.stringify({ credential: resp.credential }),
        });

        setToken(data.token);
        state.user = data.user;

        // Notify listeners that auth state changed
        window.dispatchEvent(new Event("auth:changed"));

        // Resolve any pending signIn() calls waiting for completion
        const list = pendingResolvers.slice();
        pendingResolvers = [];
        list.forEach(({ resolve }) => resolve(state.user));
      } catch (e) {
        const list = pendingResolvers.slice();
        pendingResolvers = [];
        list.forEach(({ reject }) => reject(e));
      }
    },
  });

  gisInited = true;
}

export async function initAuth() {
  await ensureInitialized();
}

/**
 * Render the official Google button into a container in your modal.
 * Call this when you open the modal (or once on app boot).
 *
 * The container must exist in the DOM (e.g. <div id="googleBtnMount"></div>)
 */
export async function mountGoogleButton(containerId = "googleBtnMount") {
  await ensureInitialized();

  const el = document.getElementById(containerId);
  if (!el) return; // modal not present yet; safe no-op

  // Prevent duplicate buttons if modal is reopened
  el.innerHTML = "";

  window.google.accounts.id.renderButton(el, {
    theme: "outline",     // looks clean in dark UI too
    size: "large",
    text: "signin_with",
    shape: "pill",
    width: 280,
  });
}

/**
 * Attempt sign-in via One Tap / prompt. This can be blocked/skipped depending on browser settings.
 * Your UI should also offer the rendered Google button in the modal as the reliable path.
 */
export async function signIn() {
  await ensureInitialized();

  return new Promise((resolve, reject) => {
    pendingResolvers.push({ resolve, reject });

    // Prompt can be blocked/skipped; callback will fire on success
    window.google.accounts.id.prompt((notification) => {
      if (notification.isNotDisplayed() || notification.isSkippedMoment()) {
        // Do not reject immediately; user might still click the rendered button.
        // But if you want, you can reject here with a friendly message:
        // reject(new Error("Google prompt was blocked; use the button in the modal."));
      }
    });
  });
}

export async function loadMe() {
  if (!state.token) return null;

  try {
    const data = await apiJson("/me");
    state.user = data.user;
    return state.user;
  } catch {
    clearAuth();
    return null;
  }
}

export function signOut() {
  clearAuth();
}
