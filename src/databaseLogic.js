const { Pool } = require('pg');

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
    // set to true when connected - false when close is called or error on query
    static connected = false;

    static init () {
        if ( !this.pool ){
            this.log('Initializing database pool');
            this.pool = new Pool(smartPotConfig);
            this.pool.on('error', (err) => {
                this.logError('Unexpected error on idle client', err);
                this.connected = false;
            });
        }
    }

    static log(...args) { console.log(new Date().toISOString(), ...args); }

    static logError(...args) { console.error(new Date().toISOString(), ...args); }

    static isConnected() {
        return this.connected;
    }

    static async connect() {
        if ( !this.pool ){
            this.init();
        }
        try {
            const client = await this.pool.connect();
            client.release();
            this.connected = true;
            this.log('Database connected');
        } catch (err) {
            this.logError('Database connection error', err);
            this.connected = false;
        }
    }

    static async query(text, params = []) {
        if( this.connected ){
            try {
                const response = await this.pool.query(text, params);
                return {ok: false, rows: response.rows, rowCount: response.rowCount};
            }
            catch (err) {
                this.logError('Database query error', err);
                // TODO : see if this is correct
                this.connected = false;
                return {ok: false, error: err.message};
            }
        }
    }

    static async disconnect() {
        if ( this.pool ) {
            try {
                await this.pool.end();
                this.log('Database pool has ended');
                this.connected = false;
                return {ok: true}
            }
            catch (err) {
                this.logError('Error during database pool end', err);
                return {ok: false, error: err.message};
            }
        }
    }
}


module.exports = CDatabaseManager;
