import crypto from 'crypto';
import { env } from '../config/env';
import { AES_ALGORITHM, AES_IV_BYTES, AES_TAG_BYTES } from '../config/constants';
import { Result, ErrorCode } from '../types';

// Buffer layout: [IV (12 bytes)][AuthTag (16 bytes)][Ciphertext (N bytes)]

const getKey = (): Buffer => Buffer.from(env.ENCRYPTION_KEY, 'hex');

/**
 * Šifruje plaintext string pomocí AES-256-GCM.
 * Výsledný Buffer je vhodný pro uložení do PostgreSQL bytea sloupce.
 *
 * @param plaintext - Řetězec k zašifrování (např. Teams Webhook URL)
 * @returns Result s Buffer [IV|AuthTag|Ciphertext] nebo chybou
 */
export function encrypt(plaintext: string): Result<Buffer> {
  try {
    const iv = crypto.randomBytes(AES_IV_BYTES);
    const cipher = crypto.createCipheriv(AES_ALGORITHM, getKey(), iv);

    const encrypted = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);

    const authTag = cipher.getAuthTag();

    return {
      success: true,
      data: Buffer.concat([iv, authTag, encrypted]),
    };
  } catch {
    return {
      success: false,
      error: {
        code: ErrorCode.ENCRYPTION_ERROR,
        message: 'Šifrování selhalo',
        statusCode: 500,
      },
    };
  }
}

/**
 * Dešifruje Buffer z DB (vytvořený funkcí encrypt()).
 *
 * @param encrypted - Buffer z DB [IV|AuthTag|Ciphertext]
 * @returns Result s plaintext stringem nebo chybou
 */
export function decrypt(encrypted: Buffer): Result<string> {
  try {
    if (encrypted.length < AES_IV_BYTES + AES_TAG_BYTES) {
      return {
        success: false,
        error: {
          code: ErrorCode.ENCRYPTION_ERROR,
          message: 'Neplatný šifrovaný Buffer — příliš krátký',
          statusCode: 500,
        },
      };
    }

    const iv      = encrypted.subarray(0, AES_IV_BYTES);
    const authTag = encrypted.subarray(AES_IV_BYTES, AES_IV_BYTES + AES_TAG_BYTES);
    const data    = encrypted.subarray(AES_IV_BYTES + AES_TAG_BYTES);

    const decipher = crypto.createDecipheriv(AES_ALGORITHM, getKey(), iv);
    decipher.setAuthTag(authTag);

    const plaintext = Buffer.concat([
      decipher.update(data),
      decipher.final(),
    ]).toString('utf8');

    return { success: true, data: plaintext };
  } catch {
    return {
      success: false,
      error: {
        code: ErrorCode.ENCRYPTION_ERROR,
        message: 'Dešifrování selhalo — neplatný klíč nebo poškozená data',
        statusCode: 500,
      },
    };
  }
}
