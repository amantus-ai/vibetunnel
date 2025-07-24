export interface TmuxSession {
  name: string;
  windows: number;
  created: string;
  attached: boolean;
  activity?: string;
  current?: boolean;
}

export interface TmuxWindow {
  session: string;
  index: number;
  name: string;
  active: boolean;
  panes: number;
}

export interface TmuxPane {
  session: string;
  window: number;
  index: number;
  active: boolean;
  title?: string;
  pid?: number;
  command?: string;
  width: number;
  height: number;
  currentPath?: string;
}

export interface TmuxTarget {
  session: string;
  window?: number;
  pane?: number;
}
