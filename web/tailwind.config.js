/** @type {import('tailwindcss').Config} */
module.exports = {
    content: ["./src/**/*.{html,js,ts,jsx,tsx}", "./src/**/*.ts", "./src/components/*.ts", "./src/*.ts", "./public/**/*.html"],
    theme: {
        extend: {
            colors: {
                // Dark theme colors
                "dark-bg": "#0a0a0a",
                "dark-bg-secondary": "#1a1a1a",
                "dark-bg-tertiary": "#242424",
                "dark-surface": "#1f1f1f",
                "dark-border": "#2a2a2a",
                "dark-border-light": "#3a3a3a",
                
                // Text colors
                "dark-text": "#e4e4e4",
                "dark-text-muted": "#7a7a7a",
                "dark-text-dim": "#5a5a5a",
                
                // Green accent colors (multiple shades)
                "accent-green": "#00ff88",
                "accent-green-dark": "#00cc66",
                "accent-green-darker": "#009944",
                "accent-green-light": "#44ffaa",
                "accent-green-glow": "#00ff8866",
                
                // Secondary accent colors
                "accent-cyan": "#00ffcc",
                "accent-teal": "#00ccaa",
                
                // Status colors
                "status-error": "#cc3333",
                "status-warning": "#cc8833",
                "status-success": "#00cc66",
                
                // Legacy VS Code theme colors (for compatibility)
                "vs-bg": "#0a0a0a",
                "vs-text": "#e4e4e4",
                "vs-muted": "#7a7a7a",
                "vs-accent": "#00ff88",
                "vs-user": "#00ff88",
                "vs-assistant": "#00ccaa",
                "vs-warning": "#ffaa44",
                "vs-function": "#44ffaa",
                "vs-type": "#00ffcc",
                "vs-border": "#2a2a2a",
                "vs-border-light": "#3a3a3a",
                "vs-bg-secondary": "#1a1a1a",
                "vs-nav": "#1a1a1a",
                "vs-nav-hover": "#242424",
                "vs-nav-active": "#00ff88",
                "vs-highlight": "#8b6914",
            },
            boxShadow: {
                'glow-green': '0 0 20px rgba(0, 255, 136, 0.4)',
                'glow-green-sm': '0 0 10px rgba(0, 255, 136, 0.3)',
                'glow-green-lg': '0 0 30px rgba(0, 255, 136, 0.5)',
            },
            animation: {
                'pulse-green': 'pulseGreen 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
            },
            keyframes: {
                pulseGreen: {
                    '0%, 100%': {
                        opacity: '1',
                    },
                    '50%': {
                        opacity: '.8',
                    },
                },
            },
        },
    },
    plugins: [],
};