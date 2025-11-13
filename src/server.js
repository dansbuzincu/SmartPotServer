const http = require('http');
const routes = require('./routes/index');
const logger = require('./utils/logger');

const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
    logger(`Received request for ${req.url}`);
    routes(req, res);
});

server.listen(PORT, () => {
    logger(`Server is running on http://localhost:${PORT}`);
});