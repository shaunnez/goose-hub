import { afterEach, describe, expect, it, vi } from 'vitest';
import { logger } from './logger.js';

describe('logger', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('logger.info writes a JSON line to console.log', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});

    logger.info('test info message');

    expect(spy).toHaveBeenCalledOnce();
    const line = JSON.parse(spy.mock.calls[0][0] as string) as Record<string, unknown>;
    expect(line.level).toBe('info');
    expect(line.message).toBe('test info message');
    expect(typeof line.ts).toBe('string');
  });

  it('logger.debug writes a JSON line to console.log', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});

    logger.debug('debug message', { extra: 'data' });

    expect(spy).toHaveBeenCalledOnce();
    const line = JSON.parse(spy.mock.calls[0][0] as string) as Record<string, unknown>;
    expect(line.level).toBe('debug');
    expect(line.message).toBe('debug message');
    expect(line.extra).toBe('data');
  });

  it('logger.warn writes a JSON line to console.warn', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    logger.warn('warning here');

    expect(spy).toHaveBeenCalledOnce();
    const line = JSON.parse(spy.mock.calls[0][0] as string) as Record<string, unknown>;
    expect(line.level).toBe('warn');
    expect(line.message).toBe('warning here');
  });

  it('logger.error writes a JSON line to console.error', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    logger.error('error occurred', { code: 500 });

    expect(spy).toHaveBeenCalledOnce();
    const line = JSON.parse(spy.mock.calls[0][0] as string) as Record<string, unknown>;
    expect(line.level).toBe('error');
    expect(line.message).toBe('error occurred');
    expect(line.code).toBe(500);
  });

  it('meta fields are merged into the top-level JSON object', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});

    logger.info('with meta', { requestId: 'req-123', userId: 'u-456' });

    const line = JSON.parse(spy.mock.calls[0][0] as string) as Record<string, unknown>;
    expect(line.requestId).toBe('req-123');
    expect(line.userId).toBe('u-456');
  });

  it('logs without meta argument does not throw', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});

    expect(() => logger.info('no meta')).not.toThrow();
    expect(spy).toHaveBeenCalledOnce();
  });

  it('ts field is a valid ISO 8601 timestamp', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});

    logger.info('timestamp test');

    const line = JSON.parse(spy.mock.calls[0][0] as string) as Record<string, unknown>;
    const ts = line.ts as string;
    expect(new Date(ts).toISOString()).toBe(ts);
  });
});
