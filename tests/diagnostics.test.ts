import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatDiagnostics } from '../src/services/diagnostics.ts';

describe('formatDiagnostics', () => {
  it('formats entries as plain text for pasting', () => {
    const text = formatDiagnostics([{ at: 0, what: 'mention could not be made', version: '0.7.0', details: { wanted: 'Jaqui', box: '<p>x</p>' } }], 'UA');
    assert.match(text, /1 entry/);
    assert.match(text, /Browser: UA/);
    assert.match(text, /1970-01-01T00:00:00.000Z · mention could not be made · v0\.7\.0/);
    assert.match(text, /\[wanted\]\nJaqui/);
    assert.match(text, /\[box\]\n<p>x<\/p>/);
  });
  it('says when there is nothing', () => {
    assert.equal(formatDiagnostics([], 'UA'), 'No diagnostics recorded.');
  });
});
