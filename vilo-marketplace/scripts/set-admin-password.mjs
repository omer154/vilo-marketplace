// Set (or reset) an admin user's password via the Supabase service-role admin API.
// Run: node --env-file=.env.local scripts/set-admin-password.mjs <email> <password>
import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
const EMAIL = process.argv[2]
const PASSWORD = process.argv[3]
if (!url || !key) {
  console.error('Missing Supabase env')
  process.exit(1)
}
if (!EMAIL || !PASSWORD) {
  console.error('Usage: node --env-file=.env.local scripts/set-admin-password.mjs <email> <password>')
  process.exit(1)
}

const sb = createClient(url, key, { auth: { persistSession: false } })

let user = null
for (let page = 1; page <= 20 && !user; page++) {
  const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 200 })
  if (error) {
    console.error('listUsers failed:', error.message)
    process.exit(1)
  }
  user = data.users.find((u) => (u.email || '').toLowerCase() === EMAIL.toLowerCase())
  if (data.users.length < 200) break
}
if (!user) {
  console.error('No auth user found with email', EMAIL)
  process.exit(1)
}

const { error } = await sb.auth.admin.updateUserById(user.id, {
  password: PASSWORD,
  email_confirm: true,
})
if (error) {
  console.error('Update failed:', error.message)
  process.exit(1)
}
console.log(`✅ Password set for ${EMAIL} (user ${user.id})`)
