'use strict';
/**
 * cloudStorage.js
 * Abstraction layer — Cloudinary ou S3, avec fallback local.
 * 
 * Config .env :
 *   Cloudinary : CLOUDINARY_URL=cloudinary://api_key:api_secret@cloud_name
 *   AWS S3     : AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_BUCKET, AWS_REGION
 */

const https = require('https');
const http  = require('http');
const fs    = require('fs');
const path  = require('path');
const crypto = require('crypto');

const CLOUDINARY_URL = process.env.CLOUDINARY_URL || '';
const AWS_BUCKET     = process.env.AWS_BUCKET     || '';
const AWS_REGION     = process.env.AWS_REGION     || 'eu-west-3';
const AWS_KEY        = process.env.AWS_ACCESS_KEY_ID     || '';
const AWS_SECRET     = process.env.AWS_SECRET_ACCESS_KEY || '';

function isCloudConfigured() {
  return !!(CLOUDINARY_URL || (AWS_BUCKET && AWS_KEY && AWS_SECRET));
}

/**
 * Upload a local file to cloud storage.
 * Returns the public URL.
 */
async function uploadToCloud(localPath, remoteName) {
  if (CLOUDINARY_URL) {
    return uploadToCloudinary(localPath, remoteName);
  }
  if (AWS_BUCKET && AWS_KEY && AWS_SECRET) {
    return uploadToS3(localPath, remoteName);
  }
  throw new Error('No cloud storage configured');
}

// ── Cloudinary upload ─────────────────────────────────────────────────
function uploadToCloudinary(localPath, remoteName) {
  return new Promise((resolve, reject) => {
    // Parse Cloudinary URL
    const match = CLOUDINARY_URL.match(/cloudinary:\/\/(\d+):([^@]+)@(.+)/);
    if (!match) return reject(new Error('Invalid CLOUDINARY_URL format'));
    const [, apiKey, apiSecret, cloudName] = match;

    const fileData    = fs.readFileSync(localPath);
    const b64         = fileData.toString('base64');
    const timestamp   = Math.floor(Date.now() / 1000);
    const publicId    = remoteName.replace(/\.[^/.]+$/, '').replace(/\//g, '_');
    const strToSign   = `public_id=${publicId}&timestamp=${timestamp}${apiSecret}`;
    const signature   = crypto.createHash('sha1').update(strToSign).digest('hex');

    const body = new URLSearchParams({
      file:       `data:image/png;base64,${b64}`,
      api_key:    apiKey,
      timestamp:  String(timestamp),
      public_id:  publicId,
      signature,
    }).toString();

    const req = https.request({
      hostname: 'api.cloudinary.com',
      path:     `/v1_1/${cloudName}/image/upload`,
      method:   'POST',
      headers: {
        'Content-Type':   'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.error) reject(new Error('Cloudinary: ' + json.error.message));
          else resolve(json.secure_url);
        } catch (e) {
          reject(new Error('Cloudinary parse error'));
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ── AWS S3 upload (presigned PUT) ────────────────────────────────────
async function uploadToS3(localPath, remoteName) {
  const fileData    = fs.readFileSync(localPath);
  const date        = new Date();
  const dateStr     = date.toISOString().slice(0, 10).replace(/-/g, '');
  const datetimeStr = date.toISOString().replace(/[:-]/g, '').split('.')[0] + 'Z';
  const contentType = 'image/png';
  const key         = remoteName;
  const host        = `${AWS_BUCKET}.s3.${AWS_REGION}.amazonaws.com`;

  // AWS Signature V4
  const canonicalHeaders = `content-type:${contentType}\nhost:${host}\nx-amz-date:${datetimeStr}\n`;
  const signedHeaders    = 'content-type;host;x-amz-date';
  const payloadHash      = crypto.createHash('sha256').update(fileData).digest('hex');
  const canonicalRequest = `PUT\n/${key}\n\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;

  const credScope  = `${dateStr}/${AWS_REGION}/s3/aws4_request`;
  const strToSign  = `AWS4-HMAC-SHA256\n${datetimeStr}\n${credScope}\n${crypto.createHash('sha256').update(canonicalRequest).digest('hex')}`;

  const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest();
  const sigKey = hmac(hmac(hmac(hmac(`AWS4${AWS_SECRET}`, dateStr), AWS_REGION), 's3'), 'aws4_request');
  const signature = hmac(sigKey, strToSign).toString('hex');

  const authHeader = `AWS4-HMAC-SHA256 Credential=${AWS_KEY}/${credScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: host,
      path:    `/${key}`,
      method:  'PUT',
      headers: {
        'Content-Type': contentType,
        'Content-Length': fileData.length,
        'x-amz-date':   datetimeStr,
        'Authorization': authHeader,
      },
    }, (res) => {
      if (res.statusCode === 200 || res.statusCode === 204) {
        resolve(`https://${host}/${key}`);
      } else {
        let data = '';
        res.on('data', d => data += d);
        res.on('end', () => reject(new Error(`S3 error ${res.statusCode}: ${data.slice(0, 200)}`)));
      }
    });
    req.on('error', reject);
    req.write(fileData);
    req.end();
  });
}

module.exports = { uploadToCloud, isCloudConfigured, uploadToCloudinary, uploadToS3 };
