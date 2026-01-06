import React from "react";
import Sidebar from "./Sidebar";
import Topbar from "./Topbar";
import PlayerBar from "./PlayerBar";
import "./styles/theme.css";
import "./styles/shell.css";

export default function Shell({ children }) {
  return (
    <div className="app">
      <aside className="sidebar">
        <Sidebar />
      </aside>

      <div className="main">
        <div className="topbar">
          <Topbar />
        </div>

        <main className="content">
          {children}
        </main>
      </div>

      <footer className="player">
        <PlayerBar />
      </footer>
    </div>
  );
}
