const express = require('express');
const tokenUtils = require('../tokenUtils');
const router = express.Router();
const tableDataManager = require('../tableDataManager');
const databaseLogic = require('../databaseLogic');

// Define a simple route
router.get('/', (req, res) => {

    const testToken = tokenUtils.generateToken();
    const hashToken = tokenUtils.hashToken(testToken);
    res = 
    res.json({
        testToken,
        hashToken
    });
});

const dbInstance = databaseLogic.CDatabaseManager.init();
const tableDataManagerInstance = tableDataManager(dbInstance);

// Define route for claiming a token
router.post('/claim', (req, res) => {
    // Verifiy if token is provided in request body
    const token = req.body && typeof req.body.token === 'string' ? req.body.token.trim() : null;
    if (!token) {
        return res.status(400).json({ success: false, message: 'Token is not provided or provided as wrong type' });
    }

    // Search in database for given token
    // Unpack the token from request
    try {

        tableDataManagerInstance.queryForToken(token);
        // Get interrogate database for provided token
        logMessage(`Token ${token} verified successfully.`);
        return res.status(200).json({ success: true, claimUrl });
    }
    catch (err) {
        return res.status(500).json({ success: false, message: 'Server error', error: err.message || String(err) });
    }
});

// Export the router
module.exports = router;
