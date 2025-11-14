const express = require('express');
const tokenUtils = require('../tokenUtils');
const router = express.Router();

// Define a simple route
router.get('/', (req, res) => {

    const testToken = tokenUtils.generateToken();
    res.send('Generated test token of : ' + testToken);
});

// Export the router
module.exports = router;