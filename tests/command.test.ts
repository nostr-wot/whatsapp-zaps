import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isZapCommand, messagePreview, normalizeText, parseAmount, parseZapCommand, zapChatMessage, zapMessage } from '../src/domain/command.ts';

function ok(text: string, mentions: Parameters<typeof parseZapCommand>[1] = []) {
  const result = parseZapCommand(text, mentions);
  assert.equal(result.ok, true, result.ok ? '' : result.error);
  return (result as Extract<typeof result, { ok: true }>).command;
}

function fails(text: string, pattern: RegExp) {
  const result = parseZapCommand(text);
  assert.equal(result.ok, false);
  assert.match((result as Extract<typeof result, { ok: false }>).error, pattern);
}

describe('isZapCommand', () => {
  it('recognizes /zap with or without arguments, in any case', () => {
    for (const text of ['/zap', '/zap @a 1', '/ZAP @a 1', '  /zap @a 1', '\u200e/zap @a 1']) assert.equal(isZapCommand(text), true, text);
  });
  it('ignores other text', () => {
    for (const text of ['zap @a 1', '/zapper', 'hello /zap', '', '/za']) assert.equal(isZapCommand(text), false, text);
  });
});

describe('normalizeText', () => {
  it('strips bidi isolates and zero-width marks and collapses spaces', () => {
    assert.equal(normalizeText('\u2068@Alice\u2069\u00a0\u200b 1000 \n'), '@Alice 1000');
  });
});

describe('parseAmount', () => {
  it('reads plain, grouped and suffixed amounts', () => {
    assert.equal(parseAmount('1000'), 1000);
    assert.equal(parseAmount('21,000'), 21000);
    assert.equal(parseAmount('21k'), 21000);
    assert.equal(parseAmount('1.5K'), 1500);
    assert.equal(parseAmount('1.1k'), 1100);
    assert.equal(parseAmount('2m'), 2_000_000);
  });
  it('returns fractions for the caller to refuse', () => {
    assert.equal(parseAmount('1.5'), 1.5);
  });
  it('rejects non-amounts', () => {
    for (const t of ['abc', '1,00', '1e3', '-5', '10x', '', '1..0']) assert.equal(parseAmount(t), null, t);
  });
});

