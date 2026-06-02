/**
 * Create (idempotently) the private `imports` Storage bucket used by the admin
 * extractor for large file uploads. Large PDFs are uploaded browser→Storage
 * directly (signed URL), bypassing Vercel's 4.5MB function-body limit; the
 * extract function then downloads them server-side via the service role.
 *
 * Run:  node scripts/ensure-imports-bucket.mjs
 */
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

function loadEnvLocal() {
  try {
    const raw = readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    for (const line of raw.split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
      if (!m) continue
      let v = m[2]
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1)
      }
      if (!process.env[m[1]]) process.env[m[1]] = v
    }
  } catch (e) {
    console.error('could not read .env.local:', e.message)
  }
}
loadEnvLocal()

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY
if (!url || !serviceKey) {
  console.error('missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const BUCKET = 'imports'
const FIFTY_MB = 50 * 1024 * 1024

const admin = createClient(url, serviceKey, { auth: { persistSession: false } })

const { data: existing } = await admin.storage.getBucket(BUCKET)
if (existing) {
  console.log(`bucket "${BUCKET}" already exists — updating limits`)
  const { error } = await admin.storage.updateBucket(BUCKET, {
    public: false,
    fileSizeLimit: FIFTY_MB,
  })
  if (error) {
    console.error('updateBucket error:', error.message)
    process.exit(1)
  }
  console.log('updated OK')
} else {
  const { error } = await admin.storage.createBucket(BUCKET, {
    public: false,
    fileSizeLimit: FIFTY_MB,
  })
  if (error) {
    console.error('createBucket error:', error.message)
    process.exit(1)
  }
  console.log(`bucket "${BUCKET}" created (private, 50MB limit)`)
}
