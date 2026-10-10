'use strict';
/**
 * utils/email-resume.js — Logique pure du lien de reprise envoyé par email
 * ─────────────────────────────────────────────────────────────────────────
 * Backlog item 25 : un visiteur NON connecté qui interrompt sa personnalisation
 * peut demander à recevoir par email un lien pour la reprendre plus tard. À la
 * différence de l'item 24 (reprise automatique pour un client connecté, via
 * un jeton signé), ici c'est le visiteur lui-même qui fournit une adresse —
 * jamais d'identité client requise.
 *
 * Extrait en module pur (même raison qu'utils/design-resume.js : routes/
 * designs.js require routes/auth.js, qui pose un setInterval de nettoyage de
 * sessions au require() — incompatible avec `node --test`).
 */

// Même regex que routes/orders.js (validation de l'email client à la commande).
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isValidEmail(email) {
  return typeof email === 'string' && EMAIL_RE.test(email.trim());
}

/**
 * Vérité de possession du design (même logique que _designTokenOk dans
 * routes/render.js lignes 14-22) : sans elle, un id séquentiel permettrait à
 * n'importe qui de faire envoyer par TSL le lien de la création de quelqu'un
 * d'autre à l'adresse email de son choix. Designs legacy (edit_token NULL)
 * tolérés pour ne pas casser l'existant.
 */
function designTokenOk(row, suppliedToken) {
  if (!row) return false;
  if (!row.edit_token) return true;
  const supplied = String(suppliedToken || '');
  return supplied.length > 0 && supplied === row.edit_token;
}

function buildResumeEmailHtml(link) {
  const safeLink = String(link);
  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #111; max-width: 480px;">
      <p>Vous avez commencé une personnalisation sur notre configurateur.</p>
      <p>Cliquez sur le lien ci-dessous pour la reprendre exactement où vous l'avez laissée :</p>
      <p><a href="${safeLink}" style="display: inline-block; padding: 10px 18px; background: #111; color: #fff; text-decoration: none; border-radius: 6px;">Reprendre ma création</a></p>
      <p style="font-size: 12px; color: #666;">Si le bouton ne fonctionne pas, copiez ce lien dans votre navigateur : ${safeLink}</p>
    </div>
  `;
}

module.exports = { isValidEmail, designTokenOk, buildResumeEmailHtml };
