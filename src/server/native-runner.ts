import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { constants, type Stats } from 'node:fs';
import {
  access,
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
  rename,
  rmdir,
  unlink,
} from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { ApprovalStore, canonicalJson, type ApprovalRecord } from './approval.js';
import { redactSdkText } from './safety.js';
import {
  RunnerError,
  RUNNER_LIMITS,
  TEXT_EXTENSION,
  validateAction,
  validateRelativePath,
  validateText,
  type RunnerAction,
  type BoundRunnerAction,
  type SnapshotInfo,
  type RunnerResult,
  type ProcessResult,
  type ProcessExecutor,
} from './runner-policy.js';
export { RunnerError, RUNNER_LIMITS } from './runner-policy.js';

type File = { content: string; stamp: string; mode: number };
type Snapshot = {
  files: Map<string, File>;
  directories: Map<string, string>;
  digest: string;
  totalBytes: number;
  excluded: string[];
};
const stamp = (s: Stats) => `${s.dev}:${s.ino}:${s.size}:${s.mtimeMs}:${s.ctimeMs}:${s.nlink}`;
const identity = (s: Stats) => `${s.dev}:${s.ino}`;
const missing = (e: unknown) => (e as NodeJS.ErrnoException).code === 'ENOENT';
const changed = () =>
  new RunnerError('STALE_APPROVAL', 'Workspace changed; request a new approval.');
// This lock covers every runner in this server, including separate selected workspaces.
let executing = false;

/** Portable checks are best effort against concurrent local processes, not an OS sandbox. */
async function directories(absolute: string, allowMissing = false): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  let current = path.parse(absolute).root;
  for (const part of absolute.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    let s: Stats;
    try {
      s = await lstat(current);
    } catch (error) {
      if (allowMissing && missing(error)) break;
      throw error;
    }
    if (!s.isDirectory() || s.isSymbolicLink())
      throw new RunnerError('UNSAFE_PATH', 'Directory symlinks and special files are not allowed.');
    result.set(current, identity(s));
  }
  return result;
}
async function verifyDirectories(expected: Map<string, string>): Promise<void> {
  for (const [name, id] of expected) {
    const s = await lstat(name);
    if (!s.isDirectory() || s.isSymbolicLink() || identity(s) !== id) throw changed();
  }
}
async function readText(name: string): Promise<File> {
  const handle = await open(name, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.nlink !== 1)
      throw new RunnerError('INVALID_FILE', 'Only regular files with one link are allowed.');
    if (before.size > RUNNER_LIMITS.fileBytes)
      throw new RunnerError('SNAPSHOT_LIMIT', 'A source file exceeds the file-size limit.');
    const bytes = Buffer.alloc(RUNNER_LIMITS.fileBytes + 1);
    let count = 0;
    while (count < bytes.length) {
      const read = await handle.read(bytes, count, bytes.length - count, null);
      if (!read.bytesRead) break;
      count += read.bytesRead;
    }
    if (stamp(before) !== stamp(await handle.stat()) || count !== before.size) throw changed();
    const content = bytes.subarray(0, count).toString('utf8');
    if (!Buffer.from(content).equals(bytes.subarray(0, count)))
      throw new RunnerError('INVALID_FILE', 'Only UTF-8 text files are allowed.');
    validateText(content);
    return { content, stamp: stamp(before), mode: before.mode & 0o777 };
  } finally {
    await handle.close();
  }
}
async function capture(root: string): Promise<Snapshot> {
  if (
    root === path.parse(root).root ||
    root === homedir() ||
    ['/tmp', '/private/tmp', '/Users', '/home', '/workspace'].includes(root) ||
    root
      .split(path.sep)
      .some(
        (part) =>
          part.startsWith('.') || /^(?:etc|proc|sys|dev|root|secrets?|credentials?)$/i.test(part),
      )
  ) {
    throw new RunnerError(
      'UNSAFE_WORKSPACE',
      'Select a specific project directory, without hidden or system paths.',
    );
  }
  const parents = await directories(root);
  if ((await realpath(root)) !== root)
    throw new RunnerError(
      'UNSAFE_WORKSPACE',
      'Select the real project directory, without symlinks.',
    );
  const files = new Map<string, File>(),
    dirs = new Map<string, string>(),
    excluded: string[] = [];
  let visited = 0,
    totalBytes = 0;
  async function walk(dir: string, prefix: string): Promise<void> {
    const before = await lstat(dir);
    if (!before.isDirectory() || before.isSymbolicLink()) throw changed();
    dirs.set(prefix, stamp(before));
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (++visited > 4096)
        throw new RunnerError('SNAPSHOT_LIMIT', 'Workspace has too many entries.');
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      try {
        validateRelativePath(relative);
      } catch {
        excluded.push(relative);
        continue;
      }
      const full = path.join(root, relative);
      if (entry.isSymbolicLink()) {
        excluded.push(relative);
        continue;
      }
      if (entry.isDirectory()) {
        if (relative.split('/').length > 12)
          throw new RunnerError('SNAPSHOT_LIMIT', 'Workspace nesting is too deep.');
        await walk(full, relative);
        continue;
      }
      if (!entry.isFile() || !TEXT_EXTENSION.test(relative)) {
        excluded.push(relative);
        continue;
      }
      try {
        const file = await readText(full);
        totalBytes += Buffer.byteLength(file.content);
        if (totalBytes > RUNNER_LIMITS.snapshotBytes || files.size >= RUNNER_LIMITS.files)
          throw new RunnerError(
            'SNAPSHOT_LIMIT',
            'Workspace exceeds the snapshot size or file count.',
          );
        files.set(relative, file);
      } catch (error) {
        if (error instanceof RunnerError && ['INVALID_FILE', 'SECRET_CONTENT'].includes(error.code))
          excluded.push(relative);
        else throw error;
      }
    }
    if (stamp(before) !== stamp(await lstat(dir))) throw changed();
  }
  await walk(root, '');
  await verifyDirectories(parents);
  const digest = createHash('sha256')
    .update(
      canonicalJson({
        root,
        parents: [...parents],
        directories: [...dirs],
        files: [...files],
        excluded,
      }),
    )
    .digest('hex');
  return { files, directories: dirs, digest, totalBytes, excluded };
}

