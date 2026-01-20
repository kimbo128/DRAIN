/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        drain: {
          green: '#00D395',
          purple: '#7B61FF',
          dark: '#0A0A0A',
        },
      },
    },
  },
  plugins: [],
};
