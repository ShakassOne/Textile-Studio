'use strict';

const fs   = require('fs');
const path = require('path');

/**
 * uploadToShopifyFiles(localFilePath, shop, accessToken)
 *
 * 1. stagedUploadsCreate  → obtenir une URL signée AWS S3
 * 2. PUT du buffer PNG     → uploader le fichier vers S3
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
  if (!target) throw new Error(stageErrs?.map(e => e.message).join(', ') || 'stagedUploadsCreate: pas de target');

  // ── 2. PUT vers l'URL signée (AWS S3 presigned) ──────────────────────────
  const params  = target.parameters || [];
  let   putUrl  = target.url;
  if (params.length) {
    const qs = params.map(p => `${encodeURIComponent(p.name)}=${encodeURIComponent(p.value)}`).join('&');
    putUrl  += (putUrl.includes('?') ? '&' : '?') + qs;
  }

  const putRes = await fetch(putUrl, {
    method:  'PUT',
    headers: { 'Content-Type': 'image/png', 'Content-Length': String(fileSize) },
    body:    fileBuffer,
  });
  if (!putRes.ok) throw new Error(`PUT S3 échoué : HTTP ${putRes.status}`);

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
  if (!file) throw new Error(createErrs?.map(e => e.message).join(', ') || 'fileCreate: pas de fichier');

  const cdnUrl = file?.image?.url || file?.url || null;
  if (!cdnUrl) throw new Error('fileCreate: URL CDN absente');

  console.log(`[shopify-files] ✅ Uploadé → ${cdnUrl}`);
  return cdnUrl; // https://cdn.shopify.com/s/files/...
}

module.exports = { uploadToShopifyFiles };
