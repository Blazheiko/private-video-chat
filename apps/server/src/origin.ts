export function isAllowedOrigin(origin: string | undefined, allowedOrigins: readonly string[]): boolean {
  if (allowedOrigins.length === 0) return true;
  if (origin === undefined || origin.length === 0) return false;
  return allowedOrigins.includes(origin);
}
