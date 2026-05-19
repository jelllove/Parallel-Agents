export interface Project {
  id: string;
  dirName: string;
  realPath: string;
  displayName: string;
  exists: boolean;
  pinned: boolean;
  hidden: boolean;
  sessionCount: number;
  lastActivity: number | null;
}

export interface Session {
  id: string;
  projectId: string;
  title: string;
  timestamp: number;
  cwd: string | null;
  gitBranch: string | null;
  version: string | null;
}

export interface FsNode {
  name: string;
  path: string;
  isDirectory: boolean;
  children?: FsNode[];
}

export interface PtySpawnOptions {
  projectId: string;
  cwd: string;
  cols: number;
  rows: number;
  initialCommand?: string;
}

export interface AppConfig {
  pinned: string[];
  hidden: string[];
}

export interface Api {
  projects: {
    list(): Promise<Project[]>;
    pin(id: string, pinned: boolean): Promise<void>;
    hide(id: string, hidden: boolean): Promise<void>;
  };
  sessions: {
    listForProject(projectId: string): Promise<Session[]>;
  };
  pty: {
    spawn(opts: PtySpawnOptions): Promise<void>;
    write(projectId: string, data: string): Promise<void>;
    resize(projectId: string, cols: number, rows: number): Promise<void>;
    kill(projectId: string): Promise<void>;
    onData(cb: (projectId: string, data: string) => void): () => void;
    onExit(cb: (projectId: string, code: number) => void): () => void;
  };
  fs: {
    readDir(path: string): Promise<FsNode[]>;
  };
  dialog: {
    pickDirectory(): Promise<string | null>;
  };
  claude: {
    check(): Promise<{ available: boolean; path: string | null }>;
  };
  shell: {
    openExternal(url: string): Promise<void>;
  };
  window: {
    onFullscreenChange(cb: (fullscreen: boolean) => void): () => void;
  };
}

declare global {
  interface Window {
    api: Api;
  }
}
