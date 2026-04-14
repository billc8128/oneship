/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/**/*.{ts,tsx,html}'],
  theme: {
    extend: {
      colors: {
        canvas: '#FAF8F5',
        surface: '#FFFFFF',
        sand: '#F0ECE6',
        border: '#EDE8E1',
        espresso: '#2C2520',
        secondary: '#6B6058',
        muted: '#8C8078',
        light: '#B8AFA6',
        accent: '#8B5CF6',
        success: '#10B981',
        warning: '#F97316',
        danger: '#DC2626',
      },
      fontFamily: {
        heading: ['Funnel Sans', 'system-ui', 'sans-serif'],
        body: ['Geist', 'system-ui', 'sans-serif'],
        mono: ['IBM Plex Mono', 'monospace'],
      },
      borderRadius: {
        DEFAULT: '8px',
        lg: '12px',
        xl: '14px',
        '2xl': '16px',
      },
      boxShadow: {
        card: '0 2px 8px rgba(44, 37, 32, 0.03)',
        'card-hover': '0 4px 16px rgba(44, 37, 32, 0.06)',
      }
    },
  },
  plugins: [],
}
