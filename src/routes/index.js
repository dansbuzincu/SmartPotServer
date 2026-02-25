import express from 'express';
import tokenUtils from '../tokenUtils.js';
import CDatabaseManager from '../database/CDatabaseManager.js';
import DevicesRepo from '../repos/DevicesRepo.js';
import DeviceService from '../services/DeviceService.js';
import TokenService from '../services/TokenService.js';
import logMessage from '../utils/logger.js';

const router = express.Router();

// Define a simple route
router.get('/', (req, res) => {
    const testToken = tokenUtils.generateToken();
    const hashToken = tokenUtils.hashToken(testToken);
    res.json({ testToken, hashToken });
});


router.get('/claim', async (req, res) => {
    // Verify if token is provided in request body
    const token = (req.query && typeof req.query.token === 'string')
        ? req.query.token.trim()
        : (req.body && typeof req.body.token === 'string' ? req.body.token.trim() : null);
    if (!token) {
        return res.status(400).json({ success: false, message: 'Token is not provided or provided as wrong type' });
    }

    // If token is provided, validate it
    try {
        const validation = await tableDataManagerInstance.queryForToken(token);

        // If token not found -> log error
        if (!validation.ok) {
            return res.status(500).json({ success: false, error: validation.error });
        }
        // Update claim status of input token
        const claimResult = await tableDataManagerInstance.claimToken(token);
        if (!claimResult.ok) {
            return res.status(500).json({ success: false, error: claimResult.error });
        }
        return res.status(200).json({ success: true, claimed_device: claimResult.device });
    }
    catch (err) {
        return res.status(500).json({ success: false, message: 'Server error', error: err.message || String(err) });
    }
});

// Define test route for inserting a token
// Helpful GET for quick browser check
router.get('/test-insert', (req, res) => {
    return res.status(200).json({
        success: true,
        method: 'POST',
        message: 'Use POST /test-insert with JSON {"token":"..."} to insert a test token'
    });
});

router.post('/test-insert', async (req, res) => {
    const token = req.body && typeof req.body.token === 'string' ? req.body.token.trim() : null;
    if (!token) {
        return res.status(400).json({ success: false, message: 'Token is not provided or provided as wrong type' });
    }

    try {
        const rowToInsert = await tableDataManagerInstance.newDeviceRow(token);
        const insertResult = await tableDataManagerInstance.insertRow(rowToInsert);
        if (!insertResult || !insertResult.ok) {
            return res.status(500).json({
                success: false,
                error: insertResult && insertResult.error ? insertResult.error : 'insert failed'
            });
        }

        logMessage('Row insertion result:', insertResult);
        return res.status(200).json({ success: true, result: insertResult });
    } catch (err) {
        return res.status(500).json({ success: false, message: 'Server error', error: err.message || String(err) });
    }
});

// ====== QRHub APIs ==============

router.post('/devices/insert', async (req, res) => {
    const { unique_id, name, token_hash } = req.body;

    if (!unique_id || !token_hash) {
        return res.status(400).json({
            success: false,
            error: 'unique_id and token_hash are required'
        });
    }

    const row = {
        unique_id,
        token_hash,
        claimed: false,
        name: name || null
    };

    try {
        const deviceService = req.app.locals.services.deviceService;
        const insertResult = await deviceService.createDeviceRow(row);

        if (!insertResult.ok) {
            return res.status(500).json({
                success: false,
                error: insertResult.error || 'insert failed'
            });
        }

        return res.status(201).json({
            success: true,
            message: 'Device inserted successfully',
            device: insertResult.device
        });
    } catch (err) {
        logMessage('Error inserting device:', err);
        return res.status(500).json({
            success: false,
            error: err.message || 'Internal server error'
        });
    }
});

router.get('/token/generate', async (req, res) => {
    try {
    const {tokenService} = req.app.locals.services;
    const { token, tokenHash, claimUrl } = tokenService.generateClaimToken();

    // return what the frontend expects
    return res.status(201).json({ success: true, token, token_hash: tokenHash, claimUrl });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message || String(err) });
  }
});

export default router;