describe('parseZapCommand', () => {
  it('parses a typed mention and amount', () => {
    assert.deepEqual(ok('/zap @Alice 1000'), { recipient: { label: 'Alice', id: null }, amountSats: 1000, comment: '' });
  });

  it('keeps a comment', () => {
    assert.equal(ok('/zap @Alice 21k thanks for lunch').comment, 'thanks for lunch');
  });

  it('reads multi-word typed names up to the amount', () => {
    const cmd = ok('/zap @Ana Paula 500 gracias');
    assert.equal(cmd.recipient!.label, 'Ana Paula');
    assert.equal(cmd.amountSats, 500);
    assert.equal(cmd.comment, 'gracias');
  });

  it('accepts the amount before the mention', () => {
    const cmd = ok('/zap 1,000 @Alice for coffee');
    assert.deepEqual(cmd.recipient, { label: 'Alice', id: null });
    assert.equal(cmd.amountSats, 1000);
    assert.equal(cmd.comment, 'for coffee');
  });

  it('uses a picked mention, with its id, including names with spaces and digits', () => {
    const cmd = ok('/zap @Ana Paula 2 500', [{ label: 'Ana Paula 2', id: '5491100000000@c.us' }]);
    assert.deepEqual(cmd.recipient, { label: 'Ana Paula 2', id: '5491100000000@c.us' });
    assert.equal(cmd.amountSats, 500);
  });

  it('prefers the longest matching picked mention', () => {
    const cmd = ok('/zap @Ana Paula 10', [{ label: 'Ana', id: 'a@c.us' }, { label: '@Ana Paula', id: 'ap@c.us' }]);
    assert.equal(cmd.recipient!.id, 'ap@c.us');
  });

  it('does not match a picked mention that is only a prefix of a word', () => {
    const cmd = ok('/zap @Anabel 10', [{ label: 'Ana', id: 'a@c.us' }]);
    assert.deepEqual(cmd.recipient, { label: 'Anabel', id: null });
  });

  it('survives WhatsApp invisible characters around mentions', () => {
    const cmd = ok('/zap \u2068@Alice\u2069 1000', [{ label: '\u2068@Alice\u2069', id: 'x@c.us' }]);
    assert.deepEqual(cmd.recipient, { label: 'Alice', id: 'x@c.us' });
  });

  it('accepts no mention, for the other person in a one-to-one chat', () => {
    assert.deepEqual(ok('/zap 1000'), { recipient: null, amountSats: 1000, comment: '' });
    assert.deepEqual(ok('/zap 21k for lunch'), { recipient: null, amountSats: 21000, comment: 'for lunch' });
    fails('/zap 0', /whole number/);
    fails(`/zap 10 ${'x'.repeat(281)}`, /longer than 280/);
  });

  it('in a private chat, never asks for a name', () => {
    const err = (text: string) => {
      const r = parseZapCommand(text, [], 'private');
      assert.equal(r.ok, false, text);
      return (r as { error: string }).error;
    };
    for (const text of ['/zap', '/zap thanks', '/zap thanks 1000']) {
      const e = err(text);
      assert.doesNotMatch(e, /Mention|@name/, `${text}: ${e}`);
      assert.match(e, /amount/, text);
      assert.match(e, /\/zap 1000 thanks/, text);
    }
  });

  it('in a group, asks who to zap', () => {
    const r = parseZapCommand('/zap thanks', [], 'group');
    assert.match((r as { error: string }).error, /Mention who to zap.*\/zap @name amount/);
  });

  it('when the chat kind is unknown, explains both forms', () => {
    const r = parseZapCommand('/zap thanks', [], 'unknown');
    assert.match((r as { error: string }).error, /private chat.*group/);
  });

  it('explains what is missing', () => {
    fails('/zap', /Usage/);
    fails('/zap @Alice', /Add an amount/);
    fails('/zap Alice 1000', /Start with the amount/);
    fails('/zap @Alice lots', /Usage/);
  });

  it('refuses zero, fractional and oversized amounts', () => {
    fails('/zap @Alice 0', /whole number/);
    fails('/zap @Alice 1.5', /whole number/);
    fails('/zap @Alice 20m', /limit/);
  });

  it('refuses an overlong comment', () => {
    fails(`/zap @Alice 10 ${'x'.repeat(281)}`, /longer than 280/);
  });
});

describe('zapMessage', () => {
  it('formats the post-zap chat message', () => {
    assert.equal(zapMessage('Alice', 21000), '⚡ Sent 21,000 sats to Alice');
    assert.equal(zapMessage(null, 21), '⚡ Sent you 21 sats');
    assert.equal(zapMessage(null, 21, 'thanks'), '⚡ Sent you 21 sats: thanks');
    assert.doesNotMatch(zapMessage('Alice', 1), /@/, 'no fake mention');
  });
});

describe('zapChatMessage', () => {
  it('mentions who was paid, with a plain fallback', () => {
    const m = zapChatMessage({ label: '\u2068@Jaqui\u2069', id: '9@c.us' }, 21, 'thanks');
    assert.equal(m.text, '⚡ Sent 21 sats to Jaqui: thanks');
    assert.deepEqual(m.mention, { before: '⚡ Sent 21 sats to ', who: { label: '\u2068@Jaqui\u2069', id: '9@c.us' }, after: ': thanks' });
    assert.equal(messagePreview(m), '⚡ Sent 21 sats to @Jaqui: thanks');
  });
  it('has no mention when paying the other person in a private chat', () => {
    assert.deepEqual(zapChatMessage(null, 21), { text: '⚡ Sent you 21 sats' });
  });
});
