require('dotenv').config({ path: '.env.local' });
const key = process.env.ANTHROPIC_API_KEY;
console.log('Key exists:', key ? 'YES' : 'NO');
console.log('Key length:', key ? key.length : 0);
console.log('Key prefix:', key ? key.substring(0, 15) : 'N/A');
console.log('All relevant keys:', Object.keys(process.env).filter(k => k.includes('ANTHROPIC') || k.includes('SUPABASE')));
