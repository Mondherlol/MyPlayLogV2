// ======================================================================
//  Les marques que lucide ne dessine plus
// ======================================================================
// ⚠️ LUCIDE V1 A RETIRÉ TOUTES SES ICÔNES DE MARQUE. Les liens d'une fiche de
// jeu pointent pourtant vers X, Reddit ou Wikipédia, et un symbole générique à
// leur place (un @, un forum, un livre) se lit moins vite que le logo : c'est
// justement le rôle d'un logo.
//
// Les tracés viennent de Simple Icons (https://simpleicons.org), publiés sous
// CC0 — récupérés depuis le paquet officiel, pas redessinés à la main. Les
// logos eux-mêmes restent la propriété de leurs détenteurs : ils servent ici à
// DÉSIGNER le site vers lequel on part, ce pour quoi ils existent.
//
// Même forme que lib/storeIcons.js (`viewBox` + `d`, monochrome, teinté par
// `currentColor`) pour que components/GameSiteIcon les dessine pareil.
// La couleur de chaque marque sur la rangée de liens de la fiche. `c` teinte
// le logo (et devient le fond au survol) ; `on` est l'encre posée sur ce fond.
// ⚠️ LES MARQUES NOIR/BLANC SUIVENT LE THÈME. Le logo d'Epic, de X ou de
// Wikipédia est noir sur blanc ou blanc sur noir : une couleur fixe aurait
// disparu dans l'un des deux thèmes. On prend donc l'encre du texte.
// Steam et GOG sont éclaircis : leurs teintes officielles (#1b2838, #86328a)
// se perdent sur un fond sombre.
export const SITE_COLORS = {
  official: { c: "#f2b70b", on: "#161618" },
  steam: { c: "#1a9fff" },
  epic: { c: "var(--text)", on: "var(--bg)" },
  gog: { c: "#a54fd8" },
  itch: { c: "#fa5c5c" },
  youtube: { c: "#ff0033" },
  twitch: { c: "#9146ff" },
  kick: { c: "#53fc18", on: "#0b1a02" },
  twitter: { c: "var(--text)", on: "var(--bg)" },
  reddit: { c: "#ff4500" },
  discord: { c: "#5865f2" },
  wikipedia: { c: "var(--text)", on: "var(--bg)" },
  googleplay: { c: "#01875f" },
  appstore: { c: "#0d84ff" },
  gamepass: { c: "#1fa81f" },
};

export const SITE_BRANDS = {
  twitter: {
    label: "X / Twitter",
    viewBox: "0 0 24 24",
    d: "M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z",
  },
  reddit: {
    label: "Reddit",
    viewBox: "0 0 24 24",
    d: "M12 0C5.373 0 0 5.373 0 12c0 3.314 1.343 6.314 3.515 8.485l-2.286 2.286C.775 23.225 1.097 24 1.738 24H12c6.627 0 12-5.373 12-12S18.627 0 12 0Zm4.388 3.199c1.104 0 1.999.895 1.999 1.999 0 1.105-.895 2-1.999 2-.946 0-1.739-.657-1.947-1.539v.002c-1.147.162-2.032 1.15-2.032 2.341v.007c1.776.067 3.4.567 4.686 1.363.473-.363 1.064-.58 1.707-.58 1.547 0 2.802 1.254 2.802 2.802 0 1.117-.655 2.081-1.601 2.531-.088 3.256-3.637 5.876-7.997 5.876-4.361 0-7.905-2.617-7.998-5.87-.954-.447-1.614-1.415-1.614-2.538 0-1.548 1.255-2.802 2.803-2.802.645 0 1.239.218 1.712.585 1.275-.79 2.881-1.291 4.64-1.365v-.01c0-1.663 1.263-3.034 2.88-3.207.188-.911.993-1.595 1.959-1.595Zm-8.085 8.376c-.784 0-1.459.78-1.506 1.797-.047 1.016.64 1.429 1.426 1.429.786 0 1.371-.369 1.418-1.385.047-1.017-.553-1.841-1.338-1.841Zm7.406 0c-.786 0-1.385.824-1.338 1.841.047 1.017.634 1.385 1.418 1.385.785 0 1.473-.413 1.426-1.429-.046-1.017-.721-1.797-1.506-1.797Zm-3.703 4.013c-.974 0-1.907.048-2.77.135-.147.015-.241.168-.183.305.483 1.154 1.622 1.964 2.953 1.964 1.33 0 2.47-.81 2.953-1.964.057-.137-.037-.29-.184-.305-.863-.087-1.795-.135-2.769-.135Z",
  },
  wikipedia: {
    label: "Wikipédia",
    viewBox: "0 0 24 24",
    d: "M12.09 13.119c-.936 1.932-2.217 4.548-2.853 5.728-.616 1.074-1.127.931-1.532.029-1.406-3.321-4.293-9.144-5.651-12.409-.251-.601-.441-.987-.619-1.139-.181-.15-.554-.24-1.122-.271C.103 5.033 0 4.982 0 4.898v-.455l.052-.045c.924-.005 5.401 0 5.401 0l.051.045v.434c0 .119-.075.176-.225.176l-.564.031c-.485.029-.727.164-.727.436 0 .135.053.33.166.601 1.082 2.646 4.818 10.521 4.818 10.521l.136.046 2.411-4.81-.482-1.067-1.658-3.264s-.318-.654-.428-.872c-.728-1.443-.712-1.518-1.447-1.617-.207-.023-.313-.05-.313-.149v-.468l.06-.045h4.292l.113.037v.451c0 .105-.076.15-.227.15l-.308.047c-.792.061-.661.381-.136 1.422l1.582 3.252 1.758-3.504c.293-.64.233-.801.111-.947-.07-.084-.305-.22-.812-.24l-.201-.021c-.052 0-.098-.015-.145-.051-.045-.031-.067-.076-.067-.129v-.427l.061-.045c1.247-.008 4.043 0 4.043 0l.059.045v.436c0 .121-.059.178-.193.178-.646.03-.782.095-1.023.439-.12.186-.375.589-.646 1.039l-2.301 4.273-.065.135 2.792 5.712.17.048 4.396-10.438c.154-.422.129-.722-.064-.895-.197-.172-.346-.273-.857-.295l-.42-.016c-.061 0-.105-.014-.152-.045-.043-.029-.072-.075-.072-.119v-.436l.059-.045h4.961l.041.045v.437c0 .119-.074.18-.209.18-.648.03-1.127.18-1.443.421-.314.255-.557.616-.736 1.067 0 0-4.043 9.258-5.426 12.339-.525 1.007-1.053.917-1.503-.031-.571-1.171-1.773-3.786-2.646-5.71l.053-.036z",
  },
};
