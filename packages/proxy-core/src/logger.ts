import type { ProxyRequestType } from './schemas.ts';

/**
 * The only thing the proxy logs. The shape is closed on purpose: request and
 * response bodies, merchant text, questions, tool data and user ids never appear.
 */
export interface ProxyLogEntry {
  requestType: ProxyRequestType | 'unknown';
  status: number;
  latencyMs: number;
  inputTokens?: number;
  outputTokens?: number;
}

export interface ProxyLogger {
  record(entry: ProxyLogEntry): void;
}

/** Copies only whitelisted numeric/enum fields, so extra properties can never leak. */
export function sanitizeLogEntry(entry: ProxyLogEntry): ProxyLogEntry {
  const clean: ProxyLogEntry = {
    requestType:
      entry.requestType === 'categorize' || entry.requestType === 'ask'
        ? entry.requestType
        : 'unknown',
    status: Math.trunc(Number(entry.status)) || 0,
    latencyMs: Math.max(0, Math.round(Number(entry.latencyMs)) || 0),
  };
  if (typeof entry.inputTokens === 'number') clean.inputTokens = Math.trunc(entry.inputTokens);
  if (typeof entry.outputTokens === 'number') clean.outputTokens = Math.trunc(entry.outputTokens);
  return clean;
}

export function createConsoleProxyLogger(
  write: (line: string) => void = (line) => console.log(line),
): ProxyLogger {
  return {
    record(entry) {
      write(JSON.stringify({ event: 'claude_proxy', ...sanitizeLogEntry(entry) }));
    },
  };
}
