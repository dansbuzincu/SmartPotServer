const express = require('express');
const tokenUtils = require('../tokenUtils');
const router = express.Router();

// Define a simple route
router.get('/', (req, res) => {

    const testToken = tokenUtils.generateToken();
    const hashToken = tokenUtils.hashToken(testToken);
    res.json({
        testToken,
        hashToken
    });
});

// Export the router
module.exports = router;
