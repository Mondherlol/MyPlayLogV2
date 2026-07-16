// Le « super-admin » est l'unique compte désigné par ADMIN_EMAIL (server/.env).
// Son compte PSN sert de source pour la liste des trophées visible par tous, et
// lui seul ne peut être ni rétrogradé ni supprimé. Les autres administrateurs
// sont nommés depuis le panel Admin (champ User.isAdmin).
export function isAdminEmail(email) {
  const admin = (process.env.ADMIN_EMAIL || "").trim().toLowerCase();
  return !!admin && String(email || "").toLowerCase() === admin;
}

// Un utilisateur est admin s'il est le super-admin (ADMIN_EMAIL) OU s'il a été
// promu (isAdmin). Accepte un document User (ou un objet lean { email, isAdmin }).
export function isUserAdmin(user) {
  if (!user) return false;
  return isAdminEmail(user.email) || !!user.isAdmin;
}
