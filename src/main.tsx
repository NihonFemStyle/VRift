import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource/share-tech-mono/400.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/700.css";
import "./styles/app.css";
import App from "./App";
import { boot } from "./ui/boot";

// Everything imported above has loaded and run by the time we get here.
boot.done("code");

async function start() {
  // Load the fonts before the editor first draws, so it does not jump from a fallback font.
  // Capped, so a font that cannot load never holds VRift up.
  const fonts = ['16px "Share Tech Mono"', '13px "JetBrains Mono"', 'bold 13px "JetBrains Mono"'];
  await Promise.race([Promise.all(fonts.map((f) => document.fonts.load(f).catch(() => []))), new Promise((r) => setTimeout(r, 3000))]);
  boot.done("fonts");

  ReactDOM.createRoot(document.getElementById("root")!, {
    onUncaughtError: (error) => boot.fail(error),
  }).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

start().catch((e) => boot.fail(e));
