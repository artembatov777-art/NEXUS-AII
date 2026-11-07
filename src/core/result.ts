export type AppErrorCode =
  | "validation"
  | "authentication"
  | "permission_denied"
  | "provider_unavailable"
  | "rate_limited"
  | "timeout"
  | "cancelled"
  | "tool_failed"
  | "storage_failed"
  | "internal";

export interface AppError {
  code: AppErrorCode;
  message: string;
  retryable: boolean;
  traceId?: string;
}

export type Result<T> =
  | { ok: true; value: T }
  | { ok: false; error: AppError };

export const ok = <T>(value: T): Result<T> => ({ ok: true, value });

export const err = (
  code: AppErrorCode,
  message: string,
  retryable = false,
  traceId?: string
): Result<never> => ({
  ok: false,
  error: { code, message, retryable, ...(traceId ? { traceId } : {}) }
});
