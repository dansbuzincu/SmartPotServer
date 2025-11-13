const { Pool } = require('pg');

// Graceful shutdown
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

if (process.env.NODE_ENV !== 'production') {
  // load .env only for local development
    require('dotenv').config();
}
const connectionString = process.env.DATABASE_URL || null;

const sslOption = process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false;
let smartPotConfig ;

if (connectionString) {
    // If a single DATABASE_URL is provided (common on hosting platforms)
    smartPotConfig = {
        connectionString: connectionString,
        ssl: sslOption,
    };
} else {
    // Otherwise use individual PG_* env vars (useful for local dev)
    smartPotConfig = {
        host: process.env.PGHOST || 'localhost',
        port: parseInt(process.env.PGPORT, 10) || 5432,
        database: process.env.PGDATABASE || 'mydb',
        user: process.env.PGUSER || 'user',
        password: process.env.PGPASSWORD || 'password',
        ssl: sslOption,
    };
}

class CDatabaseManager {
    static pool = null;

    static init () {
        if ( !this.pool ){
            this.log('Initializing database pool');
            this.pool = new Pool(smartPotConfig);
            this.pool.on('error', (err) => {
                this.logError('Unexpected error on idle client', err);
            });
        }
    }

    static log(...args) { console.log(new Date().toISOString(), ...args); }

    static logError(...args) { console.error(new Date().toISOString(), ...args); }

    static async query(text, params = []) {
        if (!this.pool) this.init();
        try {
            const response = await this.pool.query(text, params);
            return { ok: true, rows: response.rows, rowCount: response.rowCount };
        } catch (err) {
            this.logError('Database query error', err);
            this.connected = false;
            return { ok: false, error: err.message || String(err) };
        }
    }
}

async function shutdown() {
    await CDatabaseManager.disconnect(); // calls pool.end()
    process.exit(0);
}

module.exports = CDatabaseManager;
