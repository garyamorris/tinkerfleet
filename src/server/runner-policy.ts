import path from 'node:path';
import { canonicalJson } from './approval.js';
import { containsSecret } from './safety.js';

export type CommandAction = { kind: 'command'; executable: string; args: string[]; cwd?: string };
export type EditAction = { kind: 'edit'; path: string; content: string };
export type RunnerAction = CommandAction | EditAction;
export type BoundRunnerAction = RunnerAction & {
  snapshotDigest: string;
  workspaceRoot: string;
  policyVersion: 'native-2';
  resolvedExecutable: { path: string; identity: string } | null;
};
export interface SnapshotInfo {
  runId: string;
  digest: string;
  files: string[];
  totalBytes: number;
  excluded: string[];
}
export interface RunnerResult {
  runId: string;
  approvalId: string;
  kind: RunnerAction['kind'];
  status: 'completed' | 'failed' | 'cancelled' | 'timeout' | 'output_limit';
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  snapshotDigest: string;
  cleanupSucceeded: boolean;
}
export interface ProcessOptions {
  cwd: string;
  signal?: AbortSignal;
  timeoutMs: number;
  maxOutputBytes: number;
}
export interface ProcessResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  termination?: 'cancelled' | 'timeout' | 'output_limit';
  error?: string;
  cleanupSucceeded?: boolean;
}
export type ProcessExecutor = (
  executable: string,
  args: readonly string[],
  options: ProcessOptions,
) => Promise<ProcessResult>;
export class RunnerError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'RunnerError';
  }
}
export const RUNNER_LIMITS = Object.freeze({
  timeoutMs: 15_000,
  outputBytes: 64 * 1024,
  files: 256,
  fileBytes: 256 * 1024,
  snapshotBytes: 2 * 1024 * 1024,
  runs: 32,
});
const EXCLUDED_DIRECTORY =
  /^(?:node_modules|vendor|dist|build|coverage|secrets?|credentials?|__pycache__)$/i;
const SECRET_FILENAME =
  /(?:^|[._-])(?:secrets?|credentials?|passwords?|tokens?)(?:[._-]|$)|^id_(?:rsa|dsa|ecdsa|ed25519)(?:\.|$)|\.(?:pem|key|p12|pfx|keystore|db|sqlite\d*|log)$/i;
export const TEXT_EXTENSION =
  /\.(?:[cm]?[jt]sx?|json|md|txt|css|html?|ya?ml|toml|csv|svg|py|sh|bash|zsh|sql|rs|go|java|c|cpp|h|hpp|xml|ini|conf)$/i;

export function isExcludedPath(relativePath: string): boolean {
  return relativePath
    .split('/')
    .some(
      (segment) =>
        segment.startsWith('.') ||
        EXCLUDED_DIRECTORY.test(segment) ||
        SECRET_FILENAME.test(segment),
    );
}
export function validateRelativePath(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 240 ||
    value.includes('\\') ||
    path.posix.isAbsolute(value)
  ) {
    throw new RunnerError('UNSAFE_PATH', 'Use a relative path inside the selected workspace.');
  }
  const parts = value.split('/');
  if (parts.length > 13)
    throw new RunnerError(
      'UNSAFE_PATH',
      'Workspace paths are limited to twelve nested directories.',
    );
  if (
    parts.some((part) => !/^[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(part) || part === '..') ||
    isExcludedPath(value)
  ) {
    throw new RunnerError(
      'UNSAFE_PATH',
      'Traversal, hidden files, credential paths, and special path syntax are not allowed.',
    );
  }
  return value;
}
export function validateText(content: unknown): asserts content is string {
  if (
    typeof content !== 'string' ||
    Buffer.byteLength(content) > RUNNER_LIMITS.fileBytes ||
    content.includes('\0') ||
    Buffer.from(content).toString('utf8') !== content
  ) {
    throw new RunnerError('INVALID_FILE', 'Only bounded text files can enter a run snapshot.');
  }
  if (containsSecret(content))
    throw new RunnerError(
      'SECRET_CONTENT',
      'Potential credential content cannot enter the run snapshot.',
    );
}
export function validateAction(value: unknown): RunnerAction {
  // Clone before validating, so caller mutations and getters cannot alter a prepared action.
  const action = JSON.parse(canonicalJson(value)) as Record<string, unknown>;
  if (!action || typeof action !== 'object' || Array.isArray(action))
    throw new RunnerError('INVALID_ACTION', 'Expected an action object.');
  if (action.kind === 'edit') {
    if (Object.keys(action).some((key) => !['kind', 'path', 'content'].includes(key)))
      throw new RunnerError('INVALID_ACTION', 'Unexpected edit field.');
    const relativePath = validateRelativePath(action.path);
    if (!TEXT_EXTENSION.test(relativePath))
      throw new RunnerError('INVALID_FILE', 'Only source and text file extensions are allowed.');
    validateText(action.content);
    return { kind: 'edit', path: relativePath, content: action.content };
  }
  if (
    action.kind !== 'command' ||
    Object.keys(action).some((key) => !['kind', 'executable', 'args', 'cwd'].includes(key))
  ) {
    throw new RunnerError('INVALID_ACTION', 'Expected a command or edit action.');
  }
  // argv is data. A shell runs only when the approved executable explicitly names one.
  if (
    typeof action.executable !== 'string' ||
    action.executable.length > 1024 ||
    /[\u0000-\u001f\u007f]/.test(action.executable) ||
    !(
      path.isAbsolute(action.executable) || /^[A-Za-z0-9_][A-Za-z0-9_.+-]*$/.test(action.executable)
    ) ||
    !Array.isArray(action.args) ||
    action.args.length > 128 ||
    action.args.some(
      (arg) =>
        typeof arg !== 'string' ||
        arg.length > 8192 ||
        /[\u0000-\u0008\u000b-\u001f\u007f]/.test(arg),
    ) ||
    Buffer.byteLength(canonicalJson(action.args)) > 64 * 1024
  ) {
    throw new RunnerError(
      'INVALID_COMMAND',
      'Use an installed command name or absolute executable path and a bounded argument array.',
    );
  }
  const args = action.args as string[];
  if (containsSecret(action.executable) || args.some((arg) => containsSecret(arg))) {
    throw new RunnerError('SECRET_CONTENT', 'Do not put credentials in command arguments.');
  }
  const cwd =
    action.cwd === undefined
      ? undefined
      : action.cwd === '.'
        ? '.'
        : validateRelativePath(action.cwd);
  return {
    kind: 'command',
    executable: action.executable as CommandAction['executable'],
    args: [...args],
    ...(cwd ? { cwd } : {}),
  };
}
