// Le « G » de Google, en SVG.
//
// ⚠️ SEULE ICÔNE DE MARQUE EN COULEURS DU LOT (SteamIcon, DiscordIcon et
// PsnIcon héritent de `currentColor`), et ce n'est pas un oubli : les règles
// d'identité de Google interdisent de recolorer le logo. Il garde donc ses
// quatre couleurs sur les deux thèmes — d'où le pastille blanche derrière lui
// dans la feuille de style du bouton, pour qu'il reste lisible en sombre.
export default function GoogleIcon({ size = 24, ...props }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      aria-hidden="true"
      {...props}
    >
      <path
        fill="#4285F4"
        d="M45.12 24.5c0-1.56-.14-3.06-.4-4.5H24v8.51h11.84a10.13 10.13 0 0 1-4.39 6.65v5.52h7.11c4.16-3.83 6.56-9.47 6.56-16.18Z"
      />
      <path
        fill="#34A853"
        d="M24 46c5.94 0 10.92-1.97 14.56-5.33l-7.11-5.52c-1.97 1.32-4.49 2.1-7.45 2.1-5.73 0-10.58-3.87-12.31-9.07H4.34v5.7A21.99 21.99 0 0 0 24 46Z"
      />
      <path
        fill="#FBBC05"
        d="M11.69 28.18a13.2 13.2 0 0 1 0-8.36v-5.7H4.34a21.99 21.99 0 0 0 0 19.76l7.35-5.7Z"
      />
      <path
        fill="#EA4335"
        d="M24 9.75c3.23 0 6.13 1.11 8.41 3.29l6.31-6.31C34.91 3.18 29.93 1 24 1 15.4 1 7.96 5.93 4.34 13.12l7.35 5.7C13.42 13.62 18.27 9.75 24 9.75Z"
      />
    </svg>
  );
}
