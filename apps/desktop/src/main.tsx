import React from "react";
import ReactDOM from "react-dom/client";
import "./input-modality";
import AppShell from "./ade/AppShell";
import "./ade/styles.css";
import "./ade/new-thread-artwork.css";
import "./ade/themes.css";
import "@xterm/xterm/css/xterm.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AppShell />
  </React.StrictMode>,
);
