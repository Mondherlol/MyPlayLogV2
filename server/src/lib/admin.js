// L'admin est l'unique compte désigné par ADMIN_EMAIL (server/.env).
// Son compte PSN sert de source pour la liste des trophées visible par tous.
export function isAdminEmail(email) {
  const admin = (process.env.ADMIN_EMAIL || "").trim().toLowerCase();
  return !!admin && String(email || "").toLowerCase() === admin;
}
