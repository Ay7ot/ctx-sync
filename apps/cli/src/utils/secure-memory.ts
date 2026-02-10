/**
 * Secure memory handling utilities.
 *
 * Provides best-effort memory cleanup for sensitive data.
 * Buffers are zeroed after use; string clearing is best-effort
 * due to JavaScript string immutability.
 *
 * **Limitations (documented trade-offs):**
 * - JavaScript strings are immutable and interned by the V8 engine.
 *   Once a string is created, we cannot reliably zero it from memory.
 *   The `clearString` function is a best-effort signal; true clearing
 *   requires using Buffer/Uint8Array for sensitive data throughout.
 * - The garbage collector may copy data before we can zero it.
 * - V8 may keep optimised copies in JIT-compiled code.
 *
 * For maximum security, prefer using Buffers for sensitive data and
 * pass them through `withSecret()` to ensure cleanup.
 *
 * @module utils/secure-memory
 */

/**
 * Execute a function with a secret buffer, ensuring the buffer is
 * zeroed in the `finally` block regardless of success or failure.
 *
 * @param buffer - The buffer containing sensitive data.
 * @param fn - The function to execute with the buffer.
 * @returns The return value of `fn`.
 */
export async function withSecret<T>(buffer: Buffer, fn: (buf: Buffer) => T | Promise<T>): Promise<T> {
  try {
    return await fn(buffer);
  } finally {
    buffer.fill(0);
  }
}

/**
 * Synchronous version of `withSecret`.
 *
 * @param buffer - The buffer containing sensitive data.
 * @param fn - The synchronous function to execute with the buffer.
 * @returns The return value of `fn`.
 */
export function withSecretSync<T>(buffer: Buffer, fn: (buf: Buffer) => T): T {
  try {
    return fn(buffer);
  } finally {
    buffer.fill(0);
  }
}

/**
 * Best-effort clearing of a string variable.
 *
 * **Important:** Due to JavaScript string immutability, this function
 * cannot guarantee the original string is removed from memory. It returns
 * an empty string that the caller should assign back to the variable.
 * The original string will be eligible for garbage collection, but may
 * persist in memory until the GC runs.
 *
 * Usage:
 * ```ts
 * let secret = 'my-secret';
 * // ... use secret ...
 * secret = clearString(secret);
 * // secret is now '', original may still be in memory until GC
 * ```
 *
 * @param _variable - The string to "clear" (unused, but required for intent).
 * @returns An empty string to assign back to the variable.
 */
export function clearString(_variable: string): string {
  // We cannot mutate the original string in JavaScript.
  // Return empty string for the caller to overwrite their reference.
  // The original string becomes eligible for garbage collection.
  return '';
}

/**
 * Zero out a Uint8Array (for use with raw crypto buffers).
 *
 * @param array - The array to zero.
 */
export function zeroOut(array: Uint8Array): void {
  array.fill(0);
}
