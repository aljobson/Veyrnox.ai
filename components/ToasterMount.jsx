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
        style: {
          background: "#1a1a1a",
          color: "#f5f5f5",
          border: "1px solid rgba(255,255,255,0.08)",
          fontSize: "13px",
        },
        error: { duration: 6000 },
      }}
    />
  );
}
