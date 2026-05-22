/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./*.html'],
  theme: {
    extend: {
      colors: {
        'ouen-yellow': '#FFE042',
        'ouen-cream':  '#FFF4B8',
        'ouen-red':    '#E8554E',
        'ouen-navy':   '#1F4F6B',
        'ouen-brown':  '#8B5A2B',
      },
      fontFamily: {
        rounded: ['"M PLUS Rounded 1c"', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
