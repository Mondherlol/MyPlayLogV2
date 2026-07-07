import nodemailer from "nodemailer";

// Configuration SMTP via variables d'environnement :
//   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM
// Si rien n'est configuré, on retombe sur un mode "console" : le mail n'est pas
// envoyé mais son contenu (et le lien) est loggé, pratique en développement.

let transporter = null;
let ready = false;

function getTransporter() {
  if (transporter) return transporter;

  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    return null; // pas configuré → mode console
  }

  const port = Number(SMTP_PORT) || 587;
  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port,
    secure: port === 465, // true pour 465 (SSL), false pour les autres (STARTTLS)
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
  ready = true;
  return transporter;
}

/**
 * Envoie un email. En l'absence de config SMTP, logge simplement le contenu.
 * Ne throw jamais pour ne pas casser le flux applicatif (on log l'erreur).
 */
export async function sendMail({ to, subject, html, text }) {
  const tx = getTransporter();
  const from = process.env.MAIL_FROM || "MyPlayLog <no-reply@myplaylog.cc>";

  if (!tx) {
    console.log(
      "\n📭 [mailer] SMTP non configuré — email non envoyé (mode console)\n" +
        `   À      : ${to}\n` +
        `   Objet  : ${subject}\n` +
        `   Texte  : ${text || "(voir HTML)"}\n`
    );
    return { queued: false, preview: text };
  }

  try {
    const info = await tx.sendMail({ from, to, subject, html, text });
    console.log(`📧 [mailer] Email envoyé à ${to} (${info.messageId})`);
    return { queued: true, messageId: info.messageId };
  } catch (err) {
    console.error("[mailer] Échec de l'envoi:", err.message);
    return { queued: false, error: err.message };
  }
}

export function mailerConfigured() {
  getTransporter();
  return ready;
}
