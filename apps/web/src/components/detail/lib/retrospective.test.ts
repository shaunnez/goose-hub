import { AlertCircle, CheckCircle, XCircle } from 'lucide-react';
import { describe, expect, it } from 'vitest';
import { CONFIDENCE_COLOR, outcomeMeta, scoreGrade } from './retrospective';

describe('scoreGrade', () => {
  it('returns "Excellent" for scores >= 0.9', () => {
    expect(scoreGrade(0.9)).toEqual({ label: 'Excellent', color: 'var(--success)' });
    expect(scoreGrade(1.0)).toEqual({ label: 'Excellent', color: 'var(--success)' });
  });

  it('returns "Strong" for scores in [0.8, 0.9)', () => {
    expect(scoreGrade(0.8)).toEqual({ label: 'Strong', color: 'var(--success)' });
    expect(scoreGrade(0.89)).toEqual({ label: 'Strong', color: 'var(--success)' });
  });

  it('returns "Solid" for scores in [0.7, 0.8)', () => {
    expect(scoreGrade(0.7)).toEqual({ label: 'Solid', color: 'var(--accent)' });
    expect(scoreGrade(0.79)).toEqual({ label: 'Solid', color: 'var(--accent)' });
  });

  it('returns "Mixed" for scores in [0.6, 0.7)', () => {
    expect(scoreGrade(0.6)).toEqual({ label: 'Mixed', color: 'var(--warning)' });
    expect(scoreGrade(0.69)).toEqual({ label: 'Mixed', color: 'var(--warning)' });
  });

  it('returns "Concerning" for scores below 0.6', () => {
    expect(scoreGrade(0.59)).toEqual({ label: 'Concerning', color: 'var(--danger)' });
    expect(scoreGrade(0)).toEqual({ label: 'Concerning', color: 'var(--danger)' });
  });
});

describe('outcomeMeta', () => {
  it('maps "success" to CheckCircle + success colour', () => {
    expect(outcomeMeta('success')).toEqual({
      icon: CheckCircle,
      color: 'var(--success)',
      label: 'Success',
    });
  });

  it('maps "failure" to XCircle + danger colour', () => {
    expect(outcomeMeta('failure')).toEqual({
      icon: XCircle,
      color: 'var(--danger)',
      label: 'Failure',
    });
  });

  it('maps "partial" to AlertCircle + warning colour', () => {
    expect(outcomeMeta('partial')).toEqual({
      icon: AlertCircle,
      color: 'var(--warning)',
      label: 'Partial',
    });
  });
});

describe('CONFIDENCE_COLOR', () => {
  it('exposes a colour class for every confidence level', () => {
    expect(CONFIDENCE_COLOR.high).toContain('green');
    expect(CONFIDENCE_COLOR.medium).toContain('yellow');
    expect(CONFIDENCE_COLOR.low).toContain('blue');
  });
});
