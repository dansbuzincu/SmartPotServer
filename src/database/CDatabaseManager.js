import { Pool } from 'pg';
import dotenv from 'dotenv';
import fs from 'fs';

// TODO : THESE NEED TO BE MOVED
// Load .env only for local development (safe to call in production too)
if (process.env.NODE_ENV !== 'production') {
  dotenv.config();
}

class CDatabaseManager {

  constructor(config) {
    this.log('Initializing database pool');

    // Preferred: load CA from file path if provided, otherwise from env variable.
    let caPem = null;
    if (process.env.DB_SSL_CA_FILE) {
      try {
        caPem = fs.readFileSync(process.env.DB_SSL_CA_FILE, 'utf8');
        this.log(`Database SSL: loaded CA from file ${process.env.DB_SSL_CA_FILE}`);
      } catch (e) {
        this.logError('Database SSL: failed to read DB_SSL_CA_FILE', e.message || String(e));
      }
    } else if (process.env.DB_SSL_CA) {
      // Support both literal newlines and escaped \n sequences in .env values
      caPem = process.env.DB_SSL_CA.includes('\\n')
        ? process.env.DB_SSL_CA.replace(/\\n/g, '\n')
        : process.env.DB_SSL_CA;
      this.log('Database SSL: using DB_SSL_CA from environment');
    }

    if (caPem) {
      config.ssl = { ca: caPem, rejectUnauthorized: true };
    }

    // Fallback: allow explicitly opting-in to accept self-signed certs.
    // Set DB_ALLOW_SELF_SIGNED=true to enable (use only for development/testing).
    else if (process.env.DB_ALLOW_SELF_SIGNED === 'true') {
      config.ssl = { rejectUnauthorized: false };
      this.log('Database SSL: DB_ALLOW_SELF_SIGNED=true, rejectUnauthorized=false');
    }

    // Backwards-compat: if connectionString is used and no SSL flags provided, apply safe default of rejecting unauthorized certs.
    else if (config && config.connectionString && (config.ssl === undefined || config.ssl === null)) {
      // default to true; if this triggers SELF_SIGNED_CERT_IN_CHAIN, set DB_ALLOW_SELF_SIGNED or provide DB_SSL_CA
      config.ssl = { rejectUnauthorized: true };
      this.log('Database SSL: connectionString present, defaulting to rejectUnauthorized=true');
    }

    this.pool = new Pool(config);
    this.pool.on('error', (err) => {
      this.logError('Unexpected error on idle client', err);
    });
  }

  log(...args) {
    console.log(new Date().toISOString(), ...args);
  }

  logError(...args) {
    console.error(new Date().toISOString(), ...args);
  }

  async query(text, params = []) {
    if (!this.pool){
      this.logError('Database pool not initialized');
      return { ok: false, error: 'Database not initialized' };
    }
    try {
      const response = await this.pool.query(text, params);
      return { ok: true, rows: response.rows, rowCount: response.rowCount };
    } catch (err) {
      this.logError('Database query error', err);
      this.connected = false;
      return { ok: false, error: err.message || String(err) };
    }
  }

  isClosing = false;

  async shutdown(signal = "SIGINT") {
    if (this.isClosing) return;
    this.isClosing = true;

    this.log(`${signal}: Shutting down database pool`);
    try {
      if (this.pool) {
        await this.pool.end();
        this.pool = null;
      }
    } catch (err) {
      this.logError("Error while closing pool", err);
    }
  }
}

// Graceful shutdown
process.on("SIGINT", () => CDatabaseManager.shutdown("SIGINT"));
process.on("SIGTERM", () => CDatabaseManager.shutdown("SIGTERM"));

export default CDatabaseManager;
