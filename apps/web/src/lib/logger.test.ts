import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { logger } from './logger';

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

  it('logger.error calls console.error', () => {
    logger.error('something broke');
    expect(errorSpy).toHaveBeenCalledOnce();
  });

  it('logger.warn calls console.warn', () => {
    logger.warn('watch out');
    expect(warnSpy).toHaveBeenCalledOnce();
  });

  it('logger.info calls console.info', () => {
    logger.info('hello');
    expect(infoSpy).toHaveBeenCalledOnce();
  });

  it('logger.debug calls console.log', () => {
    logger.debug('debug msg');
    expect(logSpy).toHaveBeenCalledOnce();
  });

  it('includes meta when provided', () => {
    logger.error('with meta', { code: 42 });
    const call = errorSpy.mock.calls[0];
    // meta object is passed as the third argument
    expect(call[2]).toEqual({ code: 42 });
  });
});
