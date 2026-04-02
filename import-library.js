#!/usr/bin/env node
// Script d'import batch — enregistre en DB tous les fichiers du dossier uploads/library/
// qui ne sont pas encore dans la table library
// Usage : node import-library.js [categorie]

'use strict';
const path = require('path');
const fs   = require('fs');

const UPLOADS_DIR = path.join(__dirname, 'uploads', 'library');
const DEFAULT_CAT = process.argv[2] || 'divers';

// Init DB
const { initDB, getDB } = require('./db/database');
initDB();
const db = getDB();

// Lire les fichiers existants en DB
const existing = new Set(
  db.prepare('SELECT filename FROM library').all().map(r => r.filename)
);

// Scanner le dossier
const ALLOWED = ['.png', '.jpg', '.jpeg', '.webp', '.svg', '.gif'];
const files   = fs.readdirSync(UPLOADS_DIR).filter(f => {
  const ext = path.extname(f).toLowerCase();
  return ALLOWED.includes(ext) && !f.startsWith('__cat_placeholder_');
});

const toImport = files.filter(f => !existing.has(f));

if (toImport.length === 0) {
  console.log('✅ Tous les fichiers sont déjà en base de données.');
  process.exit(0);
}

console.log(`📦 ${toImport.length} fichier(s) à importer dans la catégorie "${DEFAULT_CAT}"...\n`);

const insert = db.prepare(
  'INSERT INTO library (filename, url, category, mimetype, size) VALUES (?,?,?,?,?)'
);

const MIME = {
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg':  'image/svg+xml',
  '.gif':  'image/gif',
};

let ok = 0;
for (const filename of toImport) {
  try {
    const ext      = path.extname(filename).toLowerCase();
    const url      = `/uploads/library/${filename}`;
    const mimetype = MIME[ext] || 'image/png';
    const size     = fs.statSync(path.join(UPLOADS_DIR, filename)).size;
    insert.run(filename, url, DEFAULT_CAT, mimetype, size);
    console.log(`  ✅ ${filename}`);
    ok++;
  } catch(e) {
    console.log(`  ❌ ${filename}: ${e.message}`);
  }
}

console.log(`\n✅ ${ok}/${toImport.length} fichier(s) importé(s) dans "${DEFAULT_CAT}".`);
console.log('Relancez avec : node import-library.js <nom-categorie>');
