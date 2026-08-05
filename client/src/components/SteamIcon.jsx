// Logo Steam en SVG (monochrome, hérite de `currentColor`) — pas d'emoji, dans
// l'esprit épuré du reste de l'app.
export default function SteamIcon({ size = 24, ...props }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      {...props}
    >
      <path d="M11.98 2C6.5 2 2.01 6.2 1.6 11.55l5.55 2.3a3.02 3.02 0 0 1 1.72-.53l2.47-3.58v-.05a4.02 4.02 0 1 1 4.02 4.02h-.1l-3.53 2.52a3.02 3.02 0 0 1-6-.15L2.2 14.9A10.01 10.01 0 0 0 11.98 22c5.52 0 10-4.48 10-10s-4.48-10-10-10Zm-3.7 15.18-1.27-.53a2.27 2.27 0 0 0 4.02.62 2.27 2.27 0 0 0-1.3-3.28 2.26 2.26 0 0 0-1.55-.03l1.32.55a1.67 1.67 0 1 1-1.28 3.08l.34.14ZM18.6 10.03a2.68 2.68 0 1 0-5.36 0 2.68 2.68 0 0 0 5.36 0Zm-4.69-.01a2.01 2.01 0 1 1 4.02 0 2.01 2.01 0 0 1-4.02 0Z" />
    </svg>
  );
}
