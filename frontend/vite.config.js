import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Important for S3/CloudFront static hosting under root
  base: "./",
});
