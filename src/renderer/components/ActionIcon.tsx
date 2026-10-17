export function ActionIcon({
  name,
  spinning = false,
}: {
  name: 'refresh' | 'cleanup' | 'rename' | 'folder' | 'branch' | 'grip';
  spinning?: boolean;
}) {
  return (
    <svg
      className={`action-icon${spinning ? ' spinning' : ''}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {name === 'refresh' ? (
        <>
          <path d="M20 7v5h-5M4 17v-5h5" />
          <path d="M6.2 6.2a8 8 0 0 1 13 3.3M4.8 14.5a8 8 0 0 0 13 3.3" />
        </>
      ) : name === 'grip' ? (
        <path d="M9 5h.01M15 5h.01M9 12h.01M15 12h.01M9 19h.01M15 19h.01" strokeWidth="3" />
      ) : name === 'folder' ? (
        <>
          <path d="M3 8V5a2 2 0 0 1 2-2h4l4 5" />
          <rect x="3" y="8" width="18" height="13" rx="2" />
        </>
      ) : name === 'branch' ? (
        <>
          <circle cx="6" cy="5" r="2" />
          <circle cx="6" cy="19" r="2" />
          <circle cx="18" cy="6" r="2" />
          <path d="M6 7v10M18 8v1a6 6 0 0 1-6 6H6" />
        </>
      ) : name === 'rename' ? (
        <>
          <path d="m15 4 5 5M4 20l1-6L16 3l5 5-11 11-6 1Z" />
        </>
      ) : (
        <>
          <path d="m14 4 6 6M5 20l-2-2 10-10 5 5-7 7H5Z" />
          <path d="m11 10 5 5M17 3l4 4M16 20h5" />
        </>
      )}
    </svg>
  );
}
