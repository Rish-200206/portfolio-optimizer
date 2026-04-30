/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,jsx}',
  ],
  theme: {
    extend: {
      // Custom colour tokens used across the dashboard
      colors: {
        surface: {
          DEFAULT: '#0d1117',  // page background
          card:    '#161b22',  // card background
          border:  '#21262d',  // card border / divider
          hover:   '#1c2128',  // card hover state
        },
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'monospace'],
      },
    },
  },
  plugins: [],
}
