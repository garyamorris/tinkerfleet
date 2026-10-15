import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, opendir, realpath, type FileHandle } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { ApprovalStore, canonicalJson, type ApprovalRecord } from './approval.js';

export type CommandAction = { kind: 'command'; executable: 'node' | 'npm' | 'ls' | 'cat'; args: string[]; cwd?: string };
export type EditAction = { kind: 'edit'; path: string; content: string };
export type RunnerAction = CommandAction | EditAction;
export type BoundRunnerAction = RunnerAction & { snapshotDigest: string; image: string; imageId: string | null; policyVersion: '1' };
export interface SnapshotInfo { runId: string; digest: string; files: string[]; totalBytes: number; excluded: string[] }
export interface RunnerResult {
  runId: string; approvalId: string; kind: RunnerAction['kind'];
  status: 'completed' | 'failed' | 'cancelled' | 'timeout' | 'output_limit';
  exitCode: number | null; stdout: string; stderr: string; durationMs: number;
  snapshotDigest: string; cleanupSucceeded: boolean;
}
export interface ProcessOptions { input?: string; signal?: AbortSignal; timeoutMs: number; maxOutputBytes: number }
export interface ProcessResult {
  exitCode: number | null; stdout: string; stderr: string;
  termination?: 'cancelled' | 'timeout' | 'output_limit'; error?: string;
}
export type ProcessExecutor = (executable: string, args: readonly string[], options: ProcessOptions) => Promise<ProcessResult>;
export class RunnerError extends Error {
  constructor(public readonly code: string, message: string) { super(message); this.name = 'RunnerError'; }
}
export const RUNNER_LIMITS = Object.freeze({
  timeoutMs: 15_000, outputBytes: 64 * 1024, files: 256, fileBytes: 256 * 1024,
  snapshotBytes: 2 * 1024 * 1024, runs: 32, workspaceBytes: 32 * 1024 * 1024,
});
const EXCLUDED_DIRECTORY = /^(?:node_modules|vendor|dist|build|coverage|secrets?|credentials?|__pycache__)$/i;
const SECRET_FILENAME = /(?:^|[._-])(?:secrets?|credentials?|passwords?|tokens?)(?:[._-]|$)|^id_(?:rsa|dsa|ecdsa|ed25519)(?:\.|$)|\.(?:pem|key|p12|pfx|keystore|db|sqlite\d*|log)$/i;
const TEXT_EXTENSION = /\.(?:[cm]?[jt]sx?|json|md|txt|css|html?|ya?ml|toml|csv|svg)$/i;
const SECRET_CONTENT = /-----BEGIN (?:[A-Z ]*PRIVATE KEY)-----|\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}|\bAKIA[A-Z0-9]{16}\b|\b(?:ghp|gho|ghu|ghs|github_pat)_[A-Za-z0-9_]{20,}|\b(?:api[_-]?key|access[_-]?token|client[_-]?secret|password)\s*[:=]\s*["'][^"'\s]{12,}["']/i;

