import express from 'express';

import routes from './routes/index.js';
import logger from './utils/logger.js';
import CDatabaseManager from './database/CDatabaseManager.js';
import DevicesRepo from './repos/DevicesRepo.js';
import MqttCredsRepo from './repos/MqttCredsRepo.js';
import DeviceService from './services/DeviceService.js';
import MqttCredService from './services/MqttCredService.js';
import OnboardingService from './services/OnboardingService.js';

function buildSmartPotConfigFromEnv() {
  const connectionString = process.env.DATABASE_URL || null;

  // Hosted DB (Aiven/Render/etc.)
  if (connectionString) {
    return {
      connectionString,
      ssl: {
        rejectUnauthorized: false,
    }
  }
}

  // Local DB defaults (usually no TLS locally)
  return {
    host: process.env.PGHOST || "localhost",
    port: Number(process.env.PGPORT) || 5432,
    database: process.env.PGDATABASE || "mydb",
    user: process.env.PGUSER || "user",
    password: process.env.PGPASSWORD || "password",
    ssl: {
        rejectUnauthorized: false,
    },
  };
}

// Create app
const app = express();
const PORT = process.env.PORT || 3000;

// ===== Dependency Injection (composition root) =====

const db = new CDatabaseManager(buildSmartPotConfigFromEnv());
const devicesRepo = new DevicesRepo(db);
const mqttCredsRepo = new MqttCredsRepo(db);

const deviceService = new DeviceService({ devicesRepo });
const mqttCredService = new MqttCredService({ mqttCredsRepo });
const onboardingService = new OnboardingService({ deviceService, mqttCredService });

app.locals.services = { deviceService, mqttCredService, onboardingService };

// Middleware: simple logger
app.use((req, res, next) => {
    logger(`Received request for ${req.method} ${req.url}`);
    next();
});

// Parse JSON bodies
app.use(express.json());

// Mount routes under /api
app.use('/api', routes);

// Start server
const server = app.listen(PORT, () => {
    logger(`Server is running on http://localhost:${PORT}`);
});

// Graceful shutdown
let shuttingDown = false;

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;

  console.log(`\n${signal} received. Shutting down...`);

  // Stop taking new requests
  server.close(async (err) => {
    if (err) {
      console.error("Error closing HTTP server:", err);
    }

    try {
      await db.shutdown(signal);
    } catch (e) {
      console.error("Error closing DB pool:", e);
    } finally {
      process.exit(err ? 1 : 0);
    }
  });
  
  // Safety net: force exit if something is stuck
  setTimeout(() => {
    console.error("Forcing shutdown (timeout).");
    process.exit(1);
  }, 5000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));