/**
 * Classic sixteen-bytes-per-row hex dump, for the SNIFFER frame detail:
 *
 *   0000  4c 53 4b 20 46 20 7b 22  73 72 63 22 3a 31 32 33  |LSK F {"src":123|
 *
 * Offsets and hex are padded so every row is the same width in a monospace
 * face; bytes outside printable ASCII show as a dot.
 */
export function hexDump(bytes: Uint8Array): string[] {
  const lines: string[] = [];
  for (let off = 0; off < bytes.length; off += 16) {
    const row = bytes.subarray(off, Math.min(off + 16, bytes.length));
    const hex: string[] = [];
    let ascii = '';
    for (let i = 0; i < 16; i++) {
      // The extra gap after the eighth byte keeps long rows countable.
      if (i === 8) hex.push('');
      if (i < row.length) {
        hex.push(row[i].toString(16).padStart(2, '0'));
        ascii += row[i] >= 0x20 && row[i] < 0x7f ? String.fromCharCode(row[i]) : '.';
      } else {
        hex.push('  ');
      }
    }
    lines.push(`${off.toString(16).padStart(4, '0')}  ${hex.join(' ')}  |${ascii}|`);
  }
  return lines;
}
