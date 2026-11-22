import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig(async () => ({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          react: ["react", "react-dom"],
          i18n: ["i18next", "react-i18next"],
          ui: ["lucide-react", "react-resizable-panels", "@tanstack/react-virtual"],
          xterm: ["@xterm/xterm", "@xterm/addon-fit", "@xterm/addon-web-links"],
          tauri: ["@tauri-apps/api", "@tauri-apps/plugin-dialog", "zustand"],
        },
      },
    },
  },
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
}));
