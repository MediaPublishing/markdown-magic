import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  clearScreen: false,
  plugins: [{
    name: 'markdown-magic-development-csp',
    transformIndexHtml(html, context) {
      if (!context.server) return html;
      return html.replace("connect-src 'self';", "connect-src 'self' http://localhost:* ws://localhost:*;");
    },
  }],
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: 'dist-renderer',
    emptyOutDir: true,
  },
});
