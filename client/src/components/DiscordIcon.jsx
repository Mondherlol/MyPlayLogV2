// Logo Discord en SVG (monochrome, hérite de `currentColor`) — même parti pris
// que SteamIcon / PsnIcon : pas d'image distante, pas d'emoji.
export default function DiscordIcon({ size = 24, ...props }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      {...props}
    >
      <path d="M19.27 5.33A16.5 16.5 0 0 0 15.16 4l-.25.5a12.7 12.7 0 0 1 3.66 1.86 12.9 12.9 0 0 0-11.14 0A12.7 12.7 0 0 1 11.1 4.5L10.84 4a16.5 16.5 0 0 0-4.11 1.33C3.9 9.52 3.13 13.6 3.5 17.62a16.6 16.6 0 0 0 5.05 2.55l.98-1.66c-.55-.2-1.08-.46-1.58-.77l.39-.29a11.85 11.85 0 0 0 10.32 0l.39.29c-.5.31-1.03.57-1.58.77l.98 1.66a16.6 16.6 0 0 0 5.05-2.55c.43-4.65-.74-8.7-3.23-12.29ZM9.68 15.13c-.98 0-1.79-.9-1.79-2s.79-2.02 1.79-2.02 1.8.91 1.79 2.02c0 1.1-.8 2-1.79 2Zm4.64 0c-.98 0-1.79-.9-1.79-2s.79-2.02 1.79-2.02 1.8.91 1.79 2.02c0 1.1-.79 2-1.79 2Z" />
    </svg>
  );
}
