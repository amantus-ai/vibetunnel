/** @type {import('tailwindcss').Config} */
module.exports = {
    content: ["./src/**/*.{html,js,ts,jsx,tsx}", "./src/**/*.ts", "./src/components/*.ts", "./src/*.ts", "./public/**/*.html"],
    theme: {
        extend: {
            colors: {
                // Unified Dark theme colors with consistent depth
                "dark-bg": "#0a0a0a",
                "dark-bg-secondary": "#141414",
                "dark-bg-tertiary": "#1f1f1f",
                "dark-bg-elevated": "#262626",
                "dark-surface": "#1a1a1a",
                "dark-surface-hover": "#2a2a2a",
                "dark-border": "#2a2a2a",
                "dark-border-light": "#3a3a3a",
                "dark-border-focus": "#4a4a4a",
                
                // Text colors
                "dark-text": "#e4e4e4",
                "dark-text-bright": "#ffffff",
                "dark-text-muted": "#a3a3a3",
                "dark-text-dim": "#737373",
                
                // Unified accent color - Vibrant teal-green
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
                
                // Legacy mappings for gradual migration
                "accent-primary": "#10B981",
                "accent-primary-dark": "#059669",
                "accent-primary-darker": "#047857",
                "accent-primary-light": "#34D399",
                "accent-primary-glow": "#10B98166",
                "accent-green": "#10B981",
                "accent-green-dark": "#059669",
                "accent-green-darker": "#047857",
                "accent-green-light": "#34D399",
                "accent-green-glow": "#10B98166",
            },
            boxShadow: {
                // Unified glow effects with primary color
                'glow': '0 0 20px rgba(16, 185, 129, 0.4)',
                'glow-sm': '0 0 10px rgba(16, 185, 129, 0.3)',
                'glow-lg': '0 0 30px rgba(16, 185, 129, 0.5)',
                'glow-intense': '0 0 40px rgba(16, 185, 129, 0.6)',
                // Legacy mappings
                'glow-primary': '0 0 20px rgba(16, 185, 129, 0.4)',
                'glow-primary-sm': '0 0 10px rgba(16, 185, 129, 0.3)',
                'glow-primary-lg': '0 0 30px rgba(16, 185, 129, 0.5)',
                'glow-green': '0 0 20px rgba(16, 185, 129, 0.4)',
                'glow-green-sm': '0 0 10px rgba(16, 185, 129, 0.3)',
                'glow-green-lg': '0 0 30px rgba(16, 185, 129, 0.5)',
                // Subtle shadows for depth
                'card': '0 1px 3px rgba(0, 0, 0, 0.3), 0 1px 2px rgba(0, 0, 0, 0.4)',
                'card-hover': '0 4px 6px rgba(0, 0, 0, 0.3), 0 2px 4px rgba(0, 0, 0, 0.4)',
                'elevated': '0 10px 15px -3px rgba(0, 0, 0, 0.3), 0 4px 6px -2px rgba(0, 0, 0, 0.2)',
            },
            animation: {
                'pulse-green': 'pulseGreen 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
                'pulse-primary': 'pulsePrimary 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
                'slide-in-right': 'slideInRight 0.3s ease-out',
                'slide-in-bottom': 'slideInBottom 0.3s ease-out',
                'fade-in': 'fadeIn 0.2s ease-out',
                'scale-in': 'scaleIn 0.2s ease-out',
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