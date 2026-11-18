import { describe, expect, it } from 'vitest';
import { digest, parseEditEvidence, type RecoveryFile } from './workspaceRecovery';

const id = '3c038b34-8b9a-4fc4-8988-07c087f44bd0';
const revision = 'win:121:0123456789abcdef0123456789abcdef:3:4:5';
const files: RecoveryFile[] = ['a', 'b'].map(path => ({
  path, revision, before: digest('old'), after: digest('new'),
}));
const log = (...steps: object[]) => steps.map(step =>
  JSON.stringify({ ...step, checksum: digest(JSON.stringify({ runId: id, step })) })
).join('\n') + '\n';
const start = { phase: 'preflight-started' };
const passed = { phase: 'preflight-passed' };
const sent = { path: 'a', phase: 'dispatch-intent' };
const confirmed = { path: 'a', phase: 'applied', revision };

describe('edit recovery evidence', () => {
  it('distinguishes a Windows receipt from an interrupted dispatch', () => {
    const text = log(start, passed, sent, confirmed, { ...sent, path: 'b' }) + '{"phase":"applied"';
    const evidence = parseEditEvidence(text, id, 4, files);
    expect(evidence.get('a')).toEqual({ phase: 'applied', revision });
    expect(evidence.get('b')).toEqual({ phase: 'dispatch-intent' });
  });

  it('refuses foreign, altered or out-of-order receipts', () => {
    expect(() => parseEditEvidence(log(start, passed, sent, confirmed), 'another-id', 4, files)).toThrow('checksum');
    expect(() => parseEditEvidence(log(start, passed, sent, confirmed).replace(':3:4:5', ':3:4:6'), id, 4, files)).toThrow('checksum');
    expect(() => parseEditEvidence(log(start, passed, confirmed), id, 4, files)).toThrow('transition');
    expect(() => parseEditEvidence(log(start, passed, { ...sent, path: 'b' }), id, 4, files)).toThrow('intent');
  });

  it('supports legacy v3 ordered records', () => {
    const text = [start, passed, sent, { path: 'a', phase: 'not-confirmed' }].map(step => JSON.stringify(step)).join('\n') + '\n';
    expect(parseEditEvidence(text, id, 3, files).get('a')).toEqual({ phase: 'not-confirmed' });
  });
});
