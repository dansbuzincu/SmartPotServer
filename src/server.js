import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

import routes from './routes/index.js';
import logger from './utils/logger.js';

// Create app
const app = express();
const PORT = process.env.PORT || 3000;

// Required to emulate __dirname in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Middleware: simple logger
app.use((req, res, next) => {
    logger(`Received request for ${req.method} ${req.url}`);
    next();
});

// Parse JSON bodies
app.use(express.json());

// Serve static files (CSS, JS, HTML)
app.use(express.static(path.join(__dirname, 'public')));

// Mount routes under /api
app.use('/api', routes);

// Serve QRHub page (GET /QRHub)
app.get('/QRHub', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'QRHub.html'));
});

// Start server
app.listen(PORT, () => {
    logger(`Server is running on http://localhost:${PORT}`);
});
