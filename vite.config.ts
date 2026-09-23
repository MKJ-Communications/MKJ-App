import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";
import tailwindcss from "@tailwindcss/vite";
import tsConfigPaths from "vite-tsconfig-paths";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { nitro } from "nitro/vite";
import viteReact from "@vitejs/plugin-react";

export default defineConfig(({ command, mode }) => {
  const isDevBuild = command === "build" && mode === "development";

  // Inline every VITE_* variable at build time, on the server bundle as well as the
  // client, so the Supabase URL/key set on the host end up in both.
  const env = loadEnv(mode, process.cwd(), "VITE_");
  // Vercel exposes the production domain at build time; use it for the absolute OG
  // image URL unless VITE_SITE_URL is set explicitly (e.g. on another host).
  if (!env.VITE_SITE_URL && process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    env.VITE_SITE_URL = `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }
  const envDefine = Object.fromEntries(
    Object.entries(env).map(([key, value]) => [`import.meta.env.${key}`, JSON.stringify(value)]),
  );

  return {
    plugins: [
      tailwindcss(),
      tsConfigPaths({ projects: ["./tsconfig.json"] }),
      tanstackStart({
        // Fail the build if client code imports anything under a server/ folder or
        // the "server-only" marker, instead of leaking server code to the browser.
        importProtection: {
          behavior: "error",
          client: { files: ["**/server/**"], specifiers: ["server-only"] },
        },
        // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
        server: { entry: "server" },
      }),
      // Nitro packages the SSR server for Vercel; only needed for builds.
      command === "build" && nitro({ preset: "vercel" }),
      viteReact(),
    ],
    define: envDefine,
    // `bun run build:dev`: a production-shaped build that keeps React in development mode
    // (readable errors, component names preserved) for debugging deploy-only issues.
    ...(isDevBuild && {
      environments: {
        client: { define: { "process.env.NODE_ENV": JSON.stringify("development") } },
      },
      esbuild: { keepNames: true },
    }),
    css: { transformer: "lightningcss" },
    resolve: {
      alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
      // One copy of React and TanStack Query, or hooks and the query cache break.
      dedupe: [
        "react",
        "react-dom",
        "react/jsx-runtime",
        "react/jsx-dev-runtime",
        "@tanstack/react-query",
        "@tanstack/query-core",
      ],
    },
    optimizeDeps: {
      include: [
        "react",
        "react-dom",
        "react-dom/client",
        "react/jsx-runtime",
        "react/jsx-dev-runtime",
      ],
      ignoreOutdatedRequests: true,
    },
    server: {
      host: "::",
      // localhost:8080 is what the Supabase redirect allow-list expects for local testing;
      // PORT lets a tool (e.g. an editor's preview pane) run it elsewhere when 8080 is taken.
      port: Number(process.env.PORT) || 8080,
      // Wait for a file to stop changing before reloading, so multi-step saves don't
      // trigger a reload on a half-written file.
      watch: { awaitWriteFinish: { stabilityThreshold: 1000, pollInterval: 100 } },
    },
  };
});
