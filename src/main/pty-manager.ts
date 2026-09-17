import { spawn } from 'node-pty';
import { PtyManager } from './pty-session-manager.ts';

export const ptyManager = new PtyManager(spawn);
