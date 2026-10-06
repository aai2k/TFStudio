/** `bytes` random bytes as lowercase hex digits, two per byte. */
export function randomHex(bytes) {
    const values = crypto.getRandomValues(new Uint8Array(bytes));
    return Array.from(values, value => value.toString(16).padStart(2, '0')).join('');
}
