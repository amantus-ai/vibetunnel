declare module 'ps-tree' {
  function psTree(
    pid: number,
    callback: (error: Error | null, children: ProcessInfo[]) => void
  ): void;
  namespace psTree {
    interface ProcessInfo {
      PID: string;
      PPID: string;
      COMMAND: string;
      STAT: string;
    }
  }
  export = psTree;
}
