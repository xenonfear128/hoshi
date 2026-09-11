import React from "react";
import { syncDocumentLocale } from "./i18n";
syncDocumentLocale();
import ReactDOM from "react-dom/client";
import App from "./App";
import { DialogHost } from "./Dialogs";
import "./style.css";
import "./glass.css";
import "./hoshi.css";
import "./fonts.css";
import LiquidGlass from "./glass/LiquidGlass";
const viewport = window.visualViewport;
let restingHeight = document.documentElement.clientHeight;
let restingWidth = innerWidth;
let restingScale = viewport?.scale ?? 1;
const updateViewport = () => {
  const root = document.documentElement;
  const style = root.style;
  const height = viewport?.height ?? innerHeight;
  const layoutHeight = root.clientHeight;
  const editing = document.activeElement?.matches(
    "input,textarea,select,[contenteditable=true]",
  );
  // Some mobile browsers resize BOTH viewports. Compare against the last
  // unobstructed layout, not against another height that has already shrunk.
  if (Math.abs(innerWidth - restingWidth) > 100) {
    restingWidth = innerWidth;
    restingHeight = layoutHeight;
    restingScale = viewport?.scale ?? 1;
  }
  const scaledHeight = height * ((viewport?.scale ?? 1) / restingScale);
  const keyboardOpen =
    (!!editing || root.hasAttribute("data-keyboard-open")) &&
    restingHeight - scaledHeight > 120;
  if (!keyboardOpen) {
    restingHeight = layoutHeight;
    restingScale = viewport?.scale ?? 1;
  }
  root.toggleAttribute("data-keyboard-open", keyboardOpen);
  style.setProperty(
    "--layout-height",
    `${keyboardOpen ? restingHeight : layoutHeight}px`,
  );
  style.setProperty("--visual-height", `${height}px`);
  style.setProperty("--visual-width", `${viewport?.width ?? innerWidth}px`);
  style.setProperty("--visual-top", `${viewport?.offsetTop ?? 0}px`);
  style.setProperty("--visual-left", `${viewport?.offsetLeft ?? 0}px`);
};
viewport?.addEventListener("resize", updateViewport);
viewport?.addEventListener("scroll", updateViewport);
window.addEventListener("resize", updateViewport);
document.addEventListener("focusin", updateViewport);
updateViewport();
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <LiquidGlass />
    <App />
    <DialogHost />
  </React.StrictMode>,
);
