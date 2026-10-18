/**
 * The one list of credential patterns. Text shown to people or sent to the model is
 * redacted with it, and files, memories and actions are rejected when it matches.
 * Defense in depth, not a substitute for excluding secrets at the filesystem boundary.
 */
export function redactSdkText(text: string): string {
  return text
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, '[REDACTED]')
    .replace(/\b(?:ghp_|gho_|ghu_|ghs_|github_pat_|xox[baprs]-)[A-Za-z0-9_-]{8,}/g, '[REDACTED]')
    .replace(/\bAKIA[A-Z0-9]{16}\b/g, '[REDACTED]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, 'Bearer [REDACTED]')
    .replace(
      /((?:API[_ -]?KEY|ACCESS[_ -]?TOKEN|SECRET|PASSWORD)\s*[=:]\s*["']?)[^\s"',;}]+/gi,
      '$1[REDACTED]',
    )
    .replace(
      /-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?(?:-----END [^-]*PRIVATE KEY-----|$)/g,
      '[REDACTED PRIVATE KEY]',
    );
}

/** True when the text contains anything redactSdkText would hide. */
export function containsSecret(text: string): boolean {
  return redactSdkText(text) !== text;
}
