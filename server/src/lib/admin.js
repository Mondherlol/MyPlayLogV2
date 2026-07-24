// Le « super-admin » est désormais un RÔLE en base (User.isSuperAdmin), unique.
// ADMIN_EMAIL (server/.env) ne sert plus qu'à bootstrapper le tout premier
// super-admin au démarrage si aucun n'existe encore (voir ensureSuperAdmin).

// Vrai si l'email correspond à ADMIN_EMAIL. Utilisé UNIQUEMENT pour le bootstrap.
export function isAdminEmail(email) {
  const admin = (process.env.ADMIN_EMAIL || "").trim().toLowerCase();
  return !!admin && String(email || "").toLowerCase() === admin;
}

// Le compte de service PSN (source des trophées). Accepte un doc User / objet lean.
export function isSuper(user) {
  return !!user?.isSuperAdmin;
}

// Un utilisateur est admin s'il est super-admin OU administrateur simple.
// Accepte un document User (ou un objet lean { isSuperAdmin, isAdmin }).
export function isUserAdmin(user) {
  if (!user) return false;
  return !!user.isSuperAdmin || !!user.isAdmin;
}

// L'onglet « Téléchargements » d'une fiche de jeu n'est ouvert à PERSONNE par
// défaut : l'accès se donne à la main, compte par compte, depuis le panel admin
// (User.canDownload). Les administrateurs l'ont d'office — ce sont eux qui
// distribuent le droit, les priver de la fonction qu'ils administrent n'aurait
// pas de sens (et personne ne pourrait se l'accorder en premier).
export function canUserDownload(user) {
  if (!user) return false;
  return isUserAdmin(user) || !!user.canDownload;
}
