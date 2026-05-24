import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { logger } from './logger';

const loggerCases = [
  {
    level: 'debug',
    method: 'log',
    message: 'debug msg',
    invoke: (message: string, meta?: Record<string, unknown>) => logger.debug(message, meta),
  },
  {
    level: 'info',
    method: 'info',
    message: 'hello',
    invoke: (message: string, meta?: Record<string, unknown>) => logger.info(message, meta),
  },
  {
    level: 'warn',
    method: 'warn',
    message: 'watch out',
    invoke: (message: string, meta?: Record<string, unknown>) => logger.warn(message, meta),
  },
  {
    level: 'error',
    method: 'error',
    message: 'something broke',
    invoke: (message: string, meta?: Record<string, unknown>) => logger.error(message, meta),
  },
] as const;

describe('logger', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let infoSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const consoleSpies = {
    debug: () => logSpy,
    info: () => infoSpy,
    warn: () => warnSpy,
    error: () => errorSpy,
  } as const;

  it.each(loggerCases)(
    'calls console.$method with prefix and message for $level',
    ({ level, message, invoke }) => {
      invoke(message);

      expect(consoleSpies[level]()).toHaveBeenCalledOnce();
      expect(consoleSpies[level]()).toHaveBeenCalledWith(`[goose-hub:${level}]`, message);
    },
  );

  it.each(loggerCases)(
    'preserves meta as the third console argument for $level',
    ({ level, message, invoke }) => {
      const meta = { code: 42, requestId: `${level}-request` };

      invoke(message, meta);

      expect(consoleSpies[level]()).toHaveBeenCalledOnce();
      expect(consoleSpies[level]()).toHaveBeenCalledWith(`[goose-hub:${level}]`, message, meta);
      expect(consoleSpies[level]().mock.calls[0][2]).toBe(meta);
    },
  );
});
