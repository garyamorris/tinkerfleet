/** Input contracts for the tools the model can call. The SDK validates arguments against these. */
import { z } from 'zod';

export const commandSchema = z
  .object({
    executable: z
      .string()
      .min(1)
      .max(512)
      .describe(
        'Installed executable name or absolute executable path only; put all command arguments in args.',
      ),
    args: z
      .array(z.string().max(4_096))
      .max(32)
      .describe(
        'Exact argument array, without the executable. Arguments are passed literally; no implicit shell.',
      ),
    cwd: z
      .string()
      .max(512)
      .nullable()
      .describe(
        'Use null or "." for the selected workspace. Otherwise use a permitted existing directory relative to that workspace, such as "src". Do not use an outside directory, traversal, hidden paths, or symlinks.',
      ),
  })
  .strict();
export const editSchema = z
  .object({ path: z.string().min(1).max(512), content: z.string().max(32_000) })
  .strict();
export const groupSchema = z
  .object({
    title: z.string().trim().min(1).max(80),
    brief: z.string().trim().min(1).max(8_000),
    botIds: z
      .array(z.string().regex(/^[A-Za-z0-9_-]{1,64}$/))
      .min(1)
      .max(7),
  })
  .strict();

export const createAgentSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1)
      .max(40)
      .regex(/^[^\u0000-\u001f\u007f]+$/),
    purpose: z
      .string()
      .trim()
      .min(1)
      .max(600)
      .regex(/^[^\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]+$/),
  })
  .strict();

export const messageAgentSchema = z
  .object({
    agentId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
    message: z.string().trim().min(1).max(8_000),
  })
  .strict();
export const memoryTextSchema = z
  .string()
  .trim()
  .min(1)
  .max(2_000)
  .regex(/^[^\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]+$/);
export const memoryEntrySchema = z
  .object({
    id: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
    agentId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
    text: memoryTextSchema,
    createdAt: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    updatedAt: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  })
  .strict();
