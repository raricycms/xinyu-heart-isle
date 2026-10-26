import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// 心屿 —— 前端纯静态站点，无后端。
// 数据全部保存在浏览器 localStorage，因此构建产物可直接托管在任意静态服务器。
export default defineConfig({
  plugins: [react()],
  // 必须是绝对路径 '/'，不能是 './'。
  // 原因：本站用 BrowserRouter，存在 /scales/phq-9、/toolbox/breathing-478 这类两层子路由。
  // 用 './' 时，浏览器会把资源解析成 /scales/assets/xxx.js，在 SPA fallback 下该请求返回的是
  // index.html（MIME 为 text/html），于是 <script type="module"> 被浏览器拒绝执行 —— 直接访问这些
  // 深层链接会整页白屏（首页和单层路由却是正常的，很容易在开发时漏掉）。
  base: '/',
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
    },
  },
  server: {
    port: 5173,
    host: '127.0.0.1',
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});
