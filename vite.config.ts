import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg", "apple-touch-icon.png"],
      manifest: {
        name: "TriCoach",
        short_name: "TriCoach",
        description: "Daily triathlon session from your Garmin data and a morning check-in",
        theme_color: "#111111",
        background_color: "#f3f3f0",
        display: "standalone",
        start_url: "/",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        // The app shell is precached. API responses are never cached by the service
        // worker; the last day record is kept in localStorage for offline viewing.
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api\//, /^\/\.netlify\//],
      },
    }),
  ],
});
