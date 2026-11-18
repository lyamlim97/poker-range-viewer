import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { manualSolutionReload } from "./vite-plugin-solution-editor.js";

// https://vite.dev/config/
export default defineConfig({
	plugins: [react(), manualSolutionReload()],
});
