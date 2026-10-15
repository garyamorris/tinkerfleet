import path from 'node:path';
import {canonicalJson} from './approval.js';
import {redactSdkText} from './safety.js';

export type CommandAction = { kind: 'command'; executable: 'node' | 'ls' | 'cat'; args: string[]; cwd?: string };
export type EditAction = { kind: 'edit'; path: string; content: string };
export type RunnerAction = CommandAction | EditAction;
export type BoundRunnerAction = RunnerAction & { snapshotDigest: string; workspaceRoot: string; policyVersion: 'native-1' };
export interface SnapshotInfo { runId: string; digest: string; files: string[]; totalBytes: number; excluded: string[] }
export interface RunnerResult {
  runId: string; approvalId: string; kind: RunnerAction['kind'];
  status: 'completed' | 'failed' | 'cancelled' | 'timeout' | 'output_limit';
  exitCode: number | null; stdout: string; stderr: string; durationMs: number;
  snapshotDigest: string; cleanupSucceeded: boolean;
}
export interface ProcessOptions { cwd: string; signal?: AbortSignal; timeoutMs: number; maxOutputBytes: number }
export interface ProcessResult {
  exitCode: number | null; stdout: string; stderr: string;
  termination?: 'cancelled' | 'timeout' | 'output_limit'; error?: string; cleanupSucceeded?: boolean;
}
export type ProcessExecutor = (executable: string, args: readonly string[], options: ProcessOptions) => Promise<ProcessResult>;
export class RunnerError extends Error {
  constructor(public readonly code: string, message: string) { super(message); this.name = 'RunnerError'; }
}
export const RUNNER_LIMITS = Object.freeze({
  timeoutMs: 15_000, outputBytes: 64 * 1024, files: 256, fileBytes: 256 * 1024,
  snapshotBytes: 2 * 1024 * 1024, runs: 32,
});
const EXCLUDED_DIRECTORY = /^(?:node_modules|vendor|dist|build|coverage|secrets?|credentials?|__pycache__)$/i;
const SECRET_FILENAME = /(?:^|[._-])(?:secrets?|credentials?|passwords?|tokens?)(?:[._-]|$)|^id_(?:rsa|dsa|ecdsa|ed25519)(?:\.|$)|\.(?:pem|key|p12|pfx|keystore|db|sqlite\d*|log)$/i;
export const TEXT_EXTENSION = /\.(?:[cm]?[jt]sx?|json|md|txt|css|html?|ya?ml|toml|csv|svg)$/i;
const SECRET_CONTENT = /-----BEGIN (?:[A-Z ]*PRIVATE KEY)-----|\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}|\bAKIA[A-Z0-9]{16}\b|\b(?:ghp|gho|ghu|ghs|github_pat)_[A-Za-z0-9_]{20,}|\b(?:api[_-]?key|access[_-]?token|client[_-]?secret|password)\s*[:=]\s*["'][^"'\s]{12,}["']/i;

export function isExcludedPath(relativePath: string): boolean {
  return relativePath.split('/').some(segment => segment.startsWith('.') || EXCLUDED_DIRECTORY.test(segment) || SECRET_FILENAME.test(segment));
}
export function validateRelativePath(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 240 || value.includes('\\') || path.posix.isAbsolute(value)) {
    throw new RunnerError('UNSAFE_PATH', 'Use a relative path inside the selected workspace.');
  }
  const parts = value.split('/');
  if (parts.some(part => !/^[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(part) || part === '..') || isExcludedPath(value)) {
    throw new RunnerError('UNSAFE_PATH', 'Traversal, hidden files, credential paths, and special path syntax are not allowed.');
  }
  return value;
}
export function validateText(content: unknown): asserts content is string {
  if (typeof content !== 'string' || Buffer.byteLength(content) > RUNNER_LIMITS.fileBytes || content.includes('\0') || Buffer.from(content).toString('utf8') !== content) {
    throw new RunnerError('INVALID_FILE', 'Only bounded text files can enter a run snapshot.');
  }
  if (SECRET_CONTENT.test(content) || redactSdkText(content) !== content) throw new RunnerError('SECRET_CONTENT', 'Potential credential content cannot enter the run snapshot.');
}
export function validateAction(value: unknown): RunnerAction {
  // Clone before validating, so caller mutations and getters cannot alter a prepared action.
  const action = JSON.parse(canonicalJson(value)) as Record<string, unknown>;
  if (!action || typeof action !== 'object' || Array.isArray(action)) throw new RunnerError('INVALID_ACTION', 'Expected an action object.');
  if (action.kind === 'edit') {
    if (Object.keys(action).some(key => !['kind', 'path', 'content'].includes(key))) throw new RunnerError('INVALID_ACTION', 'Unexpected edit field.');
    const relativePath = validateRelativePath(action.path);
    if (!TEXT_EXTENSION.test(relativePath)) throw new RunnerError('INVALID_FILE', 'Only source and text file extensions are allowed.');
    validateText(action.content);
    return { kind: 'edit', path: relativePath, content: action.content };
  }
  if (action.kind !== 'command' || Object.keys(action).some(key => !['kind', 'executable', 'args', 'cwd'].includes(key))) {
    throw new RunnerError('INVALID_ACTION', 'Expected a command or edit action.');
  }
  if (!['node', 'ls', 'cat'].includes(String(action.executable)) || !Array.isArray(action.args) || action.args.length > 32 ||
      action.args.some(arg => typeof arg !== 'string' || arg.length > 240 || /[\u0000-\u001f\u007f]/.test(arg))) {
    throw new RunnerError('COMMAND_NOT_ALLOWED', 'Only the explicit command and argv allowlist is supported.');
  }
  const args = action.args as string[];
  const safePaths = (values: string[]) => values.forEach(arg => validateRelativePath(arg));
  switch (action.executable) {
    case 'node':
      if (args.length === 1 && args[0] === '--version') break;
      if (args[0] === '--test' || args[0] === '--check') {
        if (args.length < 2 || (args[0] === '--check' && args.length !== 2)) throw new RunnerError('COMMAND_NOT_ALLOWED', 'Node checks and tests require explicit JavaScript files.');
        safePaths(args.slice(1));
        if (args.slice(1).some(arg => !/\.[cm]?js$/.test(arg))) throw new RunnerError('COMMAND_NOT_ALLOWED', 'Node accepts explicit JavaScript files only.');
      } else {
        if (args.length !== 1 || !/\.[cm]?js$/.test(args[0]!)) throw new RunnerError('COMMAND_NOT_ALLOWED', 'Use node FILE.js, node --test FILES, or node --check FILE.');
        safePaths(args);
      }
      break;
    case 'ls': safePaths(args); break;
    case 'cat':
      if (!args.length) throw new RunnerError('COMMAND_NOT_ALLOWED', 'cat requires an explicit snapshot file.');
      safePaths(args); break;
  }
  const cwd = action.cwd === undefined ? undefined : action.cwd === '.' ? '.' : validateRelativePath(action.cwd);
  return { kind: 'command', executable: action.executable as CommandAction['executable'], args: [...args], ...(cwd ? { cwd } : {}) };
}
