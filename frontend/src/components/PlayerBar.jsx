const fallbackArt = "/assets/Current.png";
const artSrc = currentTrack?.art_url || fallbackArt;

<img
  src={artSrc}
  alt={currentTrack?.title ? `${currentTrack.title} cover` : "Current"}
  onError={(e) => { e.currentTarget.src = fallbackArt; }}
/>
