import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { readConfig } from "./src/config.ts";
import { pagesHeaders } from "./src/hosting.ts";
export default defineConfig(({ command, mode }) => {
  // Fail before emitting a bundle if a privileged key or unsafe origin is supplied.
  // Browser-side validation alone would still leak that key into static assets.
  const config = command === "build"
    ? readConfig({ ...loadEnv(mode, process.cwd(), ""), ...process.env })
    : undefined;
  return {
    plugins: [
      react(),
      {
        name: "public-account-dev-route",
        configureServer(server) {
          server.middlewares.use((request, _response, next) => {
            if (request.url?.match(/^\/account(?:\/callback)?(?:\?|$)/)) {
              request.url = "/account.html";
            }
            next();
          });
        },
      },
      {
        name: "static-host-security-headers",
        closeBundle() {
          if (config) writeFileSync(resolve("dist/_headers"), pagesHeaders(config));
        },
      },
    ],
    build: {
      sourcemap: false,
      rollupOptions: { input: { review: resolve("index.html"), account: resolve("account.html") } },
    },
  };
});
