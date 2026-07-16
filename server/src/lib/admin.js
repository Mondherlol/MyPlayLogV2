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
