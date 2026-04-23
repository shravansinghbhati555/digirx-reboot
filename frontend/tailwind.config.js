/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          coral: '#f472b6',
          coralDeep: '#ec4899',
          peach: '#fecdd3',
          peachSoft: '#ffe4e6',
          lilac: '#c4b5fd',
          lilacSoft: '#ede9fe',
          mint: '#a7f3d0',
          mintSoft: '#ecfdf5',
          cream: '#fffbeb',
          ink: '#1e1b4b',
          inkMuted: '#57534e',
        },
      },
      boxShadow: {
        soft: '0 4px 24px -4px rgba(236, 72, 153, 0.12), 0 8px 32px -8px rgba(139, 92, 246, 0.1)',
        nav: '0 -8px 32px rgba(30, 27, 75, 0.06)',
        card: '0 2px 16px rgba(30, 27, 75, 0.06)',
      },
      backgroundImage: {
        'mesh-pastel':
          'radial-gradient(1200px 600px at 10% -10%, #fce7f3 0%, transparent 50%), radial-gradient(800px 400px at 100% 0%, #ede9fe 0%, transparent 45%), radial-gradient(600px 300px at 50% 100%, #ecfdf5 0%, transparent 40%)',
        'btn-primary': 'linear-gradient(135deg, #f472b6 0%, #a78bfa 50%, #818cf8 100%)',
        'btn-primary-hover': 'linear-gradient(135deg, #ec4899 0%, #8b5cf6 50%, #6366f1 100%)',
      },
      keyframes: {
        'fade-up': {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'scale-in': {
          '0%': { opacity: '0', transform: 'scale(0.96)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
      },
      animation: {
        'fade-up': 'fade-up 0.35s ease-out both',
        'scale-in': 'scale-in 0.28s ease-out both',
      },
    },
  },
  plugins: [],
};
