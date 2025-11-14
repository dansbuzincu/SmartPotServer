const express = require('express');
const routes = require('./routes/index');
const logger = require('./utils/logger');

const PORT = process.env.PORT || 3000;

const app = express();

// simple request logger middleware
app.use((req, res, next) => {
    logger(`Received request for ${req.url}`);
    next();
});

// mount routes
app.use('/', routes);

app.listen(PORT, () => {
    logger(`Server is running on http://localhost:${PORT}`);
});