function safeOutput(
  stdout: string,
  stderr: string,
  limit: number,
): { stdout: string; stderr: string } {
  let remaining = limit;
  const take = (value: string) => {
    const redacted = redactSdkText(value);
    let result = Buffer.from(redacted).subarray(0, remaining).toString('utf8');
    while (Buffer.byteLength(result) > remaining) result = result.slice(0, -1);
    remaining -= Buffer.byteLength(result);
    return result;
  };
  return { stdout: take(stdout), stderr: take(stderr) };
}
/** Only ordinary tool-discovery settings enter children; API keys and loader hooks do not. */
function localEnvironment(): Record<string, string> {
  const searchPath = (process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin')
    .split(path.delimiter)
    .filter((entry) => path.isAbsolute(entry) && !/[\u0000-\u001f\u007f]/.test(entry))
    .join(path.delimiter);
  const env: Record<string, string> = {
    PATH: searchPath,
    HOME: homedir(),
    TMPDIR: tmpdir(),
    LANG: 'en_US.UTF-8',
  };
  for (const name of ['LANG', 'LC_ALL', 'LC_CTYPE']) {
    const value = process.env[name];
    if (value && /^[A-Za-z0-9_.@-]{1,80}$/.test(value)) env[name] = value;
  }
  return Object.freeze(env);
}
async function resolveExecutable(
  executable: string,
  searchPath: string,
): Promise<{ path: string; identity: string }> {
  const candidates = path.isAbsolute(executable)
    ? [executable]
    : searchPath
        .split(path.delimiter)
        .filter(Boolean)
        .map((dir) => path.join(dir, executable));
  for (const candidate of candidates) {
    try {
      // Preserve invocation spelling for virtual environments and multicall tools; bind the target identity too.
      const resolved = await realpath(candidate),
        stat = await lstat(resolved);
      if (!stat.isFile()) continue;
      await access(resolved, constants.X_OK);
      return {
        path: path.resolve(candidate),
        identity: createHash('sha256')
          .update(canonicalJson({ target: resolved, stamp: stamp(stat), mode: stat.mode }))
          .digest('hex'),
      };
    } catch {
      /* Try the next server PATH entry without exposing filesystem errors. */
    }
  }
  throw new RunnerError(
    'EXECUTABLE_NOT_FOUND',
    'Executable was not found or is not executable on this machine.',
  );
}
/** No implicit shell or arbitrary inherited environment. Approved tools retain user privileges. */
export function createNativeProcessExecutor(
  spawnProcess: typeof spawn = spawn,
  environment = localEnvironment(),
): ProcessExecutor {
  return (executable, args, options) =>
    new Promise((resolve) => {
      if (options.signal?.aborted)
        return resolve({
          exitCode: null,
          stdout: '',
          stderr: '',
          termination: 'cancelled',
          cleanupSucceeded: true,
        });
      let child: ReturnType<typeof spawn>;
      try {
        child = spawnProcess(executable, [...args], {
          cwd: options.cwd,
          shell: false,
          detached: true,
          stdio: ['ignore', 'pipe', 'pipe'],
          env: environment,
        });
      } catch {
        return resolve({
          exitCode: null,
          stdout: '',
          stderr: '',
          error: 'Could not start local command.',
          cleanupSucceeded: true,
        });
      }
      const chunks: { stdout: Buffer[]; stderr: Buffer[] } = { stdout: [], stderr: [] };
      let bytes = 0,
        settled = false,
        termination: ProcessResult['termination'];
      let fallback: ReturnType<typeof setTimeout> | undefined;
      let cleanupSucceeded = true,
        groupStopped = false;
      const killGroup = () => {
        if (!child.pid || groupStopped) return;
        try {
          process.kill(-child.pid, 'SIGKILL');
          groupStopped = true;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ESRCH') groupStopped = true;
          else cleanupSucceeded = false;
        }
      };
      const finish = (exitCode: number | null, error?: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        clearTimeout(fallback);
        options.signal?.removeEventListener('abort', abort);
        killGroup(); // Also stop ordinary children left behind when the main process exits.
        resolve({
          exitCode,
          ...safeOutput(
            Buffer.concat(chunks.stdout).toString('utf8'),
            Buffer.concat(chunks.stderr).toString('utf8'),
            options.maxOutputBytes,
          ),
          termination,
          error,
          cleanupSucceeded,
        });
      };
      const stop = (reason: NonNullable<ProcessResult['termination']>) => {
        if (settled || termination) return;
        termination = reason;
        killGroup();
        fallback = setTimeout(() => {
          cleanupSucceeded = false;
          finish(null);
        }, 1000);
      };
      const abort = () => stop('cancelled');
      const timer = setTimeout(() => stop('timeout'), options.timeoutMs);
      for (const name of ['stdout', 'stderr'] as const)
        child[name]?.on('data', (chunk: Buffer) => {
          const available = Math.max(0, options.maxOutputBytes - bytes);
          chunks[name].push(chunk.subarray(0, available));
          bytes += Math.min(chunk.length, available);
          if (chunk.length > available) stop('output_limit');
        });
      child.once('error', () => finish(null, 'Could not start local command.'));
      child.once('exit', killGroup);
      child.once('close', (code) => finish(code));
      options.signal?.addEventListener('abort', abort, { once: true });
      if (options.signal?.aborted) abort();
    });
}

export class NativeWorkspaceRunner {
  readonly approvals: ApprovalStore;
  readonly #root: string;
  readonly #process: ProcessExecutor;
  readonly #environment = localEnvironment();
  readonly #snapshots = new Map<string, Snapshot>();
  readonly #prepared = new Map<
    string,
    { runId: string; action: RunnerAction; bound: BoundRunnerAction }
  >();
  readonly #closed = new Set<string>();
  #active?: { runId: string; controller: AbortController; drain: Promise<void> };
  #shuttingDown = false;
  #cleanupBlocked = false;
  constructor(options: {
    workspaceRoot: string;
    approvals?: ApprovalStore;
    executeProcess?: ProcessExecutor;
  }) {
    if (!options.workspaceRoot || !path.isAbsolute(options.workspaceRoot))
      throw new RunnerError('UNSAFE_WORKSPACE', 'Choose an absolute project directory.');
    this.#root = path.resolve(options.workspaceRoot);
    this.approvals = options.approvals ?? new ApprovalStore();
    this.#process = options.executeProcess ?? createNativeProcessExecutor(spawn, this.#environment);
  }
  private assertOpen(runId: string): void {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(runId))
      throw new RunnerError('INVALID_RUN', 'Invalid run ID.');
    if (process.platform !== 'darwin' && process.platform !== 'linux')
      throw new RunnerError('PLATFORM_UNSUPPORTED', 'Native execution supports macOS and Linux.');
    if (this.#shuttingDown || this.#closed.has(runId))
      throw new RunnerError('RUN_CLOSED', 'Run has been closed.');
  }
  private async current(runId: string): Promise<Snapshot> {
    this.assertOpen(runId);
    if (!this.#snapshots.has(runId) && this.#snapshots.size >= RUNNER_LIMITS.runs)
      throw new RunnerError('CAPACITY', 'Too many live run snapshots.');
    const snapshot = await capture(this.#root);
    this.assertOpen(runId);
    this.#snapshots.set(runId, snapshot);
    return snapshot;
  }
  async checkAvailability(): Promise<{ available: boolean; reason?: string }> {
    if (this.#shuttingDown || this.#cleanupBlocked)
      return {
        available: false,
        reason: 'Execution is closed; restart the server after reviewing the last command.',
      };
    if (process.platform !== 'darwin' && process.platform !== 'linux')
      return { available: false, reason: 'Native execution supports macOS and Linux.' };
    try {
      await capture(this.#root);
      return { available: true };
    } catch (error) {
      return {
        available: false,
        reason: error instanceof RunnerError ? error.message : 'Selected workspace is unavailable.',
      };
    }
  }
  async snapshot(runId: string): Promise<SnapshotInfo> {
    const s = await this.current(runId);
    return {
      runId,
      digest: s.digest,
      files: [...s.files.keys()],
      totalBytes: s.totalBytes,
      excluded: [...s.excluded],
    };
  }
  async readFile(runId: string, name: string): Promise<string> {
    validateRelativePath(name);
    const s = await this.current(runId);
    const file = s.files.get(name);
    if (!file)
      throw new RunnerError('FILE_NOT_FOUND', 'File is missing or excluded from the workspace.');
    return file.content;
  }
  private async validateTargets(action: RunnerAction, snapshot: Snapshot): Promise<void> {
    if (action.kind === 'edit') {
      await directories(path.dirname(path.join(this.#root, action.path)), true);
      if (!snapshot.files.has(action.path)) {
        try {
          await lstat(path.join(this.#root, action.path));
        } catch (error) {
          if (missing(error)) return;
          throw error;
        }
        throw new RunnerError('INVALID_FILE', 'An excluded or special file cannot be overwritten.');
      }
      return;
    }
    const cwd = action.cwd && action.cwd !== '.' ? action.cwd : '';
    if (!snapshot.directories.has(cwd))
      throw new RunnerError('UNSAFE_PATH', 'Command directory must be in the selected workspace.');
    // Arguments may refer to host resources: the exact command is approved, not sandboxed.
  }

  async prepare(runId: string, input: unknown): Promise<ApprovalRecord<BoundRunnerAction>> {
    const action = validateAction(input),
      s = await this.current(runId);
    await this.validateTargets(action, s);
    this.assertOpen(runId);
    if (
      action.kind === 'edit' &&
      (s.totalBytes -
        Buffer.byteLength(s.files.get(action.path)?.content ?? '') +
        Buffer.byteLength(action.content) >
        RUNNER_LIMITS.snapshotBytes ||
        (!s.files.has(action.path) && s.files.size >= RUNNER_LIMITS.files))
    ) {
      throw new RunnerError('SNAPSHOT_LIMIT', 'Edit exceeds workspace limits.');
    }
    const resolvedExecutable =
      action.kind === 'command'
        ? await resolveExecutable(action.executable, this.#environment.PATH!)
        : null;
    this.assertOpen(runId);
    const bound: BoundRunnerAction = {
      ...action,
      workspaceRoot: this.#root,
      snapshotDigest: s.digest,
      policyVersion: 'native-2',
      resolvedExecutable,
    };
    const record = this.approvals.request(runId, bound);
    this.#prepared.set(record.id, { runId, action, bound });
    return record;
  }
  private async write(
    action: Extract<RunnerAction, { kind: 'edit' }>,
    snapshot: Snapshot,
    signal: AbortSignal,
  ): Promise<void> {
    const target = path.join(this.#root, action.path),
      parent = path.dirname(target);
    const parents = await directories(this.#root),
      before = snapshot.files.get(action.path);
    const createdDirectories: string[] = [];
    let committed = false;
    const temp = path.join(parent, `.tinkerfleet-${randomUUID()}.tmp`);
    let created = false;
    try {
      // Create one component at a time, checking every existing ancestor and rejecting links.
      let current = this.#root;
      for (const component of path.relative(this.#root, parent).split(path.sep).filter(Boolean)) {
        await verifyDirectories(parents);
        current = path.join(current, component);
        try {
          await lstat(current);
        } catch (error) {
          if (!missing(error)) throw error;
          if (signal.aborted)
            throw new RunnerError('CANCELLED', 'Action cancelled before writing.');
          await mkdir(current, { mode: 0o755 });
          createdDirectories.push(current);
        }
        const stat = await lstat(current);
        if (!stat.isDirectory() || stat.isSymbolicLink()) throw changed();
        parents.set(current, identity(stat));
      }
      const handle = await open(
        temp,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
        before?.mode ?? 0o600,
      );
      created = true;
      try {
        await handle.writeFile(action.content, 'utf8');
        await handle.sync();
      } finally {
        await handle.close();
      }
      await verifyDirectories(parents);
      if (before) {
        if (
          stamp(await lstat(target)) !== before.stamp ||
          (await readText(target)).stamp !== before.stamp
        )
          throw changed();
      } else {
        try {
          await lstat(target);
          throw changed();
        } catch (error) {
          if (!missing(error)) throw error;
        }
      }
      if (signal.aborted) throw new RunnerError('CANCELLED', 'Action cancelled before writing.');
      // Atomic replacement; ancestor checks cannot eliminate hostile-process races on macOS.
      await rename(temp, target);
      created = false;
      committed = true;
    } finally {
      if (created)
        await unlink(temp).catch(() => {
          this.#cleanupBlocked = true;
        });
      if (!committed)
        for (const directory of createdDirectories.reverse()) {
          // Only remove our own still-empty directories; never remove another process's changes.
          try {
            await verifyDirectories(parents);
            await rmdir(directory);
            parents.delete(directory);
          } catch {
            break;
          }
        }
    }
  }
  async execute(
    runId: string,
    approvalId: string,
    options: { signal?: AbortSignal } = {},
  ): Promise<RunnerResult> {
    this.assertOpen(runId);
    if (executing) throw new RunnerError('RUN_BUSY', 'Another local action is executing.');
    if (this.#cleanupBlocked)
      throw new RunnerError(
        'EXECUTION_BLOCKED',
        'Prior process cleanup was not confirmed; restart after review.',
      );
    const prepared = this.#prepared.get(approvalId);
    if (!prepared || prepared.runId !== runId)
      throw new RunnerError('UNKNOWN_ACTION', 'Unknown prepared action for this run.');
    executing = true;
    const controller = new AbortController(),
      abort = () => controller.abort();
    options.signal?.addEventListener('abort', abort, { once: true });
    if (options.signal?.aborted) abort();
    let finish!: () => void;
    const drain = new Promise<void>((resolve) => {
      finish = resolve;
    });
    this.#active = { runId, controller, drain };
    const started = Date.now();
    try {
      const s = await this.current(runId);
      if (s.digest !== prepared.bound.snapshotDigest) {
        const record = this.approvals.get(approvalId);
        if (record?.status === 'pending' || record?.status === 'approved')
          this.approvals.deny(approvalId);
        this.#prepared.delete(approvalId);
        throw changed();
      }
      await this.validateTargets(prepared.action, s);
      this.assertOpen(runId);
      if (prepared.action.kind === 'command') {
        let resolved;
        try {
          resolved = await resolveExecutable(prepared.action.executable, this.#environment.PATH!);
        } catch {
          resolved = null;
        }
        if (canonicalJson(resolved) !== canonicalJson(prepared.bound.resolvedExecutable)) {
          const record = this.approvals.get(approvalId);
          if (record?.status === 'pending' || record?.status === 'approved')
            this.approvals.deny(approvalId);
          this.#prepared.delete(approvalId);
          throw new RunnerError(
            'EXECUTABLE_CHANGED',
            'The executable changed since review; request a new approval.',
          );
        }
        this.assertOpen(runId);
      }
      this.approvals.consume(approvalId, runId, prepared.bound);
      this.#prepared.delete(approvalId);
      let outcome: ProcessResult;
      const action = prepared.action;
      if (controller.signal.aborted)
        outcome = { exitCode: null, stdout: '', stderr: '', termination: 'cancelled' };
      else if (action.kind === 'edit') {
        await this.write(action, s, controller.signal);
        outcome = { exitCode: 0, stdout: `Updated ${action.path}\n`, stderr: '' };
      } else {
        const cwd = path.join(this.#root, action.cwd ?? '.');
        const executable = prepared.bound.resolvedExecutable!.path;
        outcome = await this.#process(executable, action.args, {
          cwd,
          signal: controller.signal,
          timeoutMs: RUNNER_LIMITS.timeoutMs,
          maxOutputBytes: RUNNER_LIMITS.outputBytes,
        });
      }
      const cleanupSucceeded = outcome.cleanupSucceeded !== false && !this.#cleanupBlocked;
      if (!cleanupSucceeded) this.#cleanupBlocked = true;
      let digest = s.digest;
      try {
        const next = await capture(this.#root);
        digest = next.digest;
        if (!this.#closed.has(runId)) this.#snapshots.set(runId, next);
      } catch {
        outcome = {
          ...outcome,
          error: 'Workspace could not be inspected after the action. Review local changes.',
        };
      }
      return {
        runId,
        approvalId,
        kind: action.kind,
        status:
          outcome.termination ??
          (outcome.exitCode === 0 && !outcome.error && cleanupSucceeded ? 'completed' : 'failed'),
        exitCode: outcome.exitCode,
        ...safeOutput(
          outcome.stdout,
          outcome.stderr + (outcome.error ? `\n${outcome.error}` : ''),
          RUNNER_LIMITS.outputBytes,
        ),
        durationMs: Date.now() - started,
        snapshotDigest: digest,
        cleanupSucceeded,
      };
    } finally {
      executing = false;
      this.#active = undefined;
      finish();
      options.signal?.removeEventListener('abort', abort);
    }
  }
  cancel(runId: string): void {
    this.#closed.add(runId);
    this.#snapshots.delete(runId);
    if (this.#active?.runId === runId) this.#active.controller.abort();
    this.approvals.invalidateRun(runId);
    for (const [id, p] of this.#prepared) if (p.runId === runId) this.#prepared.delete(id);
  }
  async cancelAndWait(runId: string): Promise<{ cleanupSucceeded: boolean }> {
    const drain = this.#active?.runId === runId ? this.#active.drain : undefined;
    this.cancel(runId);
    await drain;
    return { cleanupSucceeded: !this.#cleanupBlocked };
  }
  disposeRun(runId: string): void {
    this.cancel(runId);
  }
  async shutdown(): Promise<{ cleanupSucceeded: boolean }> {
    this.#shuttingDown = true;
    const drain = this.#active?.drain;
    for (const id of new Set([
      ...this.#snapshots.keys(),
      ...[...this.#prepared.values()].map((p) => p.runId),
      ...(this.#active ? [this.#active.runId] : []),
    ]))
      this.cancel(id);
    await drain;
    return { cleanupSucceeded: !this.#cleanupBlocked };
  }
}
