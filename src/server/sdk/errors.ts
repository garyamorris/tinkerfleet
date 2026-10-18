/** Map internal and provider errors to fixed, actionable messages that never leak raw details. */
import { MaxTurnsExceededError, ToolCallError } from '@openai/agents';
import { z } from 'zod';
import { ApprovalError } from '../approval.js';
import { ContextBudgetError } from '../context-budget.js';
import { RunnerError } from '../runner-policy.js';

export class SafeSdkError extends Error {}
/** Classify provider failures using only allowlisted metadata, never messages or response bodies. */
export function safeModelFailure(error: unknown): unknown {
  if (!error || typeof error !== 'object') return error;
  const { status, code, name } = error as { status?: unknown; code?: unknown; name?: unknown };
  let message: string | undefined;
  if (status === 401 || code === 'invalid_api_key')
    message = 'Model authentication failed (401). Check the configured API credential locally.';
  else if (status === 403)
    message = 'Model access was denied (403). Check project and model permissions.';
  else if (status === 404 || code === 'model_not_found')
    message = 'The configured model is unavailable (404). Check the model ID and project access.';
  else if (code === 'insufficient_quota')
    message = 'API quota is exhausted. Check project billing and limits before another request.';
  else if (status === 429 || code === 'rate_limit_exceeded')
    message = 'The API rate limit was reached (429). No automatic retry was attempted.';
  else if (status === 400)
    message =
      'The model rejected the request configuration (400). Check support for the selected model settings.';
  else if (
    name === 'APIConnectionError' ||
    name === 'APIConnectionTimeoutError' ||
    (typeof code === 'string' &&
      ['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'ENETUNREACH', 'ENOTFOUND', 'EAI_AGAIN'].includes(
        code,
      ))
  )
    message = 'The model request could not connect or timed out. No automatic retry was attempted.';
  return message ? new SafeSdkError(message) : error;
}
/** Fixed diagnostic wording only; never forward runner paths, arguments, output, or arbitrary errors. */
export function safeExecutionFailure(error: unknown): string | undefined {
  const seen = new Set<unknown>();
  for (let depth = 0; depth < 8 && error && !seen.has(error); depth++) {
    seen.add(error);
    if (error instanceof SafeSdkError || error instanceof ContextBudgetError) return error.message;
    if (error instanceof MaxTurnsExceededError)
      return 'This run reached its configured turn limit. Send a follow-up to continue, or set TINKERFLEET_MAX_TURNS=0 to remove the turn-count limit. Completed local effects have not been undone.';
    if (
      (error instanceof Error && error.name === 'InvalidToolInputError') ||
      error instanceof z.ZodError
    )
      return 'The agent supplied malformed tool arguments. Ask it to retry with an executable, an argument array, and cwd set to null or a permitted workspace-relative directory.';
    if (error instanceof RunnerError || error instanceof ApprovalError) {
      const messages: Record<string, string> = {
        UNSAFE_PATH:
          'The proposed file path or command directory is not permitted. Use cwd null or "." for the selected workspace, or an existing permitted relative subdirectory; hidden paths, traversal, and symlinks are not allowed.',
        UNSAFE_WORKSPACE:
          'The selected workspace is unavailable or not permitted. Choose a real project directory in the workspace settings.',
        EXECUTABLE_NOT_FOUND:
          'The requested executable was not found on the server’s PATH or is not executable. Use its installed absolute path or correct the server PATH, then request the command again.',
        INVALID_COMMAND:
          'The proposed command is invalid. Supply only the installed executable name or absolute executable path, put its arguments in args, and use a permitted cwd.',
        INVALID_ACTION:
          'The proposed tool action is malformed. Ask the agent to submit a new command or edit with the required fields.',
        INVALID_FILE:
          'The proposed file is excluded or is not a supported text file. Use a permitted source or text file in the selected workspace.',
        SECRET_CONTENT:
          'Credential-like content was blocked from a file or command. Remove secrets from the proposed action and review the sensitive data locally.',
        STALE_APPROVAL:
          'The workspace changed after the action was proposed. Request a fresh action and review its new approval.',
        EXECUTABLE_CHANGED:
          'The executable changed after the action was proposed. Request the command again and review a fresh approval.',
        SNAPSHOT_LIMIT:
          'The selected workspace or proposed edit exceeds the local file or snapshot limits. Select a smaller project or reduce the proposed edit.',
        RUN_BUSY:
          'Another local action is executing. Wait for it to finish, then request this action again.',
        RUN_CLOSED: 'This run is closed. Send a follow-up message to start a new run.',
        EXECUTION_BLOCKED:
          'A previous local process did not confirm cleanup. Review local processes before restarting the server.',
        CAPACITY:
          'The local runner has reached its active-run or approval capacity. Finish or cancel pending work before trying again.',
        NOT_APPROVED:
          'This exact action does not have an unused approval. Request a fresh action and approve it before execution.',
        NOT_PENDING:
          'This approval has already been decided or expired. Request a fresh action for review.',
        ACTION_MISMATCH:
          'The approval does not match this exact run and action. Request a fresh action for review.',
        UNKNOWN_APPROVAL:
          'This approval is unavailable, possibly after a server restart. Request a fresh action for review.',
        UNKNOWN_ACTION:
          'This prepared action is no longer available. Request a fresh action for review.',
      };
      return Object.hasOwn(messages, error.code) ? messages[error.code] : undefined;
    }
    if (error instanceof ToolCallError) {
      error = error.error;
      continue;
    }
    return undefined;
  }
  return undefined;
}
