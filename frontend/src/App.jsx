import { useEffect, useMemo, useRef, useState } from "react";
import "./styles.css";
import { ToastHost, toast } from "./ui/toast.jsx";
import { Modal } from "./ui/modal.jsx";
import { state } from "./state";
import { fetchCatalog } from "./features/catalog.js";
import { loadMe, signOut, mountGoogleButton } from "./features/auth.js";
import { submitArtistApply } from "./features/artistApply.js";
import { approveArtist, fetchPendingApplications, rejectArtist } from "./features/admin.js";
import { uploadAlbum } from "./features/uploads.js";
import { PlayIcon, PauseIcon, PrevIcon, NextIcon, ShuffleIcon, RepeatIcon } from "./ui/icons.jsx";

/* -------------------- Recent listens (local only) -------------------- */
const RECENT_KEY = "current_recent_v1";
function _safeJsonParse(s, fallback) {
  try {
    return JSON.parse(s);
  } catch {
    return fallback;
  }
}
function loadRecent() {
  if (typeof window === "undefined") return [];
  return _safeJsonParse(window.localStorage.getItem(RECENT_KEY) || "[]", []);
}
function saveRecent(list) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 50)));
}
function stableTrackId(t) {
  return (
    t?.id ||
    t?.track_id ||
    `${t?.title || ""}|${t?.artist || ""}|${t?.album || ""}|${t?.stream || ""}`
  );
}
function pushRecent(prev, track) {
  const item = {
    id: stableTrackId(track),
    title: track?.title || "",
    artist: track?.artist || "",
    album: track?.album || "",
    art: track?.art || "",
    stream: track?.stream || "",
    ts: Date.now(),
  };
  const next = [item, ...prev.filter((x) => x.id !== item.id)];
  saveRecent(next);
  return next;
}

/* -------------------- Play counts (local only) -------------------- */
const PLAYCOUNT_KEY = "current_playcount_v1";
function loadPlayCounts() {
  if (typeof window === "undefined") return {};
  return _safeJsonParse(window.localStorage.getItem(PLAYCOUNT_KEY) || "{}", {});
}
function savePlayCounts(map) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(PLAYCOUNT_KEY, JSON.stringify(map || {}));
}

/* -------------------- Small UI bits -------------------- */

function HomeSimpleIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M12 3.2 2.8 11.1a1 1 0 0 0 .65 1.76H5v7.1a1 1 0 0 0 1 1h4.7v-5.5h2.6v5.5H18a1 1 0 0 0 1-1v-7.1h1.55a1 1 0 0 0 .65-1.76L12 3.2Z"
      />
    </svg>
  );
}
function LibrarySimpleIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M4 4h2v16H4V4Zm4 0h2v16H8V4Zm4 0h8v2h-8V4Zm0 5h8v2h-8V9Zm0 5h8v2h-8v-2Zm0 5h8v2h-8v-2Z"
      />
    </svg>
  );
}
function SearchSimpleIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M10.2 3a7.2 7.2 0 1 1 4.55 12.75l4.05 4.05a1 1 0 0 1-1.42 1.42l-4.05-4.05A7.2 7.2 0 0 1 10.2 3Zm0 2a5.2 5.2 0 1 0 0 10.4 5.2 5.2 0 0 0 0-10.4Z"
      />
    </svg>
  );
}

function RolePill({ user }) {
  if (!user) return <span className="pill">Guest</span>;
  const role = user.role || "listener";
  const niceRole = role.charAt(0).toUpperCase() + role.slice(1);
  const statusRaw = user.artistStatus ? String(user.artistStatus) : "";
  const niceStatus = statusRaw ? statusRaw.charAt(0).toUpperCase() + statusRaw.slice(1) : "";
  return <span className="pill">{niceRole}{niceStatus ? ` • ${niceStatus}` : ""}</span>;
}

