const COLORS = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  green: '\x1b[32m',
  cyan: '\x1b[36m',
} as const;

type Level = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_COLOR: Record<Level, string> = {
  debug: COLORS.dim,
  info: COLORS.cyan,
  warn: COLORS.yellow,
  error: COLORS.red,
};

const ORDER: Record<Level, number> = { debug: 0, info: 1, warn: 2, error: 3 };

const threshold = ORDER[(process.env.MCP_LOG_LEVEL as Level) ?? 'info'] ?? ORDER.info;

function emit(level: Level, scope: string, message: unknown, extra?: unknown): void {
  if (ORDER[level] < threshold) return;
  const color = LEVEL_COLOR[level];
  const ts = new Date().toISOString();
  const head = `${COLORS.dim}${ts}${COLORS.reset} ${color}${level.toUpperCase().padEnd(5)}${COLORS.reset} ${COLORS.green}[${scope}]${COLORS.reset}`;
  if (extra !== undefined) {
    process.stderr.write(`${head} ${String(message)} ${COLORS.dim}${stringify(extra)}${COLORS.reset}\n`);
  } else {
    process.stderr.write(`${head} ${String(message)}\n`);
  }
}

function stringify(value: unknown): string {
  if (value instanceof Error) return value.stack ?? value.message;
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function createLogger(scope: string) {
  return {
    debug: (message: unknown, extra?: unknown) => emit('debug', scope, message, extra),
    info: (message: unknown, extra?: unknown) => emit('info', scope, message, extra),
    warn: (message: unknown, extra?: unknown) => emit('warn', scope, message, extra),
    error: (message: unknown, extra?: unknown) => emit('error', scope, message, extra),
    child: (sub: string) => createLogger(`${scope}:${sub}`),
  };
}

export type McpLogger = ReturnType<typeof createLogger>;
