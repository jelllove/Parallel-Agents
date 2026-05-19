interface Props {
  className?: string;
  size?: number;
}

export function SessionIcon({ className, size = 16 }: Props) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M4 5h13a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H9l-4 3v-3H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z"
        fill="#5BC0EB"
        stroke="#2F8FB8"
        strokeWidth="0.8"
        strokeLinejoin="round"
      />
      <circle cx="8" cy="10.5" r="1" fill="#fff" />
      <circle cx="11.5" cy="10.5" r="1" fill="#fff" />
      <circle cx="15" cy="10.5" r="1" fill="#fff" />
    </svg>
  );
}
