import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

function manualSolutionReload() {
  return {
    name: 'manual-solution-reload',
    handleHotUpdate({ file }) {
      const normalizedFile = file.replace(/\\/g, '/').toLowerCase()
      if (
        normalizedFile.includes('/src/data/solutions/') &&
        normalizedFile.endsWith('.json')
      ) {
        return []
      }
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), manualSolutionReload()],
})
