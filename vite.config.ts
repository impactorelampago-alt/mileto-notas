import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron'
import path from 'path'


export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const requiredEnv = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'] as const
  const missingEnv = requiredEnv.filter((name) => !(process.env[name] || env[name]))
  const supabaseUrl = process.env.VITE_SUPABASE_URL || env.VITE_SUPABASE_URL || ''
  const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY || ''

  if (missingEnv.length > 0) {
    throw new Error(`Configuração obrigatória ausente: ${missingEnv.join(', ')}`)
  }

  if (!/^https:\/\/[^/]+$/i.test(supabaseUrl) || !/^eyJ[^.]+\.[^.]+\.[^.]+$/.test(supabaseAnonKey)) {
    throw new Error('Configuração do Supabase inválida; build cancelado para não publicar uma tela em branco')
  }

  return {
    plugins: [
      react(),
      electron([
        {
          entry: 'electron/main.ts',
          onstart(options) {
            delete process.env.ELECTRON_RUN_AS_NODE
            options.startup()
          },
          vite: {
            build: {
              outDir: 'dist-electron',
              sourcemap: true,
              rollupOptions: {
                external: ['electron', 'electron-store'],
              },
            },
          },
        },
        {
          entry: 'electron/preload.ts',
          onstart(options) {
            options.reload()
          },
          vite: {
            build: {
              outDir: 'dist-electron',
              sourcemap: true,
              rollupOptions: {
                external: ['electron', 'electron-store'],
              },
            },
          },
        },
      ]),
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    build: {
      outDir: 'dist',
    },
  }
})
