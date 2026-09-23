import crypto from "node:crypto";

// ======================================================================
//  UN PETIT COFFRE POUR LES SECRETS D'AUTRUI
// ======================================================================
//
// ⚠️ CE QU'ON GARDE ICI N'EST PAS À NOUS. Le jeton PlayStation d'un joueur
// ouvre SON compte : il ne se range pas en clair dans une base, à côté de son
// pseudo, où la moindre fuite de sauvegarde le livrerait tel quel.
//
// AES-256-GCM : chiffré ET authentifié (on saura si quelqu'un a retouché la
// valeur). La clé se dérive du secret de session du serveur — pas de variable
// d'environnement de plus à déployer, et changer `JWT_SECRET` invalide les
// jetons stockés, ce qui est le comportement souhaitable : ils deviennent
// illisibles au lieu de rester exploitables.
//
// Ce n'est pas un coffre-fort matériel ; c'est le niveau juste au-dessus du
// « en clair », et c'est celui qui manquait.

const ALGO = "aes-256-gcm";

function key() {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET manquant : impossible de chiffrer.");
  // Un sel fixe, pour que cette clé ne soit pas celle qui signe les sessions.
  return crypto.createHash("sha256").update(`psn:${secret}`).digest();
}

/** Chiffre une valeur. Renvoie une chaîne « iv.tag.données » en base64url. */
export function seal(value) {
  const text = String(value ?? "");
  if (!text) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key(), iv);
  const data = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, data].map((b) => b.toString("base64url")).join(".");
}

/** Déchiffre ce que `seal` a produit. `null` si absent, illisible ou retouché. */
export function open(packed) {
  try {
    const [iv, tag, data] = String(packed || "").split(".");
    if (!iv || !tag || !data) return null;
    const decipher = crypto.createDecipheriv(ALGO, key(), Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return (
      decipher.update(Buffer.from(data, "base64url")).toString("utf8") +
      decipher.final("utf8")
    );
  } catch {
    return null; // clé changée, valeur corrompue : on ne devine pas
  }
}
