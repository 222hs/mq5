/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  // Preflight OFF: never touch the existing inline-styled dashboards.
  corePlugins: { preflight: false },
  theme: {
    extend: {
      colors: {
        onyx: '#07080A',
        amber: '#FFB000',
        emerald: '#00E676',
        crimson: '#FF3D00',
      },
      fontFamily: {
        mono: ["'JetBrains Mono'", "'Fira Code'", 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
    },
  },
  plugins: [],
};
