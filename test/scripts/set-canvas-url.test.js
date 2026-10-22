import { describe, it, expect } from 'vitest';
import { rewriteCanvasUrls } from '../../scripts/set-canvas-url.js';

const BASE = 'https://new-name-here.trycloudflare.com';

describe('rewriteCanvasUrls', () => {
  it('rewrites canvasUrl and callbackUrl to <base>/auth/canvas', () => {
    const xml = [
      '<ExtlClntAppCanvasSettings>',
      '    <canvasUrl>https://old.trycloudflare.com/auth/canvas</canvasUrl>',
      '    <callbackUrl>https://old.trycloudflare.com/auth/canvas</callbackUrl>',
      '</ExtlClntAppCanvasSettings>',
    ].join('\n');
    const out = rewriteCanvasUrls(xml, BASE);
    expect(out).toContain(`<canvasUrl>${BASE}/auth/canvas</canvasUrl>`);
    expect(out).toContain(`<callbackUrl>${BASE}/auth/canvas</callbackUrl>`);
    expect(out).not.toContain('old.trycloudflare.com');
  });

  it('leaves other elements untouched', () => {
    const xml = '<a><label>x</label><canvasUrl>https://old.example.com/auth/canvas</canvasUrl></a>';
    expect(rewriteCanvasUrls(xml, BASE)).toBe(`<a><label>x</label><canvasUrl>${BASE}/auth/canvas</canvasUrl></a>`);
  });

  it('throws when the file has no URL element to rewrite', () => {
    expect(() => rewriteCanvasUrls('<a><label>x</label></a>', BASE)).toThrow(/no canvasUrl\/callbackUrl/);
  });

  it.each([
    'http://insecure.example.com',
    'https://example.com/path',
    'https://*.example.com',
    'https://example.com/',
    'not a url',
    '',
  ])('rejects base URL %j', (base) => {
    expect(() => rewriteCanvasUrls('<canvasUrl>https://a.b/auth/canvas</canvasUrl>', base)).toThrow(/https origin/);
  });
});
