/** @type {import('tailwindcss').Config} */
module.exports = {
    content: ["./src/**/*.{html,js,ts,jsx,tsx}", "./src/**/*.ts", "./src/components/*.ts", "./src/*.ts", "./public/**/*.html"],
    theme: {
        extend: {
            colors: {
                // Theme-aware colors using CSS variables
                "bg": "rgb(var(--color-bg) / <alpha-value>)",
                "bg-secondary": "rgb(var(--color-bg-secondary) / <alpha-value>)",
                "bg-tertiary": "rgb(var(--color-bg-tertiary) / <alpha-value>)",
                "bg-elevated": "rgb(var(--color-bg-elevated) / <alpha-value>)",
                "surface": "rgb(var(--color-surface) / <alpha-value>)",
                "surface-hover": "rgb(var(--color-surface-hover) / <alpha-value>)",
                "border": "rgb(var(--color-border) / <alpha-value>)",
                "border-light": "rgb(var(--color-border-light) / <alpha-value>)",
                "border-focus": "rgb(var(--color-border-focus) / <alpha-value>)",
                
                // Text colors
                "text": "rgb(var(--color-text) / <alpha-value>)",
                "text-bright": "rgb(var(--color-text-bright) / <alpha-value>)",
                "text-muted": "rgb(var(--color-text-muted) / <alpha-value>)",
                "text-dim": "rgb(var(--color-text-dim) / <alpha-value>)",
                
                // Unified accent color - Vibrant teal-green (stays the same across themes)
                "primary": "#10B981",
                "primary-hover": "#059669",
                "primary-dark": "#047857",
                "primary-light": "#34D399",
                "primary-muted": "#10B98133",
                "primary-glow": "#10B98166",
                
                // Status colors
                "status-error": "#EF4444",
                "status-warning": "#F59E0B",
                "status-success": "#10B981",
                "status-info": "#3B82F6",
            },
            boxShadow: {
                // Unified glow effects with primary color
                'glow': '0 0 20px rgba(16, 185, 129, 0.4)',
                'glow-sm': '0 0 10px rgba(16, 185, 129, 0.3)',
                'glow-lg': '0 0 30px rgba(16, 185, 129, 0.5)',
                'glow-intense': '0 0 40px rgba(16, 185, 129, 0.6)',
                // Status-specific glow effects
                'glow-error': '0 0 20px rgba(239, 68, 68, 0.4)',
                'glow-error-sm': '0 0 10px rgba(239, 68, 68, 0.3)',
                'glow-error-lg': '0 0 30px rgba(239, 68, 68, 0.5)',
                'glow-warning': '0 0 20px rgba(245, 158, 11, 0.4)',
                'glow-warning-sm': '0 0 10px rgba(245, 158, 11, 0.3)',
                'glow-warning-lg': '0 0 30px rgba(245, 158, 11, 0.5)',
                // Subtle shadows for depth
                'card': '0 1px 3px rgba(0, 0, 0, 0.3), 0 1px 2px rgba(0, 0, 0, 0.4)',
                'card-hover': '0 4px 6px rgba(0, 0, 0, 0.3), 0 2px 4px rgba(0, 0, 0, 0.4)',
                'elevated': '0 10px 15px -3px rgba(0, 0, 0, 0.3), 0 4px 6px -2px rgba(0, 0, 0, 0.2)',
            },
            animation: {
                'pulse-primary': 'pulsePrimary 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
                'slide-in-right': 'slideInRight 0.3s ease-out',
                'slide-in-bottom': 'slideInBottom 0.3s ease-out',
                'fade-in': 'fadeIn 0.2s ease-out',
                'scale-in': 'scaleIn 0.2s ease-out',
            },
            keyframes: {
                pulsePrimary: {
                    '0%, 100%': {
                        opacity: '1',
                    },
                    '50%': {
                        opacity: '.7',
                    },
                },
                slideInRight: {
                    '0%': {
                        transform: 'translateX(100%)',
                        opacity: '0',
                    },
                    '100%': {
                        transform: 'translateX(0)',
                        opacity: '1',
                    },
                },
                slideInBottom: {
                    '0%': {
                        transform: 'translateY(100%)',
                        opacity: '0',
                    },
                    '100%': {
                        transform: 'translateY(0)',
                        opacity: '1',
                    },
                },
                fadeIn: {
                    '0%': {
                        opacity: '0',
                    },
                    '100%': {
                        opacity: '1',
                    },
                },
                scaleIn: {
                    '0%': {
                        transform: 'scale(0.95)',
                        opacity: '0',
                    },
                    '100%': {
                        transform: 'scale(1)',
                        opacity: '1',
                    },
                },
            },
        },
    },
    plugins: [],
};