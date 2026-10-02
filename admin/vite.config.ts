import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { readConfig } from "./src/config.ts";
export default defineConfig(({ command, mode }) => {
  // Fail before emitting a bundle if a privileged key or unsafe origin is supplied.
  // Browser-side validation alone would still leak that key into static assets.
  if (command === "build")
    readConfig({ ...loadEnv(mode, process.cwd(), ""), ...process.env });
  return { plugins: [react()], build: { sourcemap: false } };
});