function UserMenu({ user, onSignIn, onSignOut, onOpenApply, onOpenAdmin, onOpenUpload }) {
  const [open, setOpen] = useState(false);
  const isAdmin = user?.role === "admin";
  const isArtist = user?.role === "artist" || isAdmin;
  const isListener = !user?.role || user?.role === "listener";

  useEffect(() => {
    const onDoc = (e) => {
      const el = e.target;
      if (!(el instanceof Node)) return;
      if (!document.querySelector(".userMenu")?.contains(el)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  if (!user) {
    return (
      <div className="userMenu">
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <button className="btn btnPrimary" onClick={onSignIn}>Sign in</button>
          <button className="btn" onClick={onSignIn}>Sign up</button>
        </div>
      </div>
    );
  }

  const label = user?.name || user?.email || "Account";

  return (
    <div className="userMenu">
      <button
        className="accountBtn"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open ? "true" : "false"}
      >
        {user?.picture ? (
          <img className="accountDotImg" src={user.picture} alt="" />
        ) : (
          <span className="accountDot" aria-hidden="true">C</span>
        )}
        <span className="accountLabel">{label}</span>
      </button>

      {open ? (
        <div className="menu" role="menu">
          <div className="menuHeader">
            <div className="menuHeaderName">{label}</div>
            <div className="menuHeaderSub"><RolePill user={user} /></div>
          </div>

          {isListener ? (
            <button className="menuItem" onClick={() => { setOpen(false); onOpenApply(); }} role="menuitem">
              Apply as Artist
            </button>
          ) : null}

          {isArtist ? (
            <button className="menuItem" onClick={() => { setOpen(false); onOpenUpload(); }} role="menuitem">
              Upload
            </button>
          ) : null}

          {isAdmin ? (
            <button className="menuItem" onClick={() => { setOpen(false); onOpenAdmin(); }} role="menuitem">
              Admin
            </button>
          ) : null}

          <div className="menuSep" />
          <button className="menuItem danger" onClick={() => { setOpen(false); onSignOut(); }} role="menuitem">
            Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
}

function Topbar({ user, onSignIn, onSignOut, onOpenApply, onOpenAdmin, onOpenUpload, view, setView, q, setQ }) {
  return (
    <div className="topbarFixedInner">
      <div className="topbarBrand" onClick={() => { setView("home"); }} role="button" tabIndex={0} aria-label="Current home">
        <img className="topbarBrandDot" src="/assets/Current.png" alt="Current" />
        <div className="topbarBrandTitle">Current</div>
      </div>

      <div className="topbarNav">
        <button className={`topIconBtn ${view === "home" ? "active" : ""}`} onClick={() => setView("home")} aria-label="Home" title="Home">
          <HomeSimpleIcon />
        </button>

        <div className="topbarSearch" role="search">
          <SearchSimpleIcon size={18} />
          <input
            className="topbarSearchInput"
            placeholder="Search"
            value={q}
            onChange={(e) => { setQ(e.target.value); setView("search"); }}
          />
        </div>

        <button className={`topIconBtn ${view === "library" ? "active" : ""}`} onClick={() => setView("library")} aria-label="Library" title="Library">
          <LibrarySimpleIcon />
        </button>
      </div>

      <UserMenu
        user={user}
        onSignIn={onSignIn}
        onSignOut={onSignOut}
        onOpenApply={onOpenApply}
        onOpenAdmin={onOpenAdmin}
        onOpenUpload={onOpenUpload}
      />
    </div>
  );
}

function TrackRow({ t, onPlay }) {
  return (
    <div className="trackRow" onClick={() => onPlay(t)} role="button" tabIndex={0}>
      <div className="cover">
        {t.art ? <img src={t.art} alt="" /> : <div className="coverPlaceholder" aria-hidden="true" />}
      </div>
      <div style={{ minWidth: 0 }}>
        <div className="title" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.title}</div>
        <div className="sub" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.artist}</div>
      </div>
      <div className="colHideSm">
        <div className="sub" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.album || "—"}</div>
      </div>
    </div>
  );
}

/* ---------- Spotify-like shelves (Home only) ---------- */

function Shelf({ title, children }) {
  return (
    <div className="shelf">
      <div className="shelfHeader">
        <div className="shelfTitle">{title}</div>
      </div>
      {children}
    </div>
  );
}

function TileButton({ title, subtitle, art, round = false, onClick, ariaLabel }) {
  return (
    <button className="tile" onClick={onClick} aria-label={ariaLabel || title} title={title}>
      <div className={`tileArt ${round ? "round" : ""}`}>
        {art ? <img src={art} alt="" /> : <div className="coverPlaceholder" aria-hidden="true" />}
      </div>
      <div className="tileMeta">
        <div className="tileTitle">{title}</div>
        {subtitle ? <div className="tileSub">{subtitle}</div> : null}
      </div>
    </button>
  );
}

function PlayerBar({ track, audioRef, volume, setVolume, isPlaying, onPlayPause, onPrev, onNext, shuffle, repeat, onToggleShuffle, onToggleRepeat }) {
  const [pos, setPos] = useState(0);
  const [dur, setDur] = useState(0);

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;

    const onTime = () => setPos(a.currentTime || 0);
    const onMeta = () => setDur(a.duration || 0);
    a.addEventListener("timeupdate", onTime);
    a.addEventListener("loadedmetadata", onMeta);
    return () => {
      a.removeEventListener("timeupdate", onTime);
      a.removeEventListener("loadedmetadata", onMeta);
    };
  }, [audioRef, track?.id]);

  const pct = dur ? (pos / dur) * 100 : 0;

  const seek = (e) => {
    const a = audioRef.current;
    if (!a || !dur) return;
    const v = Number(e.target.value || 0);
    a.currentTime = (v / 100) * dur;
    setPos(a.currentTime || 0);
  };

  const repeatState = repeat || "off";

  return (
    <div className="playerBar">
      {track ? (
        <div style={{ display: "flex", gap: 10, alignItems: "center", minWidth: 220 }}>
          <div className="cover" style={{ width: 38, height: 38, borderRadius: 10, overflow: "hidden" }}>
            {track?.art ? <img src={track.art} alt="" onError={(e) => { e.currentTarget.remove(); }} /> : null}
          </div>
          <div style={{ minWidth: 0 }}>
            <div className="title" style={{ fontSize: 14, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {track?.title || ""}
            </div>
            <div className="sub" style={{ fontSize: 12, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {track?.artist || ""}
            </div>
          </div>
        </div>
      ) : (
        <div style={{ minWidth: 220 }} />
      )}

      <div style={{ flex: 1, minWidth: 260 }}>
        <div style={{ display: "flex", justifyContent: "center", gap: 10, alignItems: "center", marginBottom: 6 }}>
          <button className={`iconBtn ${shuffle ? "active" : ""}`} onClick={onToggleShuffle} aria-label="Shuffle" title="Shuffle">
            <ShuffleIcon size={18} />
          </button>

          <button className="iconBtn" onClick={onPrev} aria-label="Previous" title="Previous">
            <PrevIcon size={20} />
          </button>

          <button className="iconBtn playBtn" onClick={onPlayPause} aria-label={isPlaying ? "Pause" : "Play"} title={isPlaying ? "Pause" : "Play"}>
            {isPlaying ? <PauseIcon size={22} /> : <PlayIcon size={22} />}
          </button>

          <button className="iconBtn" onClick={onNext} aria-label="Next" title="Next">
            <NextIcon size={20} />
          </button>

          <button
            className={`iconBtn ${repeatState !== "off" ? "active" : ""}`}
            onClick={onToggleRepeat}
            aria-label="Repeat"
            title={repeatState === "one" ? "Repeat one" : repeatState === "all" ? "Repeat all" : "Repeat off"}
          >
            <RepeatIcon size={18} />
            {repeatState === "one" ? <span className="repeatOneDot" /> : null}
          </button>
        </div>

        {track ? (
          <>
            <input className="range" type="range" min="0" max="100" step="0.1" value={pct || 0} onChange={seek} />
            <div className="small">{formatTime(pos)} / {formatTime(dur)}</div>
          </>
        ) : (
          <div style={{ height: 18 }} />
        )}
      </div>

      <div className="volumeCol" style={{ width: 160 }}>
        <div className="small">Volume</div>
        <input
          className="range"
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={volume}
          onChange={(e) => setVolume(Number(e.target.value))}
        />
      </div>
    </div>
  );
}

function formatTime(sec) {
  if (!sec || !isFinite(sec)) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

/* -------------------- App -------------------- */

export default function App() {
  const [view, setView] = useState("home");
  const [user, setUser] = useState(null);
  const [isMobile, setIsMobile] = useState(() => (typeof window !== "undefined" ? window.innerWidth < 980 : false));
  const [recent, setRecent] = useState(() => loadRecent());
  const [playCounts, setPlayCounts] = useState(() => loadPlayCounts());

  const [showNowPlaying, setShowNowPlaying] = useState(false);
  const [pos, setPos] = useState(0);
  const [dur, setDur] = useState(0);
  const [tracks, setTracks] = useState([]);
  const [loading, setLoading] = useState(true);

  const audioRef = useRef(null);
  const [current, setCurrent] = useState(null);

  const currentIdx = useMemo(() => {
    if (!current) return -1;
    return tracks.findIndex((x) => (x.id || x.track_id) === (current.id || current.track_id));
  }, [tracks, current]);

  const [vol, setVol] = useState(state.player.volume);
  const [isPlaying, setIsPlaying] = useState(false);
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState("off"); // off | all | one

  // Modals
  const [showApply, setShowApply] = useState(false);
  const [showAdmin, setShowAdmin] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [showLogin, setShowLogin] = useState(false);

  // Artist apply form
  const [applyForm, setApplyForm] = useState({
    fullName: "",
    artistName: "",
    bio: "",
    links: "",
    genres: "",
    location: "",
  });

  // Admin state
  const [pending, setPending] = useState([]);
  const [adminBusy, setAdminBusy] = useState(false);

  // Upload state
  const [uploadMeta, setUploadMeta] = useState({ artist: "", album: "", year: "" });
  const [uploadArt, setUploadArt] = useState(null);
  const [uploadTracks, setUploadTracks] = useState([]);
  const [uploadProg, setUploadProg] = useState(null);

  // Search
  const [q, setQ] = useState("");
  const [activeAlbum, setActiveAlbum] = useState(null);

  const qNorm = q.trim().toLowerCase();
  const searchResults = useMemo(() => {
    if (!qNorm) return tracks;
    return tracks.filter((t) => {
      const hay = `${t.title || ""} ${t.artist || ""} ${t.album || ""}`.toLowerCase();
      return hay.includes(qNorm);
    });
  }, [tracks, qNorm]);

  // Library grouping (artist + album)
  const libraryByAlbum = useMemo(() => {
    const norm = (s) => (s || "").trim().replace(/\s+/g, " ").toLowerCase();
    const m = new Map(); // key -> { key, album, artist, tracks, art }

    for (const t of tracks) {
      const album = (t.album || "Unknown Album").trim().replace(/\s+/g, " ");
      const artist = (t.artist || "Unknown Artist").trim().replace(/\s+/g, " ");
      const key = `${norm(artist)}|${norm(album)}`;

      if (!m.has(key)) {
        m.set(key, { key, album, artist, tracks: [], art: "" });
      }
      const g = m.get(key);
      g.tracks.push(t);
      if (!g.art && t.art) g.art = t.art;
    }

    return Array.from(m.values())
      .sort((a, b) => (a.artist + " — " + a.album).localeCompare(b.artist + " — " + b.album))
      .map((g) => ({
        ...g,
        tracks: g.tracks
          .slice()
          .sort((a, b) => {
            const n = (t) => {
              const v =
                t.track_no ??
                t.trackNumber ??
                t.track_number ??
                t.track_index ??
                t.trackIndex ??
                t.no ??
                t.number ??
                t.position ??
                null;

              const x = Number(v);
              return Number.isFinite(x) ? x : null;
            };

            const an = n(a);
            const bn = n(b);

            if (an != null && bn != null) return an - bn;
            if (an != null) return -1;
            if (bn != null) return 1;

            // If neither has a track number, do NOT force alphabetical.
            // Preserve catalog order by using original index if present, otherwise keep stable order.
            const ai = Number.isFinite(a.__catalogIndex) ? a.__catalogIndex : 0;
            const bi = Number.isFinite(b.__catalogIndex) ? b.__catalogIndex : 0;
            return ai - bi;
          })
      }));
  }, [tracks]);

  const activeAlbumInfo = useMemo(() => {
    if (!activeAlbum) return null;
    return libraryByAlbum.find((a) => a.key === activeAlbum) || null;
  }, [libraryByAlbum, activeAlbum]);

  // Home shelves data
  const artistTiles = useMemo(() => {
    const norm = (s) => (s || "").trim().replace(/\s+/g, " ");
    const map = new Map(); // artist -> { name, art, count, plays }
    for (const t of tracks) {
      const name = norm(t.artist || "Unknown Artist");
      const id = stableTrackId(t);
      const plays = (playCounts || {})[id] || 0;
      const cur = map.get(name) || { name, art: t.art || "", count: 0, plays: 0 };
      cur.count += 1;
      cur.plays += plays;
      if (!cur.art && t.art) cur.art = t.art;
      map.set(name, cur);
    }
    return Array.from(map.values())
      .sort((a, b) => (b.plays - a.plays) || a.name.localeCompare(b.name))
      .slice(0, 18);
  }, [tracks, playCounts]);

  const albumTiles = useMemo(() => {
    const norm = (s) => (s || "").trim().replace(/\s+/g, " ");
    const map = new Map(); // key -> { key, album, artist, art, plays, count }
    for (const t of tracks) {
      const artist = norm(t.artist || "Unknown Artist");
      const album = norm(t.album || "Unknown Album");
      const key = `${artist}|||${album}`;
      const id = stableTrackId(t);
      const plays = (playCounts || {})[id] || 0;

      const cur = map.get(key) || { key, album, artist, art: t.art || "", plays: 0, count: 0 };
      cur.count += 1;
      cur.plays += plays;
      if (!cur.art && t.art) cur.art = t.art;
      map.set(key, cur);
    }
    return Array.from(map.values())
      .sort((a, b) => (b.plays - a.plays) || (a.artist + a.album).localeCompare(b.artist + b.album))
      .slice(0, 18);
  }, [tracks, playCounts]);

  const topPlayedTiles = useMemo(() => {
    const scored = tracks
      .map((t) => ({ t, plays: (playCounts || {})[stableTrackId(t)] || 0 }))
      .filter((x) => x.plays > 0)
      .sort((a, b) => b.plays - a.plays)
      .slice(0, 18)
      .map((x) => x.t);

    if (scored.length) return scored;

    // fallback: if no play counts yet, show recent unique
    const byId = new Map(tracks.map((t) => [stableTrackId(t), t]));
    const seen = new Set();
    const out = [];
    for (const r of recent) {
      const t = byId.get(r.id);
      if (!t) continue;
      const id = stableTrackId(t);
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(t);
      if (out.length >= 18) break;
    }
    return out;
  }, [tracks, playCounts, recent]);

  // Track viewport (desktop vs mobile)
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 980);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Load public catalog
  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        const c = await fetchCatalog();
        setTracks(c.map((t, i) => ({ ...t, __catalogIndex: i })));
      } catch (e) {
        console.error(e);
        toast(e.message || "Failed to load catalog");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Optional session load
  useEffect(() => {
    (async () => {
      const me = await loadMe();
      setUser(me);
      if (me) {
        setApplyForm((f) => ({
          ...f,
          fullName: me.name || "",
          artistName: me.artistName || "",
        }));
      }
    })();
  }, []);

  // Volume sync
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    a.volume = vol;
    localStorage.setItem("current_volume", String(vol));
  }, [vol]);

  // Keep player state in sync with <audio>
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;

    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onTime = () => setPos(a.currentTime || 0);
    const onMeta = () => setDur(a.duration || 0);
    const onEnded = async () => {
      if (repeat === "one" && current) {
        try {
          a.currentTime = 0;
          await a.play();
        } catch {}
        return;
      }
      await goNext();
    };

    a.addEventListener("play", onPlay);
    a.addEventListener("pause", onPause);
    a.addEventListener("ended", onEnded);
    a.addEventListener("timeupdate", onTime);
    a.addEventListener("loadedmetadata", onMeta);
    return () => {
      a.removeEventListener("play", onPlay);
      a.removeEventListener("pause", onPause);
      a.removeEventListener("ended", onEnded);
      a.removeEventListener("timeupdate", onTime);
      a.removeEventListener("loadedmetadata", onMeta);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repeat, currentIdx, shuffle]);

  function handleSignOut() {
    signOut();
    setUser(null);
    toast("Signed out");
  }

  async function handleSignIn() {
    setShowLogin(true);
  }

  useEffect(() => {
    if (!showLogin) return;
    mountGoogleButton("googleBtnMount");
  }, [showLogin]);

  // Fallback: if GIS finishes sign-in without dispatching an event, detect session via /me while the login modal is open
  useEffect(() => {
    if (!showLogin) return;
    let tries = 0;
    const id = window.setInterval(async () => {
      tries += 1;
      try {
        const me = await loadMe();
        if (me) {
          setUser(me);
          setShowLogin(false);
          toast("Signed in");
          window.clearInterval(id);
        }
      } catch {
        // ignore until session is ready
      }
      if (tries >= 12) window.clearInterval(id);
    }, 900);
    return () => window.clearInterval(id);
  }, [showLogin]);

  useEffect(() => {
    const onAuthChanged = async () => {
      try {
        const me = await loadMe();
        setUser(me);
        setShowLogin(false);
        toast("Signed in");
      } catch (e) {
        console.error(e);
        toast("Sign-in complete, but profile load failed");
      }
    };
    window.addEventListener("auth:changed", onAuthChanged);
    return () => window.removeEventListener("auth:changed", onAuthChanged);
  }, []);

  async function playTrack(t) {
    try {
      const a = audioRef.current;
      if (!a) return;
      const url = t.stream?.startsWith("http")
        ? t.stream
        : (t.stream ? `${import.meta.env.VITE_API_BASE}${t.stream}` : "");
      if (!url) {
        toast("No stream URL for this track");
        return;
      }

      setCurrent(t);
      setRecent((prev) => pushRecent(prev, t));

      // increment local play count (Home -> "Top played")
      setPlayCounts((prev) => {
        const id = stableTrackId(t);
        const next = { ...(prev || {}) };
        next[id] = (next[id] || 0) + 1;
        savePlayCounts(next);
        return next;
      });

      a.src = url;
      await a.play();
    } catch (e) {
      console.error(e);
      toast("Playback failed");
    }
  }

  async function playIndex(i) {
    if (!tracks.length) return;
    const idx = Math.max(0, Math.min(tracks.length - 1, i));
    const t = tracks[idx];
    if (t) await playTrack(t);
  }

  async function goNext() {
    if (!tracks.length) return;
    let nextIdx = currentIdx;
    if (nextIdx < 0) nextIdx = 0;

    if (shuffle) {
      nextIdx = Math.floor(Math.random() * tracks.length);
    } else {
      nextIdx = nextIdx + 1;
      if (nextIdx >= tracks.length) {
        if (repeat === "all") nextIdx = 0;
        else return;
      }
    }
    await playIndex(nextIdx);
  }

  async function goPrev() {
    if (!tracks.length) return;
    let prevIdx = currentIdx;
    if (prevIdx < 0) prevIdx = 0;

    if (shuffle) {
      prevIdx = Math.floor(Math.random() * tracks.length);
    } else {
      prevIdx = prevIdx - 1;
      if (prevIdx < 0) {
        if (repeat === "all") prevIdx = tracks.length - 1;
        else prevIdx = 0;
      }
    }
    await playIndex(prevIdx);
  }

  async function togglePlayPause() {
    const a = audioRef.current;
    if (!a) return;
    if (!a.src && tracks.length) {
      await playIndex(0);
      return;
    }
    if (a.paused) {
      try {
        await a.play();
      } catch {
        toast("Playback failed");
      }
    } else {
      a.pause();
    }
  }

  function toggleShuffle() {
    setShuffle((v) => !v);
  }
  function cycleRepeat() {
    setRepeat((v) => (v === "off" ? "all" : v === "all" ? "one" : "off"));
  }

  async function refreshPending() {
    setAdminBusy(true);
    try {
      const items = await fetchPendingApplications();
      setPending(items);
    } catch (e) {
      console.error(e);
      toast(e.message || "Failed to load applications");
    } finally {
      setAdminBusy(false);
    }
  }

  async function doApprove(sub) {
    setAdminBusy(true);
    try {
      await approveArtist(sub);
      toast("Approved");
      await refreshPending();
    } catch (e) {
      console.error(e);
      toast(e.message || "Approve failed");
    } finally {
      setAdminBusy(false);
    }
  }

  async function doReject(sub) {
    const reason = prompt("Reject reason (optional):") || "";
    setAdminBusy(true);
    try {
      await rejectArtist(sub, reason);
      toast("Rejected");
      await refreshPending();
    } catch (e) {
      console.error(e);
      toast(e.message || "Reject failed");
    } finally {
      setAdminBusy(false);
    }
  }

  async function doApply() {
    try {
      if (!user) {
        toast("Sign in first");
        return;
      }
      if (!applyForm.artistName.trim()) {
        toast("Artist / stage name is required");
        return;
      }
      await submitArtistApply(applyForm);
      const me = await loadMe();
      setUser(me);
      setShowApply(false);
      toast("Application submitted");
    } catch (e) {
      console.error(e);
      toast(e.message || "Submit failed");
    }
  }

  function addTrackFiles(files) {
    const list = Array.from(files || []);
    if (!list.length) return;
    setUploadTracks((prev) => {
      const out = [...prev];
      for (const f of list) {
        out.push({ no: out.length + 1, title: titleFromFilename(f.name), file: f });
      }
      return out;
    });
  }

  async function doUpload() {
    try {
      if (!user || (user.role !== "artist" && user.role !== "admin")) {
        toast("Artist/admin only");
        return;
      }
      if (!uploadMeta.artist || !uploadMeta.album) {
        toast("Artist + Album required");
        return;
      }
      if (!uploadTracks.length) {
        toast("Add at least one track");
        return;
      }

      setUploadProg({ done: 0, total: uploadTracks.length, current: "Starting..." });

      await uploadAlbum({
        artist: uploadMeta.artist,
        album: uploadMeta.album,
        year: uploadMeta.year,
        artFile: uploadArt,
        tracks: uploadTracks,
        onProgress: (p) => setUploadProg(p),
      });

      setShowUpload(false);
      setUploadTracks([]);
      setUploadArt(null);
      setUploadProg(null);

      const c = await fetchCatalog();
      setTracks(c.map((t, i) => ({ ...t, __catalogIndex: i })));
      toast("Upload complete");
    } catch (e) {
      console.error(e);
      toast(e.message || "Upload failed");
    }
  }

  const isArtist = user?.role === "artist" || user?.role === "admin";
  const isAdmin = user?.role === "admin";

  return (
    <>
      <div className="topbarFixed">
        <Topbar
          user={user}
          onSignIn={handleSignIn}
          onSignOut={handleSignOut}
          onOpenApply={() => setShowApply(true)}
          onOpenAdmin={() => { setShowAdmin(true); refreshPending(); }}
          onOpenUpload={() => setShowUpload(true)}
          view={view}
          setView={setView}
          q={q}
          setQ={setQ}
        />
      </div>

      <div className="container">
        <div className="appShell">
          <aside className="leftPanel" aria-label="Your Library">
            <div className="leftPanelHeader">
              <div className="leftPanelTitle">Your Library</div>
            </div>

            {recent.length ? (
              <div className="libraryList">
                {recent.map((t) => (
                  <button
                    key={t.id}
                    className="libraryRow"
                    onClick={() => playTrack(t)}
                    title={`${t.title} — ${t.artist}`}
                  >
                    <div className="libraryArt">
                      {t.art ? <img src={t.art} alt="" /> : <div className="coverPlaceholder" aria-hidden="true" />}
                    </div>
                    <div className="libraryMeta">
                      <div className="libraryName">{t.title}</div>
                      <div className="librarySub">{t.artist}</div>
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="small" style={{ padding: "10px 12px" }}>
                Your recent listens will show here.
              </div>
            )}
          </aside>

          <section className="main">
            <div className="content">
              {view === "search" ? (
                <div className="grid">
                  <div className="searchBoxInline" role="search">
                    <SearchSimpleIcon size={18} />
                    <input
                      className="searchInputInline"
                      placeholder="What do you want to listen to?"
                      value={q}
                      onChange={(e) => setQ(e.target.value)}
                    />
                  </div>

                  {loading ? (
                    <div className="small">Loading catalog…</div>
                  ) : (
                    <>
                      {searchResults.length ? (
                        <div className="trackList">
                          {searchResults.map((t) => (
                            <TrackRow key={t.id || `${t.title}-${t.artist}-${t.album || ""}`} t={t} onPlay={playTrack} />
                          ))}
                        </div>
                      ) : (
                        <div className="small">No matches.</div>
                      )}
                    </>
                  )}
                </div>
              ) : view === "library" ? (
                <div className="grid">
                  <div className="sectionTitle">Recently played</div>
                  {recent.length ? (
                    <div className="trackList">
                      {recent.map((t) => (
                        <TrackRow key={t.id} t={t} onPlay={(x) => playTrack(x)} />
                      ))}
                    </div>
                  ) : (
                    <div className="small">Play something to build your library.</div>
                  )}
                </div>
              ) : (
                <div className="grid">
                  {loading ? (
                    <div className="small">Loading catalog…</div>
                  ) : !tracks.length ? (
                    <div className="small">No tracks found.</div>
                  ) : activeAlbumInfo ? (
                    <div className="albumPage">
                      <div className="albumHeaderRow">
                        <button className="btn" onClick={() => setActiveAlbum(null)}>← Back</button>
                      </div>

                      <div className="albumHero">
                        <div className="albumCover">
                          {activeAlbumInfo.art ? (
                            <img src={activeAlbumInfo.art} alt="" />
                          ) : (
                            <div className="coverPlaceholder" aria-hidden="true" />
                          )}
                        </div>

                        <div className="albumMeta">
                          <div className="albumKicker">Album</div>
                          <div className="albumTitleBig">{activeAlbumInfo.album}</div>
                          <div className="albumSubBig">{activeAlbumInfo.artist}</div>

                          <div className="albumActions">
                            <button
                              className="btn btnPrimary"
                              onClick={() => {
                                const first = activeAlbumInfo.tracks?.[0];
                                if (first) playTrack(first);
                              }}
                            >
                              Play
                            </button>

                            <button
                              className="btn"
                              onClick={() => {
                                const list = activeAlbumInfo.tracks || [];
                                if (!list.length) return;
                                const pick = list[Math.floor(Math.random() * list.length)];
                                setShuffle(true);
                                playTrack(pick);
                              }}
                            >
                              Shuffle
                            </button>
                          </div>
                        </div>
                      </div>

                      <div className="albumTracklist">
                        <div className="albumTracklistHeader">
                          <div className="albumColNum">#</div>
                          <div className="albumColTitle">Title</div>
                        </div>

                        {activeAlbumInfo.tracks.map((t, idx) => (
                          <div
                            key={t.id || `${t.title}-${t.artist}-${t.album || ""}-${idx}`}
                            className="albumTrackRow"
                            onClick={() => playTrack(t)}
                            role="button"
                            tabIndex={0}
                          >
                            <div className="albumColNum">{idx + 1}</div>
                            <div className="albumColTitle">
                              <div className="albumTrackTitle">{t.title || "Untitled"}</div>
                              <div className="albumTrackSub">{t.artist || ""}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <>
                      <Shelf title="Artists">
                        <div className="shelfRow">
                          {artistTiles.map((a) => (
                            <TileButton
                              key={a.name}
                              title={a.name}
                              subtitle={`${a.count} track${a.count === 1 ? "" : "s"}`}
                              art={a.art}
                              round
                              onClick={() => { setQ(a.name); setView("search"); }}
                              ariaLabel={`Search for artist ${a.name}`}
                            />
                          ))}
                        </div>
                      </Shelf>

                      <Shelf title="Albums">
                        <div className="shelfRow">
                          {albumTiles.map((a) => (
                            <TileButton
                              key={a.key}
                              title={a.album}
                              subtitle={a.artist}
                              art={a.art}
                              onClick={() => {
                                const normKey = (artist, album) =>
                                  `${(artist || "").trim().replace(/\s+/g, " ").toLowerCase()}|${(album || "").trim().replace(/\s+/g, " ").toLowerCase()}`;
                                setActiveAlbum(normKey(a.artist, a.album));
                              }}
                              ariaLabel={`Open album ${a.album} by ${a.artist}`}
                            />
                          ))}
                        </div>
                      </Shelf>

                      <Shelf title="Top played">
                        <div className="shelfRow">
                          {topPlayedTiles.map((t) => (
                            <TileButton
                              key={stableTrackId(t)}
                              title={t.title || "Untitled"}
                              subtitle={t.artist || ""}
                              art={t.art}
                              onClick={() => playTrack(t)}
                              ariaLabel={`Play ${t.title || "track"}`}
                            />
                          ))}
                        </div>
                      </Shelf>
                    </>
                  )}
                </div>
              )}
            </div>
          </section>

          <audio ref={audioRef} />

          {!showNowPlaying && (
            <>
              <div className="playerDock" role="region" aria-label="Player">
                <div
                  className="playerDockInner"
                  onClick={(e) => {
                    if (!isMobile || !current) return;
                    const t = e.target;
                    if (t && t.closest && t.closest("button, input, a, [role='slider']")) return;
                    setShowNowPlaying(true);
                  }}
                >
                  <PlayerBar
                    track={current}
                    audioRef={audioRef}
                    volume={vol}
                    setVolume={setVol}
                    isPlaying={isPlaying}
                    onPlayPause={togglePlayPause}
                    onPrev={goPrev}
                    onNext={goNext}
                    shuffle={shuffle}
                    repeat={repeat}
                    onToggleShuffle={toggleShuffle}
                    onToggleRepeat={cycleRepeat}
                  />
                </div>
              </div>

              <div className="bottomNav" role="navigation" aria-label="Primary">
                <button className={`navIcon ${view === "home" ? "active" : ""}`} onClick={() => setView("home")} aria-label="Home" title="Home">
                  <HomeSimpleIcon size={20} />
                  <span>Home</span>
                </button>

                <button className={`navIcon ${view === "search" ? "active" : ""}`} onClick={() => setView("search")} aria-label="Search" title="Search">
                  <SearchSimpleIcon size={20} />
                  <span>Search</span>
                </button>

                <button className={`navIcon ${view === "library" ? "active" : ""}`} onClick={() => setView("library")} aria-label="Library" title="Library">
                  <LibrarySimpleIcon size={20} />
                  <span>Library</span>
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {showNowPlaying && (
        <div className="nowPlayingOverlay" role="dialog" aria-modal="true" aria-label="Now playing">
          <div className="nowPlayingTop">
            <button className="iconBtn nowPlayingClose" onClick={() => setShowNowPlaying(false)} aria-label="Minimize" title="Minimize">
              <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
                <path fill="currentColor" d="M7.41 14.59 12 10l4.59 4.59L18 13.17l-6-6-6 6z" />
              </svg>
            </button>
          </div>

          <div className="nowPlayingBody">
            {current?.art ? (
              <div className="nowPlayingArt"><img src={current.art} alt="" /></div>
            ) : (
              <div className="nowPlayingArtPlaceholder" aria-hidden="true" />
            )}

            <div className="nowPlayingMeta">
              <div className="nowPlayingTitle">{current?.title || ""}</div>
              <div className="nowPlayingSub">{current?.artist || ""}</div>
            </div>

            <div className="nowPlayingControls">
              <button className={`iconBtn ${shuffle ? "active" : ""}`} onClick={toggleShuffle} aria-label="Shuffle" title="Shuffle">
                <ShuffleIcon size={22} />
              </button>

              <button className="iconBtn" onClick={goPrev} aria-label="Previous" title="Previous">
                <PrevIcon size={26} />
              </button>

              <button className="iconBtn playBtn" onClick={togglePlayPause} aria-label={isPlaying ? "Pause" : "Play"} title={isPlaying ? "Pause" : "Play"}>
                {isPlaying ? <PauseIcon size={26} /> : <PlayIcon size={26} />}
              </button>

              <button className="iconBtn" onClick={goNext} aria-label="Next" title="Next">
                <NextIcon size={26} />
              </button>

              <button className={`iconBtn ${repeat !== "off" ? "active" : ""}`} onClick={cycleRepeat} aria-label="Repeat" title="Repeat">
                <RepeatIcon size={22} />
                {repeat === "one" ? <span className="repeatOneDot" /> : null}
              </button>
            </div>

            <div className="nowPlayingProgress">
              <div className="small">{formatTime(pos || 0)}</div>
              <input
                className="range"
                type="range"
                min="0"
                max="100"
                step="0.1"
                value={dur ? (pos / dur) * 100 : 0}
                onChange={(e) => {
                  const a = audioRef.current;
                  if (!a || !(a.duration > 0)) return;
                  const v = Number(e.target.value || 0);
                  a.currentTime = (v / 100) * a.duration;
                }}
              />
              <div className="small">{formatTime(dur || 0)}</div>
            </div>

            <div className="nowPlayingVolume">
              <div className="small">Volume</div>
              <input className="range" type="range" min="0" max="1" step="0.01" value={vol} onChange={(e) => setVol(Number(e.target.value))} />
            </div>
          </div>
        </div>
      )}

      {showLogin && (
        <Modal title="Sign in" onClose={() => setShowLogin(false)}>
          <div className="grid">
            <div className="small">Continue with Google.</div>
            <div id="googleBtnMount" style={{ display: "flex", justifyContent: "center" }} />
          </div>
        </Modal>
      )}

      {showApply && (
        <Modal
          title="Apply as Artist"
          onClose={() => setShowApply(false)}
          footer={
            <>
              <button className="btn" onClick={() => setShowApply(false)}>Cancel</button>
              <button className="btn btnPrimary" onClick={doApply}>Submit for approval</button>
            </>
          }
        >
          <div className="field">
            <label>Full name (optional)</label>
            <input value={applyForm.fullName} onChange={(e) => setApplyForm((f) => ({ ...f, fullName: e.target.value }))} />
          </div>
          <div className="field">
            <label>Artist / stage name *</label>
            <input value={applyForm.artistName} onChange={(e) => setApplyForm((f) => ({ ...f, artistName: e.target.value }))} />
          </div>
          <div className="field">
            <label>Bio</label>
            <textarea value={applyForm.bio} onChange={(e) => setApplyForm((f) => ({ ...f, bio: e.target.value }))} />
          </div>
          <div className="field">
            <label>Links (one per line)</label>
            <textarea value={applyForm.links} onChange={(e) => setApplyForm((f) => ({ ...f, links: e.target.value }))} />
          </div>
          <div className="field">
            <label>Genres</label>
            <input value={applyForm.genres} onChange={(e) => setApplyForm((f) => ({ ...f, genres: e.target.value }))} />
          </div>
          <div className="field">
            <label>Location</label>
            <input value={applyForm.location} onChange={(e) => setApplyForm((f) => ({ ...f, location: e.target.value }))} />
          </div>
          <div className="small">You’ll remain a listener until approved.</div>
        </Modal>
      )}

      {showAdmin && (
        <Modal
          title="Admin — Artist Applications"
          onClose={() => setShowAdmin(false)}
          footer={
            <>
              <button className="btn" onClick={() => refreshPending()} disabled={adminBusy}>Refresh</button>
              <button className="btn" onClick={() => setShowAdmin(false)}>Close</button>
            </>
          }
        >
          {!isAdmin ? (
            <div className="small">Admin only.</div>
          ) : (
            <div className="grid">
              <div className="small">Pending: {pending.length}</div>
              {pending.length === 0 ? (
                <div className="small">No pending applications.</div>
              ) : (
                pending.map((p) => (
                  <div key={p.sub || p.pk} className="trackRow" style={{ gridTemplateColumns: "1fr 220px" }}>
                    <div style={{ minWidth: 0 }}>
                      <div className="title" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {(p.artistApplication?.displayName || p.name || p.email || "Unknown")}
                      </div>
                      <div className="sub" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {p.email || ""} • {p.sub || (p.pk || "").replace("USER#", "")}
                      </div>
                      {p.artistApplication?.bio ? <div className="small">{p.artistApplication.bio}</div> : null}
                    </div>
                    <div style={{ display: "flex", gap: 10, justifySelf: "end" }}>
                      <button className="btn btnPrimary" onClick={() => doApprove(p.sub || (p.pk || "").replace("USER#", ""))} disabled={adminBusy}>Approve</button>
                      <button className="btn btnDanger" onClick={() => doReject(p.sub || (p.pk || "").replace("USER#", ""))} disabled={adminBusy}>Reject</button>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </Modal>
      )}

      {showUpload && (
        <Modal
          title="Upload Album / EP"
          onClose={() => setShowUpload(false)}
          footer={
            <>
              <button className="btn" onClick={() => setShowUpload(false)}>Cancel</button>
              <button className="btn btnPrimary" onClick={doUpload}>Start upload</button>
            </>
          }
        >
          {!isArtist ? (
            <div className="small">Artist/Admin only.</div>
          ) : (
            <div className="grid">
              <div className="field">
                <label>Artist *</label>
                <input value={uploadMeta.artist} onChange={(e) => setUploadMeta((m) => ({ ...m, artist: e.target.value }))} />
              </div>
              <div className="field">
                <label>Album / EP *</label>
                <input value={uploadMeta.album} onChange={(e) => setUploadMeta((m) => ({ ...m, album: e.target.value }))} />
              </div>
              <div className="field">
                <label>Release year</label>
                <input value={uploadMeta.year} onChange={(e) => setUploadMeta((m) => ({ ...m, year: e.target.value }))} />
              </div>
              <div className="field">
                <label>Album art (jpg/png)</label>
                <input type="file" accept="image/*" onChange={(e) => setUploadArt(e.target.files?.[0] || null)} />
              </div>

              <div className="field">
                <label>Tracks *</label>
                <input type="file" accept="audio/*" multiple onChange={(e) => addTrackFiles(e.target.files)} />
                <div className="small">{uploadTracks.length} track(s) selected</div>
              </div>

              {uploadTracks.length ? (
                <div className="grid">
                  {uploadTracks.map((t, idx) => (
                    <div key={idx} className="field">
                      <label>Track {t.no} title</label>
                      <input
                        value={t.title}
                        onChange={(e) => {
                          const v = e.target.value;
                          setUploadTracks((prev) => prev.map((x) => (x.no === t.no ? { ...x, title: v } : x)));
                        }}
                      />
                      <div className="small">{t.file?.name}</div>
                    </div>
                  ))}
                </div>
              ) : null}

              {uploadProg ? (
                <div className="small">Uploading {uploadProg.done}/{uploadProg.total}: {uploadProg.current}</div>
              ) : null}

              <div className="small">After upload completes, catalog refreshes automatically.</div>
            </div>
          )}
        </Modal>
      )}

      <ToastHost />
    </>
  );
}

function titleFromFilename(name) {
  const base = (name || "").replace(/\.[^.]+$/, "");
  return base.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim() || "Untitled";
}
