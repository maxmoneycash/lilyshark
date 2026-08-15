interface AsciiBarProps {
  width: number; // 0-20
  maxWidth?: number;
  char?: string;
  color?: string;
}

export function AsciiBar({ width, maxWidth = 20, char = '█', color = '#FF1493' }: AsciiBarProps) {
  const filledChars = Math.max(0, Math.min(width, maxWidth));
  const emptyChars = maxWidth - filledChars;

  return (
    <span style={{ fontFamily: 'monospace', whiteSpace: 'pre' }}>
      <span style={{ color }}>{char.repeat(filledChars)}</span>
      <span style={{ color: 'var(--background2)' }}>{char.repeat(emptyChars)}</span>
    </span>
  );
}
