import { describe, it, expect } from 'vitest';
import { encrypt, decrypt } from './cryptoService';

describe('cryptoService', () => {
  it('encrypt → decrypt round-trip zachová původní string', () => {
    const plaintext = 'https://teams.example.com/webhook/abc123';

    const encResult = encrypt(plaintext);
    expect(encResult.success).toBe(true);

    const decResult = decrypt((encResult as { success: true; data: Buffer }).data);
    expect(decResult.success).toBe(true);
    expect((decResult as { success: true; data: string }).data).toBe(plaintext);
  });

  it('encrypt generuje různé IV pro stejný plaintext (non-deterministic)', () => {
    const plaintext = 'stejný text';

    const enc1 = encrypt(plaintext);
    const enc2 = encrypt(plaintext);

    expect(enc1.success).toBe(true);
    expect(enc2.success).toBe(true);

    const buf1 = (enc1 as { success: true; data: Buffer }).data;
    const buf2 = (enc2 as { success: true; data: Buffer }).data;

    // IV jsou první 4 bytes — musí se lišit (s overwhelming probability)
    expect(buf1.subarray(0, 4).equals(buf2.subarray(0, 4))).toBe(false);
  });

  it('decrypt vrátí ENCRYPTION_ERROR pro příliš krátký Buffer', () => {
    const result = decrypt(Buffer.from([1, 2, 3]));
    expect(result.success).toBe(false);
    expect((result as { success: false; error: { code: string } }).error.code).toBe('ENCRYPTION_ERROR');
  });

  it('decrypt vrátí ENCRYPTION_ERROR pro poškozená data', () => {
    const encResult = encrypt('test');
    expect(encResult.success).toBe(true);

    const buf = (encResult as { success: true; data: Buffer }).data;
    // Poškození auth tagu
    buf[15] = buf[15] ^ 0xff;

    const decResult = decrypt(buf);
    expect(decResult.success).toBe(false);
  });

  it('šifruje prázdný string', () => {
    const enc = encrypt('');
    expect(enc.success).toBe(true);

    const dec = decrypt((enc as { success: true; data: Buffer }).data);
    expect(dec.success).toBe(true);
    expect((dec as { success: true; data: string }).data).toBe('');
  });

  it('šifruje unicode a speciální znaky', () => {
    const plaintext = 'Příliš žluťoučký kůň 🐴 пример テスト';

    const enc = encrypt(plaintext);
    const dec = decrypt((enc as { success: true; data: Buffer }).data);

    expect((dec as { success: true; data: string }).data).toBe(plaintext);
  });
});