export function isExcludedPath(relativePath: string): boolean {
  return relativePath.split('/').some(segment => segment.startsWith('.') || EXCLUDED_DIRECTORY.test(segment) || SECRET_FILENAME.test(segment));
}
export function validateRelativePath(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 240 || value.includes('\\') || path.posix.isAbsolute(value)) {
    throw new RunnerError('UNSAFE_PATH', 'Use a relative path inside the selected snapshot.');
  }
  const parts = value.split('/');
  if (parts.some(part => !/^[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(part) || part === '..') || isExcludedPath(value)) {
    throw new RunnerError('UNSAFE_PATH', 'Traversal, hidden files, credential paths, and special path syntax are not allowed.');
  }
  return value;
}
function validateText(content: unknown): asserts content is string {
  if (typeof content !== 'string' || Buffer.byteLength(content) > RUNNER_LIMITS.fileBytes || content.includes('\0') || Buffer.from(content).toString('utf8') !== content) {
    throw new RunnerError('INVALID_FILE', 'Only bounded text files can enter a run snapshot.');
  }
  if (SECRET_CONTENT.test(content)) throw new RunnerError('SECRET_CONTENT', 'Potential credential content cannot enter the run snapshot.');
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
  if (!['node', 'npm', 'ls', 'cat'].includes(String(action.executable)) || !Array.isArray(action.args) || action.args.length > 32 ||
      action.args.some(arg => typeof arg !== 'string' || arg.length > 240 || /[\u0000-\u001f\u007f]/.test(arg))) {
    throw new RunnerError('COMMAND_NOT_ALLOWED', 'Only the explicit command and argv allowlist is supported.');
  }
  const args = action.args as string[];
  const safePaths = (values: string[]) => values.forEach(arg => validateRelativePath(arg));
  switch (action.executable) {
    case 'node':
      if (args.length === 1 && args[0] === '--version') break;
      if (args[0] === '--test' || args[0] === '--check') {
        if (args[0] === '--check' && args.length !== 2) throw new RunnerError('COMMAND_NOT_ALLOWED', 'node --check needs one file.');
        safePaths(args.slice(1));
      } else {
        if (args.length !== 1 || !/\.[cm]?js$/.test(args[0]!)) throw new RunnerError('COMMAND_NOT_ALLOWED', 'Use node FILE.js, node --test [FILES], or node --check FILE.');
        safePaths(args);
      }
      break;
    case 'npm':
      if (JSON.stringify(args) !== '["test"]' && JSON.stringify(args) !== '["run","test"]') throw new RunnerError('COMMAND_NOT_ALLOWED', 'Only npm test or npm run test is allowed.');
      break;
    case 'ls': safePaths(args); break;
    case 'cat':
      if (!args.length) throw new RunnerError('COMMAND_NOT_ALLOWED', 'cat requires an explicit snapshot file.');
      safePaths(args); break;
  }
  const cwd = action.cwd === undefined ? undefined : action.cwd === '.' ? '.' : validateRelativePath(action.cwd);
  return { kind: 'command', executable: action.executable as CommandAction['executable'], args: [...args], ...(cwd ? { cwd } : {}) };
}

type Snapshot = { runId: string; files: Map<string, string>; digest: string; totalBytes: number; excluded: string[] };
function digestFiles(files: Map<string, string>): string {
  return createHash('sha256').update(canonicalJson([...files].sort(([a], [b]) => a.localeCompare(b)))).digest('hex');
}


/** Portable archive-as-data format. It never extracts archives or opens named host paths. */
export interface SnapshotManifest { version: 1; files: ReadonlyArray<Readonly<{ path: string; content: string }>> }
export function parseSnapshotManifest(input: string | unknown): SnapshotManifest {
  if (typeof input === 'string' && Buffer.byteLength(input) > 16 * 1024 * 1024) throw new RunnerError('SNAPSHOT_LIMIT', 'Snapshot manifest is too large.');
  let candidate: unknown;
  try { candidate = typeof input === 'string' ? JSON.parse(input) : JSON.parse(canonicalJson(input)); }
  catch { throw new RunnerError('INVALID_MANIFEST', 'Expected a JSON snapshot manifest.'); }
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) throw new RunnerError('INVALID_MANIFEST', 'Expected a snapshot manifest object.');
  const manifest = candidate as Record<string, unknown>;
  if (manifest.version !== 1 || !Array.isArray(manifest.files) || Object.keys(manifest).some(key => !['version', 'files'].includes(key))) throw new RunnerError('INVALID_MANIFEST', 'Expected version 1 with a files array.');
  if (manifest.files.length > RUNNER_LIMITS.files) throw new RunnerError('SNAPSHOT_LIMIT', 'Snapshot has too many files.');
  const names = new Set<string>();
  let totalBytes = 0;
  const files = manifest.files.map((entry: unknown) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) || Object.keys(entry).some(key => !['path', 'content'].includes(key))) throw new RunnerError('INVALID_MANIFEST', 'Each snapshot entry must contain only path and content, never links or metadata.');
    const file = entry as Record<string, unknown>;
    const name = validateRelativePath(file.path);
    if (!TEXT_EXTENSION.test(name)) throw new RunnerError('INVALID_FILE', 'Only source and text file extensions are allowed.');
    validateText(file.content);
    if (names.has(name)) throw new RunnerError('INVALID_MANIFEST', 'Duplicate snapshot paths are not allowed.');
    for (const previous of names) if (name.startsWith(previous + '/') || previous.startsWith(name + '/')) throw new RunnerError('PATH_CONFLICT', 'Snapshot paths contain a file/directory conflict.');
    names.add(name);
    totalBytes += Buffer.byteLength(file.content);
    if (totalBytes > RUNNER_LIMITS.snapshotBytes) throw new RunnerError('SNAPSHOT_LIMIT', 'Snapshot exceeds the total byte limit.');
    return Object.freeze({ path: name, content: file.content });
  });
  return Object.freeze({ version: 1 as const, files: Object.freeze(files) });
}
function snapshotFromManifest(manifest: SnapshotManifest, runId: string): Snapshot {
  const files = new Map(manifest.files.map(file => [file.path, file.content]));
  return { runId, files, digest: digestFiles(files), totalBytes: [...files.values()].reduce((sum, content) => sum + Buffer.byteLength(content), 0), excluded: [] };
}

