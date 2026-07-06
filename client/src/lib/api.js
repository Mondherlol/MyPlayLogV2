// Petit wrapper autour de fetch pour parler à l'API MyPlayLog.
const BASE = import.meta.env.VITE_API_URL || "http://localhost:4000/api";

export async function apiFetch(path, { method = "GET", body, token } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  let data = null;
  try {
    data = await res.json();
  } catch {
    /* réponse sans corps JSON */
  }

  if (!res.ok) {
    throw new Error(data?.error || "Une erreur est survenue.");
  }
  return data;
}

// Upload d'un fichier (multipart). Ne pas fixer Content-Type : le navigateur
// s'en charge (avec le boundary).
export async function apiUpload(path, formData, token, method = "POST") {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: formData,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* pas de JSON */
  }
  if (!res.ok) throw new Error(data?.error || "Échec de l'upload.");
  return data;
}

// Base de l'API (utile pour construire des URLs d'images servies par le serveur)
export const API_BASE = BASE;
