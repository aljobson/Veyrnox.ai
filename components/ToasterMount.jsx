"use client";

/**
 * Global Toaster mount.
 *
 * Rendered once from app/layout.js so every studio (and any other
 * client component) can call toast.* helpers without mounting its
 * own Toaster. react-hot-toast is a singleton, so a single mount
 * catches every toast emitted anywhere in the tree.
 */

import { Toaster } from "react-hot-toast";

export default function ToasterMount() {
  return (
    <Toaster
      position="bottom-right"
      reverseOrder={false}
      toastOptions={{
        duration: 4500,
        // Theme tokens (app/globals.css, on :root), so toasts follow the
        // light and dark themes like the rest of the chrome.
        style: {
          background: "rgb(var(--vx-panel))",
          color: "rgb(var(--vx-fg))",
          border: "1px solid rgb(var(--vx-border))",
          fontSize: "13px",
        },
        error: { duration: 6000 },
      }}
    />
  );
}
