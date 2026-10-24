export default {
  content: ['./app/**/*.{js,jsx}', './components/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        primary: { DEFAULT: '#e07b39', dark: '#c4622a', light: '#fdf0e8' },
        surface: '#faf8f5',
        panel: '#f5f0eb',
        warm: '#e8e0d6',
        dark: '#2d2520',
        muted: '#6b5e56',
        light: '#a0908a',
        success: '#6a9e5b',
        danger: '#c0392b',
        warning: '#d4862a',
        paper: '#ffffff'
      },
      fontFamily: {
        jakarta: ['"Plus Jakarta Sans"', 'Inter', 'sans-serif'],
        inter: ['Inter', 'sans-serif']
      }
    }
  },
  plugins: []
};