async function openAnchoredDirectory(absolute: string): Promise<FileHandle> {
  // Anchor from the filesystem root too, not only after opening the project root.
  let current = await open('/', constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try {
    for (const segment of absolute.split('/').filter(Boolean)) {
      const next = await open(`/proc/self/fd/${current.fd}/${segment}`, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
      await current.close();
      current = next;
    }
    return current;
  } catch (error) { await current.close(); throw error; }
}

/** Linux directory-descriptor reads prevent ancestor-symlink races, not just final-path traversal. */
async function captureSnapshot(workspaceRoot: string, runId: string): Promise<Snapshot> {
  if (process.platform !== 'linux') throw new RunnerError('PLATFORM_UNSUPPORTED', 'Direct directory snapshots currently require Linux. On macOS, supply an explicit validated snapshot manifest instead; no weaker filesystem fallback is used.');
  const absolute = path.resolve(workspaceRoot);
  const resolved = await realpath(absolute);
  if (absolute !== resolved || resolved === '/' || resolved === homedir() || resolved === '/tmp' || resolved === '/workspace' ||
      resolved.split(path.sep).some(segment => segment.startsWith('.') || EXCLUDED_DIRECTORY.test(segment) || /^(?:proc|sys|dev|etc|root)$/.test(segment))) {
    throw new RunnerError('UNSAFE_WORKSPACE', 'Choose a specific project directory, without symlinks or system/credential paths.');
  }
  const rootStat = await lstat(absolute);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new RunnerError('UNSAFE_WORKSPACE', 'Workspace must be a real directory.');
  const files = new Map<string, string>();
  const excluded: string[] = [];
  let totalBytes = 0;
  let visited = 0;
  async function walk(directoryPath: string, prefix: string, expected?: { dev: number; ino: number }, anchoredHandle?: FileHandle): Promise<void> {
    const directory = anchoredHandle ?? await open(directoryPath, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try {
      const stat = await directory.stat();
      if (expected && (stat.dev !== expected.dev || stat.ino !== expected.ino)) throw new RunnerError('WORKSPACE_CHANGED', 'Workspace changed while snapshotting.');
      const anchored = `/proc/self/fd/${directory.fd}`;
      const entries = await opendir(anchored);
      for await (const entry of entries) {
        if (++visited > 4_096) throw new RunnerError('SNAPSHOT_LIMIT', 'Workspace has too many directory entries.');
        const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
        try { validateRelativePath(relative); } catch { excluded.push(relative); continue; }
        const source = `${anchored}/${entry.name}`;
        if (entry.isSymbolicLink()) { excluded.push(relative); continue; }
        if (entry.isDirectory()) {
          if (relative.split('/').length > 12) throw new RunnerError('SNAPSHOT_LIMIT', 'Workspace directory nesting is too deep.');
          const before = await lstat(source);
          await walk(source, relative, before);
          continue;
        }
        if (!entry.isFile() || !TEXT_EXTENSION.test(relative)) { excluded.push(relative); continue; }
        const file = await open(source, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
        try {
          const before = await file.stat();
          if (!before.isFile() || before.nlink !== 1) { excluded.push(relative); continue; }
          if (before.size > RUNNER_LIMITS.fileBytes) throw new RunnerError('SNAPSHOT_LIMIT', 'A source file exceeds the snapshot file-size limit.');
          const bytes = Buffer.alloc(RUNNER_LIMITS.fileBytes + 1);
          let offset = 0;
          while (offset < bytes.length) {
            const { bytesRead } = await file.read(bytes, offset, bytes.length - offset, null);
            if (!bytesRead) break;
            offset += bytesRead;
          }
          const after = await file.stat();
          if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs || offset !== before.size) {
            throw new RunnerError('WORKSPACE_CHANGED', 'A source file changed while snapshotting.');
          }
          const contents = bytes.subarray(0, offset).toString('utf8');
          // Round-trip protects against binary and malformed UTF-8 entering tool context.
          if (!Buffer.from(contents).equals(bytes.subarray(0, offset)) || contents.includes('\0') || SECRET_CONTENT.test(contents)) { excluded.push(relative); continue; }
          totalBytes += offset;
          if (totalBytes > RUNNER_LIMITS.snapshotBytes || files.size >= RUNNER_LIMITS.files) throw new RunnerError('SNAPSHOT_LIMIT', 'Workspace exceeds the bounded snapshot size or file count.');
          files.set(relative, contents);
        } finally { await file.close(); }
      }
    } finally { await directory.close(); }
  }
  const rootHandle = await openAnchoredDirectory(absolute);
  await walk(absolute, '', rootStat, rootHandle);
  return { runId, files, totalBytes, excluded, digest: digestFiles(files) };
}

function boundOutput(stdout: string, stderr: string, limit: number): { stdout: string; stderr: string } {
  const take = (text: string, bytes: number) => {
    const data = Buffer.from(text);
    if (data.length <= bytes) return text;
    let shortened = data.subarray(0, bytes).toString('utf8');
    while (Buffer.byteLength(shortened) > bytes) shortened = shortened.slice(0, -1);
    return shortened;
  };
  const out = take(stdout, limit);
  return { stdout: out, stderr: take(stderr, Math.max(0, limit - Buffer.byteLength(out))) };
}

/** No shell and no inherited credentials, NODE_OPTIONS, Docker contexts, or remote daemon settings. */
export function createProcessExecutor(spawnProcess: typeof spawn = spawn): ProcessExecutor {
return (executable, args, options) => new Promise(resolve => {
  if (options.signal?.aborted) return resolve({ exitCode: null, stdout: '', stderr: '', termination: 'cancelled' });
  let child: ReturnType<typeof spawn>;
  try {
    child = spawnProcess(executable, [...args], {
      shell: false, stdio: ['pipe', 'pipe', 'pipe'], cwd: '/',
      env: { PATH: '/usr/local/bin:/usr/bin:/bin', LANG: 'C.UTF-8', HOME: '/nonexistent', DOCKER_CONFIG: '/nonexistent/tinkerfleet' },
    });
  } catch (error) { return resolve({ exitCode: null, stdout: '', stderr: '', error: String(error) }); }
  const output: { stdout: Buffer[]; stderr: Buffer[] } = { stdout: [], stderr: [] };
  let bytes = 0;
  let termination: ProcessResult['termination'];
  let settled = false;
  let fallback: ReturnType<typeof setTimeout> | undefined;
  const finish = (exitCode: number | null, error?: string) => {
    if (settled) return;
    settled = true;
    clearTimeout(timeout);
    if (fallback) clearTimeout(fallback);
    options.signal?.removeEventListener('abort', abort);
    const bounded = boundOutput(Buffer.concat(output.stdout).toString('utf8'), Buffer.concat(output.stderr).toString('utf8'), options.maxOutputBytes);
    resolve({ exitCode, ...bounded, ...(termination ? { termination } : {}), ...(error ? { error } : {}) });
  };
  const stop = (reason: NonNullable<ProcessResult['termination']>) => {
    if (settled || termination) return;
    termination = reason;
    child.kill('SIGKILL');
    // A broken CLI must not keep a run open forever; caller separately removes the container.
    fallback = setTimeout(() => finish(null), 1_000);
  };
  const abort = () => stop('cancelled');
  const timeout = setTimeout(() => stop('timeout'), options.timeoutMs);
  const collect = (stream: 'stdout' | 'stderr', chunk: Buffer) => {
    const remaining = Math.max(0, options.maxOutputBytes - bytes);
    if (remaining) output[stream].push(chunk.subarray(0, remaining));
    bytes += Math.min(remaining, chunk.length);
    if (chunk.length > remaining) stop('output_limit');
  };
  child.stdout?.on('data', (chunk: Buffer) => collect('stdout', chunk));
  child.stderr?.on('data', (chunk: Buffer) => collect('stderr', chunk));
  child.on('error', error => finish(null, error.message));
  child.on('close', code => finish(code));
  child.stdin?.on('error', () => { /* EPIPE is reported by process exit; never throw into the server. */ });
  options.signal?.addEventListener('abort', abort, { once: true });
  if (options.signal?.aborted) abort();
  child.stdin?.end(options.input ?? '');
});
}
export const executeProcess: ProcessExecutor = createProcessExecutor();

// Trusted launcher is the only entrypoint. It is fixed application code, never a model-supplied shell.
// Commands execute in a disposable tmpfs; only explicit approved edits persist in the memory snapshot.
const CONTAINER_LAUNCHER = String.raw`
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
let bytes=0,chunks=[];process.stdin.on('data',c=>{bytes+=c.length;if(bytes>4194304)process.exit(90);chunks.push(c)});
process.stdin.on('end',()=>{try{
const p=JSON.parse(Buffer.concat(chunks).toString('utf8'));const base='/workspace';
function file(x){if(typeof x!=='string'||x.length>240||!x.split('/').every(s=>/^[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(s)&&s!=='.'&&s!=='..'))throw Error('Unsafe path');return path.join(base,x)}
for(const [name,content] of p.files){const target=file(name);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,content,{mode:0o644,flag:'wx'})}
if(p.action.kind==='edit'){const target=file(p.action.path);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,p.action.content,{mode:0o644});process.stdout.write('Applied approved edit in disposable snapshot.\n');return}
const bins={node:'/usr/local/bin/node',npm:'/usr/local/bin/npm',ls:'/bin/ls',cat:'/bin/cat'};if(!bins[p.action.executable])throw Error('Unsupported executable');
const child=cp.spawn(bins[p.action.executable],p.action.args,{cwd:p.action.cwd&&p.action.cwd!=='.'?file(p.action.cwd):base,shell:false,stdio:['ignore','inherit','inherit'],env:{PATH:'/usr/local/bin:/usr/bin:/bin',HOME:'/tmp',TMPDIR:'/tmp',NODE_ENV:'test',npm_config_cache:'/tmp/npm',npm_config_update_notifier:'false'}});
child.on('error',e=>{process.stderr.write(e.message);process.exitCode=127});child.on('close',code=>{process.exitCode=code===null?1:code});
}catch(e){process.stderr.write(String(e.message));process.exitCode=91}});
`;
const DOCKER_PREFIX = ['--host=unix:///var/run/docker.sock'] as const;
/** Official local Docker Desktop paths; never inherit a remote DOCKER_HOST or context. */
export function localDockerConnection(platform: NodeJS.Platform = process.platform, home = homedir()): { executable: string; hostFlag: string } {
  if (platform === 'darwin') return { executable: '/Applications/Docker.app/Contents/Resources/bin/docker', hostFlag: `--host=unix://${path.join(home, '.docker/run/docker.sock')}` };
  if (platform === 'linux') return { executable: 'docker', hostFlag: DOCKER_PREFIX[0] };
  throw new RunnerError('PLATFORM_UNSUPPORTED', 'Live execution supports Linux and macOS with Docker Desktop.');
}

/** Pure, inspectable configuration shared by execution and the offline sandbox lesson. */
export function buildDockerCreateArgs(name: string, imageId: string): string[] {
  if (!/^tinkerfleet-[a-f0-9-]{1,64}$/.test(name) || !/^sha256:[a-f0-9]{64}$/.test(imageId)) {
    throw new RunnerError('INVALID_CONTAINER', 'Only generated names and resolved local image IDs are accepted.');
  }
  return [...DOCKER_PREFIX, 'create', '--pull=never', '--rm', '--name', name,
        '--label', 'app=tinkerfleet', '--network=none', '--ipc=none', '--cgroupns=private', '--log-driver=none', '--read-only', '--user=65532:65532',
        '--cap-drop=ALL', '--security-opt=no-new-privileges:true', '--pids-limit=64',
        '--memory=128m', '--memory-swap=128m', '--cpus=0.5', '--ulimit=nofile=128:128', '--ulimit=fsize=16777216:16777216', '--ulimit=core=0:0',
        '--tmpfs=/workspace:rw,noexec,nosuid,nodev,size=32m,uid=65532,gid=65532,mode=0700',
        '--tmpfs=/tmp:rw,noexec,nosuid,nodev,size=16m,uid=65532,gid=65532,mode=0700',
        '--workdir=/workspace', '--no-healthcheck', '--entrypoint=/usr/local/bin/node', '-i', imageId, '-e', CONTAINER_LAUNCHER];
}

export class SafeContainerRunner {
  readonly approvals: ApprovalStore;
  readonly #root?: string;
  readonly #manifest?: SnapshotManifest;
  readonly #docker?: { executable: string; hostFlag: string };
  readonly #image: string;
  readonly #process: ProcessExecutor;
  readonly #snapshots = new Map<string, Promise<Snapshot>>();
  readonly #prepared = new Map<string, { runId: string; action: RunnerAction; bound: BoundRunnerAction }>();
  readonly #active = new Map<string, AbortController>();
  readonly #closed = new Set<string>();
  #cleanupBlocked = false;
  #shuttingDown = false;
  readonly #drains = new Map<string, Promise<void>>();
  constructor(options: { workspaceRoot?: string; snapshotManifest?: SnapshotManifest | string; approvals?: ApprovalStore; image?: string; executeProcess?: ProcessExecutor }) {
    if ((options.workspaceRoot !== undefined) === (options.snapshotManifest !== undefined)) throw new RunnerError('INVALID_SOURCE', 'Select exactly one project directory or explicit snapshot manifest.');
    this.#root = options.workspaceRoot;
    this.#manifest = options.snapshotManifest === undefined ? undefined : parseSnapshotManifest(options.snapshotManifest);
    this.#docker = process.platform === 'linux' || process.platform === 'darwin' ? localDockerConnection() : undefined;
    this.approvals = options.approvals ?? new ApprovalStore();
    this.#image = options.image ?? 'node:24-alpine';
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_./:@-]{0,199}$/.test(this.#image)) throw new RunnerError('INVALID_IMAGE', 'Invalid operator-configured image reference.');
    this.#process = options.executeProcess ?? executeProcess;
  }
  async snapshot(runId: string): Promise<SnapshotInfo> {
    const snapshot = await this.getSnapshot(runId);
    return { runId, digest: snapshot.digest, files: [...snapshot.files.keys()].sort(), totalBytes: snapshot.totalBytes, excluded: [...snapshot.excluded] };
  }
  async readFile(runId: string, relativePath: string): Promise<string> {
    const file = validateRelativePath(relativePath);
    const snapshot = await this.getSnapshot(runId);
    const content = snapshot.files.get(file);
    if (content === undefined) throw new RunnerError('FILE_NOT_FOUND', 'File is not included in this run snapshot.');
    return content;
  }
  async listFiles(runId: string): Promise<string[]> { return (await this.snapshot(runId)).files; }
  async prepare(runId: string, input: unknown): Promise<ApprovalRecord<BoundRunnerAction>> {
    const action = validateAction(input);
    if (this.#prepared.size >= 2_048) {
      for (const [id] of this.#prepared) {
        const record = this.approvals.get(id);
        if (!record || !['pending', 'approved'].includes(record.status)) this.#prepared.delete(id);
      }
      if (this.#prepared.size >= 2_048) throw new RunnerError('CAPACITY', 'Too many prepared actions.');
    }
    const snapshot = await this.getSnapshot(runId);
    if (this.#shuttingDown || this.#closed.has(runId)) throw new RunnerError('RUN_CLOSED', 'Run has been disposed.');
    const availability = await this.probe();
    if (this.#shuttingDown || this.#closed.has(runId)) throw new RunnerError('RUN_CLOSED', 'Run has been cancelled or disposed.');
    const bound: BoundRunnerAction = { ...action, snapshotDigest: snapshot.digest, image: this.#image, imageId: availability.available ? availability.image! : null, policyVersion: '1' };
    const approval = this.approvals.request(runId, bound);
    this.#prepared.set(approval.id, { runId, action: validateAction(action), bound: approval.action });
    return approval;
  }
  async checkAvailability(): Promise<{ available: boolean; reason?: string; image?: string }> {
    const result = await this.probe();
    return result.available ? { available: true, image: result.image } : { available: false, reason: result.reason };
  }
  async execute(runId: string, approvalId: string, options: { signal?: AbortSignal } = {}): Promise<RunnerResult> {
    const prepared = this.#prepared.get(approvalId);
    if (!prepared || prepared.runId !== runId) throw new RunnerError('UNKNOWN_ACTION', 'No prepared action matches this run and approval.');
    if (this.#active.has(runId)) throw new RunnerError('RUN_BUSY', 'Only one action may execute in a run at a time.');
    if (this.#shuttingDown || this.#closed.has(runId)) throw new RunnerError('RUN_CLOSED', 'Run has been disposed.');
    // Reserve the run synchronously, before any await, to prevent double execution races.
    const controller = new AbortController();
    this.#active.set(runId, controller);
    let finishDrain!: () => void;
    this.#drains.set(runId, new Promise<void>(resolve => { finishDrain = resolve; }));
    const abort = () => controller.abort();
    options.signal?.addEventListener('abort', abort, { once: true });
    if (options.signal?.aborted) controller.abort();
    const startedAt = Date.now();
    const name = `tinkerfleet-${randomUUID()}`;
    let created = false;
    let snapshot: Snapshot | undefined;
    let outcome: ProcessResult | undefined;
    let cleanupSucceeded = true;
    try {
      snapshot = await this.getSnapshot(runId);
      if (snapshot.digest !== prepared.bound.snapshotDigest) {
        const record = this.approvals.get(approvalId);
        if (record?.status === 'pending' || record?.status === 'approved') this.approvals.deny(approvalId);
        this.#prepared.delete(approvalId);
        throw new RunnerError('STALE_APPROVAL', 'Snapshot changed; request a new approval for the updated snapshot.');
      }
      this.approvals.consume(approvalId, runId, prepared.bound);
      this.#prepared.delete(approvalId);
      if (controller.signal.aborted) return this.result(runId, approvalId, prepared.action, { exitCode: null, stdout: '', stderr: '', termination: 'cancelled' }, startedAt, snapshot, true);
      if (!prepared.bound.imageId) throw new RunnerError('DOCKER_UNAVAILABLE', 'Docker or the required image was unavailable when this action was prepared. Request a new approval after setup; no host fallback exists.');
      const available = await this.probe(controller.signal, prepared.bound.imageId);
      if (controller.signal.aborted) return this.result(runId, approvalId, prepared.action, { exitCode: null, stdout: '', stderr: '', termination: 'cancelled' }, startedAt, snapshot, true);
      if (!available.available) throw new RunnerError('DOCKER_UNAVAILABLE', available.reason ?? 'Docker is unavailable; no host fallback exists.');
      if (available.image !== prepared.bound.imageId) throw new RunnerError('IMAGE_CHANGED', 'The resolved image no longer matches the approved immutable image ID.');
      const action = prepared.action;
      if (action.kind === 'edit') {
        const newBytes = snapshot.totalBytes - Buffer.byteLength(snapshot.files.get(action.path) ?? '') + Buffer.byteLength(action.content);
        if (newBytes > RUNNER_LIMITS.snapshotBytes || (!snapshot.files.has(action.path) && snapshot.files.size >= RUNNER_LIMITS.files)) throw new RunnerError('SNAPSHOT_LIMIT', 'Edit exceeds the bounded snapshot size.');
        for (const file of snapshot.files.keys()) {
          if (file.startsWith(action.path + '/') || action.path.startsWith(file + '/')) throw new RunnerError('PATH_CONFLICT', 'Edit conflicts with an existing file or directory.');
        }
      }
      const createArgs = buildDockerCreateArgs(name, available.image!);
      createArgs[0] = this.#docker!.hostFlag;
      created = true; // Also attempt cleanup if create fails or is interrupted.
      const creation = await this.#process(this.#docker!.executable, createArgs, { timeoutMs: 5_000, maxOutputBytes: 4_096, signal: controller.signal });
      if (creation.exitCode !== 0 || creation.termination || creation.error) outcome = creation;
      else outcome = await this.#process(this.#docker!.executable, [this.#docker!.hostFlag, 'start', '--attach', '--interactive', name], {
        input: JSON.stringify({ files: [...snapshot.files], action }), signal: controller.signal,
        timeoutMs: RUNNER_LIMITS.timeoutMs, maxOutputBytes: RUNNER_LIMITS.outputBytes,
      });
      const cleanup = await this.cleanup(name);
      cleanupSucceeded = cleanup;
      if (!cleanup) this.#cleanupBlocked = true;
      created = false;
      // Commit only explicit approved edits, after both execution and cleanup succeed.
      if (action.kind === 'edit' && outcome.exitCode === 0 && !outcome.termination && !outcome.error && cleanup && !controller.signal.aborted && !this.#closed.has(runId)) {
        snapshot.files.set(action.path, action.content);
        snapshot.totalBytes = [...snapshot.files.values()].reduce((sum, value) => sum + Buffer.byteLength(value), 0);
        snapshot.digest = digestFiles(snapshot.files);
      }
      if (controller.signal.aborted && !outcome.termination) outcome = { ...outcome, termination: 'cancelled' };
      return this.result(runId, approvalId, action, outcome, startedAt, snapshot, cleanupSucceeded);
    } finally {
      if (created && !await this.cleanup(name)) this.#cleanupBlocked = true;
      this.#active.delete(runId);
      this.#drains.delete(runId);
      finishDrain();
      options.signal?.removeEventListener('abort', abort);
    }
  }
  cancel(runId: string): void {
    this.#closed.add(runId);
    this.#snapshots.delete(runId);
    this.#active.get(runId)?.abort();
    this.approvals.invalidateRun(runId);
    for (const [id, action] of this.#prepared) if (action.runId === runId) this.#prepared.delete(id);
  }
  async cancelAndWait(runId: string): Promise<{ cleanupSucceeded: boolean }> {
    const drain = this.#drains.get(runId);
    this.cancel(runId);
    if (drain) await drain;
    return { cleanupSucceeded: !this.#cleanupBlocked };
  }
  /** Await before server shutdown; aborting the Docker CLI alone does not stop its container. */
  async shutdown(): Promise<{ cleanupSucceeded: boolean }> {
    this.#shuttingDown = true;
    const drains = [...this.#drains.values()];
    const runIds = new Set([...this.#snapshots.keys(), ...this.#active.keys(), ...[...this.#prepared.values()].map(value => value.runId)]);
    for (const runId of runIds) this.cancel(runId);
    await Promise.all(drains);
    return { cleanupSucceeded: !this.#cleanupBlocked };
  }
  disposeRun(runId: string): void {
    this.#closed.add(runId);
    this.cancel(runId);
    this.#snapshots.delete(runId);
  }
  private getSnapshot(runId: string): Promise<Snapshot> {
    if (typeof runId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(runId)) throw new RunnerError('INVALID_RUN', 'Invalid run ID.');
    if (this.#shuttingDown || this.#closed.has(runId)) throw new RunnerError('RUN_CLOSED', 'Run has been disposed.');
    let snapshot = this.#snapshots.get(runId);
    if (!snapshot) {
      if (this.#snapshots.size >= RUNNER_LIMITS.runs) throw new RunnerError('CAPACITY', 'Too many live run snapshots.');
      snapshot = this.#manifest ? Promise.resolve(snapshotFromManifest(this.#manifest, runId)) : captureSnapshot(this.#root!, runId);
      this.#snapshots.set(runId, snapshot);
      snapshot.catch(() => { if (this.#snapshots.get(runId) === snapshot) this.#snapshots.delete(runId); });
    }
    return snapshot;
  }
  private async probe(signal?: AbortSignal, imageReference = this.#image): Promise<{ available: boolean; reason?: string; image?: string }> {
    if (this.#shuttingDown) return { available: false, reason: 'Runner is shutting down.' };
    if (!this.#docker) return { available: false, reason: 'Live execution supports Linux and macOS with Docker Desktop; offline manifest inspection remains available.' };
    if (this.#cleanupBlocked) return { available: false, reason: 'A prior container cleanup was not confirmed. Inspect Docker and restart this server before executing more actions.' };
    const version = await this.#process(this.#docker!.executable, [this.#docker!.hostFlag, 'version', '--format={{.Server.Version}}'], { timeoutMs: 3_000, maxOutputBytes: 4_096, ...(signal ? { signal } : {}) });
    if (version.exitCode !== 0 || version.termination || version.error || !version.stdout.trim()) return { available: false, reason: 'Local Docker is unavailable. Install/start Docker yourself; execution is blocked and never falls back to the host.' };
    const image = await this.#process(this.#docker!.executable, [this.#docker!.hostFlag, 'image', 'inspect', '--format={{.Id}}', imageReference], { timeoutMs: 3_000, maxOutputBytes: 4_096, ...(signal ? { signal } : {}) });
    const imageId = image.stdout.trim();
    if (image.exitCode !== 0 || image.termination || image.error || !/^sha256:[a-f0-9]{64}$/.test(imageId)) return { available: false, reason: `Required local image ${this.#image} is unavailable. Images are never pulled automatically.` };
    return { available: true, image: imageId };
  }
  private async cleanup(name: string): Promise<boolean> {
    try {
      const cleanup = await this.#process(this.#docker!.executable, [this.#docker!.hostFlag, 'rm', '--force', name], { timeoutMs: 5_000, maxOutputBytes: 4_096 });
      return !cleanup.termination && !cleanup.error && (cleanup.exitCode === 0 || /No such container/i.test(cleanup.stderr));
    } catch { return false; }
  }
  private result(runId: string, approvalId: string, action: RunnerAction, outcome: ProcessResult, startedAt: number, snapshot: Snapshot, cleanupSucceeded: boolean): RunnerResult {
    const status = outcome.termination ?? (outcome.exitCode === 0 && !outcome.error && cleanupSucceeded ? 'completed' : 'failed');
    const bounded = boundOutput(outcome.stdout, outcome.stderr + (outcome.error ? `\n${outcome.error}` : '') + (!cleanupSucceeded ? '\nContainer cleanup could not be confirmed; inspect Docker before continuing.' : ''), RUNNER_LIMITS.outputBytes);
    return { runId, approvalId, kind: action.kind, status, exitCode: outcome.exitCode, ...bounded,
      durationMs: Date.now() - startedAt, snapshotDigest: snapshot.digest, cleanupSucceeded };
  }
}
