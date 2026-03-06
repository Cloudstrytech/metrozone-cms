/**
 * set-cors.js  —  run once to apply CORS to your Firebase Storage bucket.
 * Usage: node set-cors.js
 *
 * Requires: npm install @google-cloud/storage   (run first)
 *
 * OR if you prefer the Google Cloud Console UI:
 *   1. Go to https://console.cloud.google.com/storage/browser/metrozone-csr.appspot.com
 *   2. Click the bucket name → EDIT CORS CONFIGURATION
 *   3. Paste the cors.json contents
 */
const { Storage } = require("@google-cloud/storage");

const storage = new Storage(); // Uses GOOGLE_APPLICATION_CREDENTIALS env var
const bucket = storage.bucket("metrozone-csr.appspot.com");

const cors = [
  {
    origin: ["*"],
    method: ["GET", "HEAD"],
    responseHeader: ["Content-Type", "Content-Length"],
    maxAgeSeconds: 3600,
  },
];

(async () => {
  await bucket.setCorsConfiguration(cors);
  console.log("✅ CORS applied to metrozone-csr.appspot.com");
})();
