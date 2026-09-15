/** Log mínimo em stderr (stdout é do protocolo MCP). Silencie com CLOUDFACT_QUIET=1. */
export const log = {
  info(message: string): void {
    if (!process.env.CLOUDFACT_QUIET) process.stderr.write(`${message}\n`);
  },
  ts(...parts: unknown[]): void {
    process.stderr.write(`${new Date().toISOString()} ${parts.map(String).join(' ')}\n`);
  },
};
