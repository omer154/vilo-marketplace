// Check BEFORE dotenv loads
const sytemVal = process.env.ANTHROPIC_API_KEY;
console.log('System ANTHROPIC_API_KEY:', JSON.stringify(sytemVal));
console.log('System value length:', sytemVal ? sytemVal.length : 0);

// Now load dotenv
require('dotenv').config({ path: '.env.local' });
const afterVal = process.env.ANTHROPIC_API_KEY;
console.log('After dotenv ANTHROPIC_API_KEY:', JSON.stringify(afterVal));

// Force override
require('dotenv').config({ path: '.env.local', override: true });
const overrideVal = process.env.ANTHROPIC_API_KEY;
console.log('After override ANTHROPIC_API_KEY:', overrideVal ? overrideVal.substring(0, 15) + '...' : 'EMPTY');
