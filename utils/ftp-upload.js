'use strict';
/**
 * utils/ftp-upload.js — Upload FTP/FTPS de fichiers HD post-render
 * ─────────────────────────────────────────────────────────────────────
 * Utilisé après la génération d'un PNG HD pour transférer le fichier
 * vers le serveur FTP du prestataire d'impression.
 *
 * Variables d'environnement :
 *   FTP_HOST        — Hôte FTP (ex: ftp.imprimeur.fr)
 *   FTP_PORT        — Port (défaut: 21)
 *   FTP_USER        — Nom d'utilisateur FTP
 *   FTP_PASSWORD    — Mot de passe FTP
 *   FTP_PATH        — Dossier distant (ex: /uploads/textilelab ou /)
 *   FTP_SECURE      — 'true' pour FTPS implicite (port 990), 'explicit' pour TLS explicite
 *
 * Dépendance : basic-ftp (légère, pas besoin de ftp natif Node)
 * Installer : npm install basic-ftp
 */

const path = require('path');
const fs   = require('fs');

// Lazy-require basic-ftp (optionnel — si non installé, FTP désactivé)
let ftpClientLib = null;
function _getFtpLib() {
  if (ftpClientLib) return ftpClientLib;
  try {
    ftpClientLib = require('basic-ftp');
    return ftpClientLib;
  } catch {
    return null;
  }
}

/**
 * Vérifie si FTP est configuré (variables d'env présentes)
 */
function isFtpConfigured() {
  return !!(process.env.FTP_HOST && process.env.FTP_USER && process.env.FTP_PASSWORD);
}

/**
 * Upload un fichier local vers le serveur FTP configuré.
 *
 * @param {string} localFilePath  Chemin absolu du fichier local à envoyer
 * @param {string} [remoteFileName]  Nom du fichier distant (défaut: basename du local)
 * @returns {Promise<{ ok: boolean, remotePath: string }>}
 */
async function uploadToFtp(localFilePath, remoteFileName) {
  const ftp = _getFtpLib();
  if (!ftp) {
    throw new Error('basic-ftp non installé. Exécuter : npm install basic-ftp');
  }

  if (!isFtpConfigured()) {
    throw new Error('FTP non configuré — définir FTP_HOST, FTP_USER, FTP_PASSWORD dans .env');
  }

  if (!fs.existsSync(localFilePath)) {
    throw new Error(`Fichier introuvable : ${localFilePath}`);
  }

  const host     = process.env.FTP_HOST;
  const port     = parseInt(process.env.FTP_PORT) || 21;
  const user     = process.env.FTP_USER;
  const password = process.env.FTP_PASSWORD;
  const ftpPath  = process.env.FTP_PATH  || '/';
  const secure   = process.env.FTP_SECURE || false; // false | 'explicit' | true(implicit)

  const filename   = remoteFileName || path.basename(localFilePath);
  const remotePath = `${ftpPath.replace(/\/$/, '')}/${filename}`;

  const client = new ftp.Client();
  client.ftp.verbose = process.env.NODE_ENV === 'development';

  try {
    await client.access({
      host,
      port,
      user,
      password,
      secure: secure === 'true' || secure === true ? true : secure === 'explicit' ? 'explicit' : false,
    });

    // Créer le dossier distant si nécessaire
    await client.ensureDir(ftpPath);

    // Upload du fichier
    await client.uploadFrom(localFilePath, remotePath);

    console.log(`✅  FTP upload OK — ${filename} → ${host}${remotePath}`);
    return { ok: true, remotePath };

  } finally {
    client.close();
  }
}

/**
 * Upload asynchrone (fire-and-forget) avec retry automatique.
 * Utilisé après la sauvegarde d'un render HD pour ne pas bloquer la réponse HTTP.
 *
 * @param {string} localFilePath    Chemin du fichier PNG HD
 * @param {string} [remoteFileName] Nom distant (défaut: basename)
 * @param {number} [maxRetries=3]   Nombre max de tentatives
 */
function uploadToFtpAsync(localFilePath, remoteFileName, maxRetries = 3) {
  if (!isFtpConfigured()) {
    // FTP non configuré → silencieux
    return;
  }

  let attempt = 0;

  async function tryUpload() {
    attempt++;
    try {
      await uploadToFtp(localFilePath, remoteFileName);
    } catch (err) {
      console.warn(`⚠️  FTP upload tentative ${attempt}/${maxRetries} échouée:`, err.message);
      if (attempt < maxRetries) {
        // Attente exponentielle : 5s, 15s, 45s
        const delay = 5000 * Math.pow(3, attempt - 1);
        setTimeout(tryUpload, delay);
      } else {
        console.error(`❌  FTP upload abandonné après ${maxRetries} tentatives: ${path.basename(localFilePath)}`);
      }
    }
  }

  // Démarrer l'upload dans le prochain tick (ne bloque pas)
  setImmediate(tryUpload);
}

module.exports = { uploadToFtp, uploadToFtpAsync, isFtpConfigured };
