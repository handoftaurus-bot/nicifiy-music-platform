import React from "react";
import * as Icons from "../ui/icons"; // adjust path to where icons.js really lives

export default function Icon({ name, size = 18, className = "", title }) {
  const Svg = Icons[name];
  if (!Svg) return null;

  return (
    <span className={className} title={title} aria-hidden={title ? "false" : "true"}>
      <Svg width={size} height={size} />
    </span>
  );
}
