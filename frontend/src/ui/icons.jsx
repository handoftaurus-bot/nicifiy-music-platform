import React from "react";

export function Icon({ children, size = 18, className = "" }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export function PrevIcon(props) {
  return (
    <Icon {...props}>
      <path d="M6 6v12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M18 6l-9 6 9 6V6Z" fill="currentColor" />
    </Icon>
  );
}

export function NextIcon(props) {
  return (
    <Icon {...props}>
      <path d="M18 6v12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M6 6l9 6-9 6V6Z" fill="currentColor" />
    </Icon>
  );
}

export function PlayIcon(props) {
  return (
    <Icon {...props}>
      <path d="M8 5v14l12-7-12-7Z" fill="currentColor" />
    </Icon>
  );
}

export function PauseIcon(props) {
  return (
    <Icon {...props}>
      <path d="M7 5h4v14H7V5Zm6 0h4v14h-4V5Z" fill="currentColor" />
    </Icon>
  );
}

export function ShuffleIcon(props) {
  // Spotify-like shuffle: two crossing paths with arrowheads
  return (
    <Icon {...props}>
      <path d="M16 3h5v5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4 4l6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M10 14l-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M14 10l3-3h4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M14 14l3 3h4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M16 21h5v-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </Icon>
  );
}

export function RepeatIcon(props) {
  return (
    <Icon {...props}>
      <path d="M17 1l4 4-4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M3 11V9a4 4 0 0 1 4-4h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
      <path d="M7 23l-4-4 4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M21 13v2a4 4 0 0 1-4 4H3" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
    </Icon>
  );
}
