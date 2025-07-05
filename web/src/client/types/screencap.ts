// Screen capture types

export interface WindowInfo {
  cgWindowID: number;
  title: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ProcessGroup {
  processName: string;
  pid: number;
  bundleIdentifier: string | null;
  iconData: string | null; // Base64 encoded PNG
  windows: WindowInfo[];
}

export interface DisplayInfo {
  id: string;
  width: number;
  height: number;
  scaleFactor: number;
  refreshRate: number;
  x: number;
  y: number;
  name: string | null;
}
