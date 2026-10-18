/** Parse a model's run_command/edit_file arguments into an exact action, and compare actions. */
import path from 'node:path';
import { redactSdkText } from '../safety.js';
import type { SdkAction } from './contract.js';
import { SafeSdkError } from './errors.js';
import { commandSchema, editSchema } from './schemas.js';

export function normalizeCommandCwd(
  cwd: string | null,
  workspaceRoot?: string,
): string | undefined {
  if (!cwd) return undefined;
  if (!path.isAbsolute(cwd)) return cwd;
  const reject = () =>
    new SafeSdkError(
      'The proposed command directory is outside the permitted workspace or uses traversal. Use cwd null or ".", or a permitted existing subdirectory of the selected workspace.',
    );
  if (!workspaceRoot || !path.isAbsolute(workspaceRoot) || cwd.split(path.sep).includes('..'))
    throw reject();
  const relative = path.relative(workspaceRoot, cwd);
  if (path.isAbsolute(relative) || relative === '..' || relative.startsWith(`..${path.sep}`))
    throw reject();
  // The native policy still checks relative hidden/excluded paths and actual directories/symlinks.
  return relative || '.';
}
export function requireSafeText(text: string): void {
  if (redactSdkText(text) !== text)
    throw new SafeSdkError('Credential-like content was blocked. Review it locally.');
}
/** Compare two actions by the fields a person reviews, ignoring metadata a runner may add. */
export function sameAction(a: SdkAction, b: SdkAction): boolean {
  const key = (action: SdkAction) =>
    action.kind === 'edit'
      ? JSON.stringify(['edit', action.path, action.content])
      : JSON.stringify(['command', action.executable, action.args, action.cwd || null]);
  return key(a) === key(b);
}
export function parseAction(
  name: string,
  argumentsJson: string,
  workspaceRoot?: string,
): SdkAction {
  let input: unknown;
  try {
    input = JSON.parse(argumentsJson);
  } catch {
    throw new SafeSdkError(
      'The agent supplied malformed tool arguments. Ask it to submit a valid command or edit request.',
    );
  }
  if (name === 'run_command') {
    const value = commandSchema.parse(input);
    const cwd = normalizeCommandCwd(value.cwd, workspaceRoot);
    return {
      kind: 'command',
      executable: value.executable,
      args: value.args,
      ...(cwd ? { cwd } : {}),
    };
  }
  if (name === 'edit_file') return { kind: 'edit', ...editSchema.parse(input) };
  throw new SafeSdkError('An unsupported tool requested approval.');
}
