const { createTokenValidator, generateToken } = require('../src/tokenLogic');

describe('tokenLogic', () => {
  test('generateToken returns a non-empty string', () => {
    const t = generateToken();
    expect(typeof t).toBe('string');
    expect(t.length).toBeGreaterThan(0);
  });

  test('validateToken returns valid=true when db finds token', async () => {
    const fakeDb = {
      isConnected: () => true,
      query: jest.fn().mockResolvedValue({ rowCount: 1, rows: [{ id: 1 }] }),
    };

    const { validateToken } = createTokenValidator(fakeDb);
    const res = await validateToken('sometoken');
    expect(res).toEqual({ ok: true, valid: true });
  });

  test('validateToken returns valid=false when not found', async () => {
    const fakeDb = {
      isConnected: () => true,
      query: jest.fn().mockResolvedValue({ rowCount: 0, rows: [] }),
    };

    const { validateToken } = createTokenValidator(fakeDb);
    const res = await validateToken('sometoken');
    expect(res).toEqual({ ok: true, valid: false });
  });

  test('validateToken returns error when no db connection', async () => {
    const fakeDb = {
      isConnected: () => false,
      query: jest.fn(),
    };

    const { validateToken } = createTokenValidator(fakeDb);
    const res = await validateToken('sometoken');
    expect(res).toEqual({ ok: false, error: 'no-db-connection' });
  });
});
