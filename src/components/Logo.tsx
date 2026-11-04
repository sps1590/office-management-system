export default function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      className="shrink-0"
    >
      <rect width="32" height="32" rx="8" fill="var(--primary)" />
      {/* An office tower: three floors of windows plus a doorway. */}
      <rect x="9" y="8" width="4" height="4" rx="1" fill="var(--primary-fg)" opacity="0.95" />
      <rect x="15" y="8" width="4" height="4" rx="1" fill="var(--primary-fg)" opacity="0.6" />
      <rect x="9" y="14" width="4" height="4" rx="1" fill="var(--primary-fg)" opacity="0.6" />
      <rect x="15" y="14" width="4" height="4" rx="1" fill="var(--primary-fg)" opacity="0.95" />
      <rect x="21" y="14" width="3" height="4" rx="1" fill="var(--primary-fg)" opacity="0.45" />
      <path
        d="M11 24v-3a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v3"
        stroke="var(--primary-fg)"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <circle cx="23" cy="23" r="2.5" fill="var(--primary-fg)" opacity="0.9" />
    </svg>
  );
}
