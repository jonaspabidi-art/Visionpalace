// Startar den riktiga appen mot en oanvänd databas — bara för UI-tester
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://127.0.0.1:1';
process.env.SUPABASE_SERVICE_KEY = 'dummy';
process.env.JWT_SECRET = 'test-secret-for-invoice-repro';
process.env.ADMIN_USERNAME = 'testadmin';
process.env.PORT = process.env.PORT || '5959';
const webpush = require(process.cwd() + '/node_modules/web-push');
const keys = webpush.generateVAPIDKeys();
process.env.VAPID_PUBLIC_KEY = keys.publicKey;
process.env.VAPID_PRIVATE_KEY = keys.privateKey;
require(process.cwd() + '/server/index.js');
