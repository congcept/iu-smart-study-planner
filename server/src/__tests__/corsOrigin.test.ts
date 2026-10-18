import { readCorsOrigin } from '../config/corsOrigin';

const production = (origin?: string): NodeJS.ProcessEnv => ({
  NODE_ENV: 'production',
  ...(origin === undefined ? {} : { CORS_ORIGIN: origin }),
});
const errorMessage = 'Production requires CORS_ORIGIN to be one explicit HTTP(S) origin';

describe('production frontend origin configuration', () => {
  it.each([
    ['https://planner.example.test', 'https://planner.example.test'],
    ['HTTPS://PLANNER.EXAMPLE.TEST:443/', 'https://planner.example.test'],
    ['http://localhost:5173/', 'http://localhost:5173'],
    ['http://example.test:80', 'http://example.test'],
    ['https://[::1]:8443/', 'https://[::1]:8443'],
    ['https://münich.example/', 'https://xn--mnich-kva.example'],
  ])('captures %j as its canonical browser origin', (value, expected) => {
    const env = production(value);
    const before = { ...env };
    expect(readCorsOrigin(env)).toBe(expected);
    expect(env).toEqual(before);
  });

  it.each([
    undefined,
    '',
    ' ',
    '*',
    'null',
    '//example.test',
    'https:example.test',
    'https:///example.test',
    'ftp://example.test',
    'file:///example.test',
    'data:text/plain,example',
    'https://*.example.test',
    'https://%2a.example.test',
    'https://＊.example.test',
    'https://user:private@example.test',
    'https://@example.test',
    'https://:private@example.test',
    'https://example.test/path',
    'https://example.test/.',
    'https://example.test/a/..',
    'https://example.test/%2e',
    'https://example.test//',
    'https://example.test?',
    'https://example.test?query=private',
    'https://example.test#',
    'https://example.test#private',
    'https://example.test,other.example.test',
    'https://example.test%2cother.example.test',
    'https://example.test,https://other.example.test',
    'https://example.test https://other.example.test',
    ' https://example.test',
    'https://example.test ',
    'https://exam\tple.test',
    'https://example.test\n',
    'https://example.test\u0000',
    'https://example.test\u007f',
    'https:\\example.test',
    'https://example.test\\',
    'https://example.test:65536',
    'https://',
  ])('rejects invalid or ambiguous production input %# without echoing it', (value) => {
    expect(() => readCorsOrigin(production(value))).toThrow(errorMessage);
    try {
      readCorsOrigin(production(value));
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe(errorMessage);
    }
  });

  it.each([undefined, 'development', 'test', 'staging'])(
    'preserves the existing non-production fallback and explicit string for %j',
    (nodeEnv) => {
      const env: NodeJS.ProcessEnv = nodeEnv ? { NODE_ENV: nodeEnv } : {};
      expect(readCorsOrigin(env)).toBe('http://localhost:5173');
      expect(readCorsOrigin({ ...env, CORS_ORIGIN: '' })).toBe('http://localhost:5173');
      expect(readCorsOrigin({ ...env, CORS_ORIGIN: 'http://localhost:4321' })).toBe(
        'http://localhost:4321',
      );
      // This increment only tightens production; do not silently rewrite local settings.
      expect(readCorsOrigin({ ...env, CORS_ORIGIN: '*' })).toBe('*');
      expect(readCorsOrigin({ ...env, CORS_ORIGIN: ' http://localhost:4321/ ' })).toBe(
        ' http://localhost:4321/ ',
      );
    },
  );
});
