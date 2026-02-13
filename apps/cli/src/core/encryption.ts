/**
 * Age encryption wrapper module.
 *
 * Provides key generation, encryption, and decryption operations
 * using the Age encryption library. All operations are in-memory only —
 * no temporary files are created during crypto operations.
 *
 * @module core/encryption
 */

import { Encrypter, Decrypter, generateIdentity, identityToRecipient } from 'age-encryption';
import { armor } from 'age-encryption';

/**
 * Generate a new Age key pair.
 *
 * @returns Object containing the public key (age1...) and private key (AGE-SECRET-KEY-...).
 */
export async function generateKey(): Promise<{ publicKey: string; privateKey: string }> {
  const privateKey = await generateIdentity();
  const publicKey = await identityToRecipient(privateKey);
  return { publicKey, privateKey };
}

/**
 * Encrypt a plaintext string with an Age public key.
 *
 * @param plaintext - The string to encrypt.
 * @param publicKey - The Age public key (age1...) to encrypt for.
 * @returns ASCII-armored Age ciphertext.
 * @throws If the public key is invalid.
 */
export async function encrypt(plaintext: string, publicKey: string): Promise<string> {
  const encrypter = new Encrypter();
  encrypter.addRecipient(publicKey);
  const encrypted = await encrypter.encrypt(plaintext);
  return armor.encode(encrypted);
}

/**
 * Decrypt an ASCII-armored Age ciphertext with a private key.
 *
 * @param ciphertext - The ASCII-armored Age ciphertext.
 * @param privateKey - The Age private key (AGE-SECRET-KEY-...).
 * @returns The decrypted plaintext string.
 * @throws If the private key cannot decrypt the ciphertext.
 */
export async function decrypt(ciphertext: string, privateKey: string): Promise<string> {
  const decrypter = new Decrypter();
  decrypter.addIdentity(privateKey);
  const decoded = armor.decode(ciphertext);
  return decrypter.decrypt(decoded, 'text');
}

/**
 * Encrypt a typed data object as JSON into an Age ciphertext blob.
 * The data is serialised to JSON in memory, then encrypted.
 * No plaintext JSON is ever written to disk.
 *
 * @param data - The data to encrypt.
 * @param publicKey - The Age public key to encrypt for.
 * @returns ASCII-armored Age ciphertext containing the serialised JSON.
 */
export async function encryptState<T>(data: T, publicKey: string): Promise<string> {
  const json = JSON.stringify(data);
  return encrypt(json, publicKey);
}

/**
 * Decrypt an Age ciphertext blob and parse the JSON back into a typed object.
 *
 * @param ciphertext - The ASCII-armored Age ciphertext.
 * @param privateKey - The Age private key.
 * @returns The decrypted and parsed data.
 * @throws If decryption fails or the JSON is invalid.
 */
export async function decryptState<T>(ciphertext: string, privateKey: string): Promise<T> {
  const json = await decrypt(ciphertext, privateKey);
  return JSON.parse(json) as T;
}

/**
 * Encrypt a plaintext string for multiple Age recipients.
 *
 * All recipients can independently decrypt the resulting ciphertext
 * using their own private key. This enables team/multi-machine support.
 *
 * @param plaintext - The string to encrypt.
 * @param publicKeys - Array of Age public keys (age1...) to encrypt for.
 * @returns ASCII-armored Age ciphertext.
 * @throws If any public key is invalid or the array is empty.
 */
export async function encryptForRecipients(
  plaintext: string,
  publicKeys: string[],
): Promise<string> {
  if (publicKeys.length === 0) {
    throw new Error('At least one recipient public key is required.');
  }

  const encrypter = new Encrypter();
  for (const key of publicKeys) {
    encrypter.addRecipient(key);
  }
  const encrypted = await encrypter.encrypt(plaintext);
  return armor.encode(encrypted);
}

/**
 * Encrypt a typed data object as JSON for multiple Age recipients.
 *
 * Serialises the data to JSON in memory, then encrypts for all recipients.
 * No plaintext JSON is ever written to disk.
 *
 * @param data - The data to encrypt.
 * @param publicKeys - Array of Age public keys to encrypt for.
 * @returns ASCII-armored Age ciphertext containing the serialised JSON.
 */
export async function encryptStateForRecipients<T>(
  data: T,
  publicKeys: string[],
): Promise<string> {
  const json = JSON.stringify(data);
  return encryptForRecipients(json, publicKeys);
}
