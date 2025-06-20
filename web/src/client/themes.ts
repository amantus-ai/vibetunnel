export interface ITerminalTheme {
  background: string;
  foreground: string;
  cursor: string;
  cursorAccent: string;
  selection?: string;
  black: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  magenta: string;
  cyan: string;
  white: string;
  brightBlack: string;
  brightRed: string;
  brightGreen: string;
  brightYellow: string;
  brightBlue: string;
  brightMagenta: string;
  brightCyan: string;
  brightWhite: string;
}

export const themes: { [key: string]: ITerminalTheme } = {
  VibeTunnel: {
    background: '#1e1e1e',
    foreground: '#d4d4d4',
    cursor: '#00ff00',
    cursorAccent: '#1e1e1e',
    selection: '#264f78',
    black: '#000000',
    red: '#cd0000',
    green: '#00cd00',
    yellow: '#cdcd00',
    blue: '#0000ee',
    magenta: '#cd00cd',
    cyan: '#00cdcd',
    white: '#e5e5e5',
    brightBlack: '#7f7f7f',
    brightRed: '#ff0000',
    brightGreen: '#00ff00',
    brightYellow: '#ffff00',
    brightBlue: '#5c5cff',
    brightMagenta: '#ff00ff',
    brightCyan: '#00ffff',
    brightWhite: '#ffffff',
  },
  solarized_dark: {
    background: '#002b36',
    foreground: '#839496',
    cursor: '#839496',
    cursorAccent: '#002b36',
    selection: '#073642',
    black: '#073642',
    red: '#dc322f',
    green: '#859900',
    yellow: '#b58900',
    blue: '#268bd2',
    magenta: '#d33682',
    cyan: '#2aa198',
    white: '#eee8d5',
    brightBlack: '#002b36',
    brightRed: '#cb4b16',
    brightGreen: '#586e75',
    brightYellow: '#657b83',
    brightBlue: '#839496',
    brightMagenta: '#6c71c4',
    brightCyan: '#93a1a1',
    brightWhite: '#fdf6e3',
  },
  dracula: {
    background: '#282a36',
    foreground: '#f8f8f2',
    cursor: '#f8f8f2',
    cursorAccent: '#282a36',
    selection: '#44475a',
    black: '#21222c',
    red: '#ff5555',
    green: '#50fa7b',
    yellow: '#f1fa8c',
    blue: '#bd93f9',
    magenta: '#ff79c6',
    cyan: '#8be9fd',
    white: '#f8f8f2',
    brightBlack: '#6272a4',
    brightRed: '#ff6e6e',
    brightGreen: '#69ff94',
    brightYellow: '#ffffa5',
    brightBlue: '#d6acff',
    brightMagenta: '#ff92df',
    brightCyan: '#a4ffff',
    brightWhite: '#ffffff',
  },
  github_light: {
    background: '#ffffff',
    foreground: '#24292e',
    cursor: '#24292e',
    cursorAccent: '#ffffff',
    selection: '#e1e4e8',
    black: '#24292e',
    red: '#d73a49',
    green: '#28a745',
    yellow: '#b08800',
    blue: '#0366d6',
    magenta: '#6f42c1',
    cyan: '#1b7c83',
    white: '#f6f8fa',
    brightBlack: '#586069',
    brightRed: '#cb2431',
    brightGreen: '#22863a',
    brightYellow: '#dbab09',
    brightBlue: '#2188ff',
    brightMagenta: '#8b5cf6',
    brightCyan: '#3192aa',
    brightWhite: '#ffffff',
  },
};

export function getThemeByName(themeName: string): ITerminalTheme {
  return themes[themeName] || themes.VibeTunnel;
}
