// Names a failure for logs by its error name and code. Errors themselves can
// carry SQL bound values (names, amounts, photo bytes), the database client
// with its connection details, or host and port in their messages.
export function errorCode(error: unknown): string {
  if (!(error instanceof Error)) return 'UnknownError';
  const code = (error as { code?: unknown }).code ?? (error.cause as { code?: unknown } | undefined)?.code;
  return typeof code === 'string' ? `${error.name}:${code}` : error.name;
}
