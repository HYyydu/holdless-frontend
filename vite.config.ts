import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// Proxy target: 8000 = Python (History + Supabase). 3001 = Node (OpenAI). Set in .env: VITE_API_TARGET=8000
const apiTarget = process.env.VITE_API_TARGET || "3001";
const apiBase = `http://localhost:${apiTarget}`;

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    proxy: {
      "/api": {
        target: apiBase,
        changeOrigin: true,
        timeout: 120000,
      },
    },
  },
  plugins: [
    react(),
    mode === 'development' && componentTagger(),
    mode === 'development' && {
      name: 'log-api-proxy',
      configResolved() {
        console.log(`[Vite] /api proxy → ${apiBase} (History works only if this is Python, e.g. 8000)`);
      },
    },
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
