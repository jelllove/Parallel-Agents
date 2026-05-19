import claudeIconUrl from '../assets/claude-32.png';

interface Props {
  className?: string;
  size?: number;
}

export function ClaudeIcon({ className, size = 16 }: Props) {
  return (
    <img
      src={claudeIconUrl}
      className={className}
      width={size}
      height={size}
      alt=""
      draggable={false}
    />
  );
}
