'use strict';

const fs   = require('fs');
const path = require('path');

/**
 * uploadToShopifyFiles(localFilePath, shop, accessToken)
 *
 * 1. stagedUploadsCreate  → obtenir une URL signée AWS S3
 * 2. PUT du buffer PNG     → uploader directement vers S3 (URL présignée, ne pas modifier)
 * 3. fileCreate            → finaliser dans Shopify Files
 * 4. Retourne l'URL CDN   → https://cdn.shopify.com/s/files/...
 */
async function uploadToShopifyFiles(localFilePath, shop, accessToken) {
  const filename   = path.basename(localFilePath);
  const fileBuffer = fs.readFileSync(localFilePath);
  const fileSize   = fileBuffer.length;

  const GQL = `https://${shop}/admin/api/2024-01/graphql.json`;
  const headers = {
    'Content-Type':           'application/json',
    'X-Shopify-Access-Token': accessToken,
  };

  // ── 1. stagedUploadsCreate ───────────────────────────────────────────────
  const stageRes = await fetch(GQL, {
    method:  'POST',
    headers,
    body: JSON.stringify({
      query: `mutation stagedUploadsCreate($input:[StagedUploadInput!]!) {
        stagedUploadsCreate(input:$input) {
          stagedTargets { url resourceUrl parameters { name value } }
          userErrors     { field message }
        }
      }`,
      variables: {
        input: [{
          filename,
          mimeType:   'image/png',
          httpMethod: 'PUT',
          resource:   'FILE',
          fileSize:   String(fileSize),
        }],
      },
    }),
  });

  const stageData  = await stageRes.json();
  const target     = stageData?.data?.stagedUploadsCreate?.stagedTargets?.[0];
  const stageErrs  = stageData?.data?.stagedUploadsCreate?.userErrors;
  if (!target) {
    const err = new Error(stageErrs?.map(e => e.message).join(', ') || 'stagedUploadsCreate: pas de target');
    err.graphqlErrors = stageErrs;
    console.error('[shopify-files] stagedUploadsCreate raw:', JSON.stringify(stageData?.errors || stageErrs));
    throw err;
  }

  // ── 2. PUT vers l'URL S3 présignée ───────────────────────────────────────
  // IMPORTANT : ne PAS modifier l'URL (pas de query params supplémentaires)
  // Les paramètres retournés par Shopify sont des headers HTTP, pas des query params.
  // Ajouter des params à une URL S3 présignée invalide la signature → 403.
  const putHeaders = { 'Content-Type': 'image/png' };
  for (const { name, value } of (target.parameters || [])) {
    // Ne pas écraser Content-Type si déjà défini
    if (name.toLowerCase() !== 'content-type') {
      putHeaders[name] = value;
    }
  }

  console.log(`[shopify-files] PUT → ${target.url.split('?')[0]}... (${fileSize} bytes)`);
  const putRes = await fetch(target.url, {
    method:  'PUT',
    headers: putHeaders,
    body:    fileBuffer,
  });

  if (!putRes.ok) {
    const body = await putRes.text().catch(() => '');
    console.error(`[shopify-files] PUT S3 échoué HTTP ${putRes.status}:`, body.slice(0, 300));
    throw new Error(`PUT S3 échoué : HTTP ${putRes.status}`);
  }
  console.log(`[shopify-files] PUT S3 OK (${putRes.status})`);

  // ── 3. fileCreate — finaliser dans Shopify Files ─────────────────────────
  const createRes = await fetch(GQL, {
    method:  'POST',
    headers,
    body: JSON.stringify({
      query: `mutation fileCreate($files:[FileCreateInput!]!) {
        fileCreate(files:$files) {
          files {
            ... on MediaImage { id image { url } }
            ... on GenericFile { id url }
          }
          userErrors { field message }
        }
      }`,
      variables: {
        files: [{
          alt:            filename,
          contentType:    'IMAGE',
          originalSource: target.resourceUrl,
        }],
      },
    }),
  });

  const createData = await createRes.json();
  const file       = createData?.data?.fileCreate?.files?.[0];
  const createErrs = createData?.data?.fileCreate?.userErrors;
  if (!file) {
    const err = new Error(createErrs?.map(e => e.message).join(', ') || 'fileCreate: pas de fichier');
    err.graphqlErrors = createErrs;
    console.error('[shopify-files] fileCreate raw:', JSON.stringify(createData?.errors || createErrs));
    throw err;
  }

  const cdnUrl = file?.image?.url || file?.url || null;
  if (!cdnUrl) throw new Error('fileCreate: URL CDN absente');

  console.log(`[shopify-files] ✅ Uploadé → ${cdnUrl}`);
  return cdnUrl; // https://cdn.shopify.com/s/files/...
}

module.exports = { uploadToShopifyFiles };
