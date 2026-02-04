import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@components': path.resolve(__dirname, './src/components'),
      '@features': path.resolve(__dirname, './src/features'),
      '@lib': path.resolve(__dirname, './src/lib'),
      '@types': path.resolve(__dirname, './src/types'),
    },
  },
  server: {
    // THÊM DÒNG NÀY: Cho phép truy cập từ bên ngoài Docker
    host: true,
    port: 5173,

    // THÊM DÒNG NÀY: Để tính năng Hot Reload hoạt động tốt trên Docker
    watch: {
      usePolling: true,
    },

    proxy: {
      '/api': {
        target: 'http://backend:3001', // Lưu ý: Trong Docker, nên dùng tên service 'backend' thay vì localhost
        changeOrigin: true,
      },
    },
  },
})
