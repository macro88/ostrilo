import { describe, it, expect } from 'vitest';
import { evaluatePolicy } from '@/src/domain/policy/evaluate';
import { OriginPolicy, PolicyContext } from '@/src/domain/types';

const mediumAllowKinds = [6, 16, 7, 10002];

function makePolicy(partial: Partial<OriginPolicy>): OriginPolicy {
  return {
    origin: 'https://app',
    trustLevel: 'medium',
    rules: {},
    updatedAt: Math.floor(Date.now() / 1000),
    ...partial,
  };
}

describe('evaluatePolicy', () => {
  const baseCtx: PolicyContext = { unlocked: true, mediumAllowKinds };

  it('denies when locked', () => {
    const out = evaluatePolicy({ origin: 'https://app', kind: 1 }, { ...baseCtx, unlocked: false }, []);
    expect(out.reason).toBe('locked');
    expect(out.mode).toBe('deny');
  });

  it('explicit deny wins over session', () => {
    const pol = makePolicy({ sessionGrantAll: true, rules: { 1: 'deny' } });
    const out = evaluatePolicy({ origin: 'https://app', kind: 1 }, baseCtx, [pol]);
    expect(out.reason).toBe('rule');
    expect(out.mode).toBe('deny');
  });

  it('session grant allows when no explicit deny', () => {
    const pol = makePolicy({ sessionGrantAll: true });
    const out = evaluatePolicy({ origin: 'https://app', kind: 1 }, baseCtx, [pol]);
    expect(out.reason).toBe('session');
    expect(out.mode).toBe('allow');
  });

  it('explicit rule ask overrides trust', () => {
    const pol = makePolicy({ trustLevel: 'high', rules: { 1: 'ask' } });
    const out = evaluatePolicy({ origin: 'https://app', kind: 1 }, baseCtx, [pol]);
    expect(out.reason).toBe('rule');
    expect(out.mode).toBe('ask');
  });

  it('trust=high allows everything', () => {
    const pol = makePolicy({ trustLevel: 'high' });
    const out = evaluatePolicy({ origin: 'https://app', kind: 1 }, baseCtx, [pol]);
    expect(out.reason).toBe('trust');
    expect(out.mode).toBe('allow');
  });

  it('trust=medium allows mediumAllowKinds else ask', () => {
    const pol = makePolicy({ trustLevel: 'medium' });
    const allowed = evaluatePolicy({ origin: 'https://app', kind: 6 }, baseCtx, [pol]);
    const asked = evaluatePolicy({ origin: 'https://app', kind: 1 }, baseCtx, [pol]);
    expect(allowed.mode).toBe('allow');
    expect(allowed.reason).toBe('trust');
    expect(asked.mode).toBe('ask');
  });

  it('fallback asks when no policy', () => {
    const out = evaluatePolicy({ origin: 'https://unknown', kind: 1 }, baseCtx, []);
    expect(out.reason).toBe('fallback');
    expect(out.mode).toBe('ask');
  });
});
