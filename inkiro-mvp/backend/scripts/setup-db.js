const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
require('dotenv').config();

async function run() {
  const url = process.env.DATABASE_URL;
  if (!url || url.includes('<db-password>')) {
    console.error('❌ Please update the DATABASE_URL in your .env file with your actual password first!');
    process.exit(1);
  }

  const client = new Client({ connectionString: url });
  
  try {
    console.log('Connecting to database...');
    await client.connect();

    console.log('Running schema.sql...');
    const schemaSql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
    await client.query(schemaSql);
    console.log('✅ schema.sql applied');

    console.log('Running rls.sql...');
    const rlsSql = fs.readFileSync(path.join(__dirname, 'rls.sql'), 'utf8');
    await client.query(rlsSql);
    console.log('✅ rls.sql applied');

    console.log('Database base schema is ready! Now you can run node scripts/migrate.js');
  } catch (err) {
    console.error('❌ Error:', err.message);
  } finally {
    await client.end();
  }
}

run();
