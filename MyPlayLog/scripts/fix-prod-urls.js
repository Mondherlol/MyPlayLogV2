// Migration one-shot : réécrit les URLs d'images stockées en absolu dans la
// base (héritées du dev en local) vers le domaine de prod.
//
// Usage (dans le conteneur mongo) :
//   docker compose exec mongo mongosh myplaylog /tmp/fix-prod-urls.js
//
// Parcourt TOUTES les collections et tous les documents (récursivement) et
// remplace les anciens hôtes par https://myplaylog.cc, sans toucher aux
// types BSON (ObjectId, Date, etc.).

const NEW = "https://myplaylog.cc";
const OLD_HOSTS = [
  "http://localhost:4000",
  "http://127.0.0.1:4000",
  "http://192.168.1.199:4000",
];

function fixStr(s) {
  let out = s;
  for (const h of OLD_HOSTS) out = out.split(h).join(NEW);
  return out;
}

// Mute l'objet en place ; renvoie true si quelque chose a changé.
function walk(obj) {
  let mutated = false;
  for (const k in obj) {
    const v = obj[k];
    if (typeof v === "string") {
      const nv = fixStr(v);
      if (nv !== v) { obj[k] = nv; mutated = true; }
    } else if (Array.isArray(v)) {
      for (let i = 0; i < v.length; i++) {
        const e = v[i];
        if (typeof e === "string") {
          const nv = fixStr(e);
          if (nv !== e) { v[i] = nv; mutated = true; }
        } else if (e && e.constructor === Object) {
          if (walk(e)) mutated = true;
        }
      }
    } else if (v && v.constructor === Object) {
      if (walk(v)) mutated = true;
    }
  }
  return mutated;
}

let total = 0;
db.getCollectionNames().forEach((name) => {
  const col = db.getCollection(name);
  let n = 0;
  col.find().forEach((doc) => {
    if (walk(doc)) {
      col.replaceOne({ _id: doc._id }, doc);
      n++;
    }
  });
  if (n) print(`  ${name}: ${n} document(s) mis à jour`);
  total += n;
});
print(`✅ Terminé — ${total} document(s) réécrit(s) vers ${NEW}`);
