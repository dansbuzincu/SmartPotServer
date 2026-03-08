import express from 'express';
import logMessage from '../utils/logger.js';

const router = express.Router();

// Health route
router.get('/', (req, res) => {
    res.json({ success: true, message: 'SmartPot API is running' });
});

router.post('/onboarding/challenge', async (req, res) => {
    const unique_id = req.body && typeof req.body.unique_id === 'string'
        ? req.body.unique_id.trim()
        : '';

    logMessage(`[Challenge] Received unique_id: "${unique_id}" (raw body: ${JSON.stringify(req.body)})`);

    try {
        const { onboardingService } = req.app.locals.services;
        const challengeResult = await onboardingService.createChallenge(unique_id);

        if (!challengeResult.ok) {
            logMessage(`[Challenge] Error for unique_id="${unique_id}": ${challengeResult.error}`);
            let statusCode = 500;
            if (challengeResult.error === 'unique_id is required') statusCode = 400;
            else if (challengeResult.error === 'device_not_found') statusCode = 404;
            else if (challengeResult.error === 'device already claimed') statusCode = 409;

            return res.status(statusCode).json({
                success: false,
                error: challengeResult.error
            });
        }

        logMessage(`[Challenge] Successfully created challenge for unique_id="${unique_id}"`);
        return res.status(200).json({
            success: true,
            unique_id,
            challenge: challengeResult.challenge,
            expires_in_ms: challengeResult.expires_in_ms
        });
    } catch (err) {
        return res.status(500).json({
            success: false,
            error: err.message || 'internal server error'
        });
    }
});

router.post('/onboarding/provision', async (req, res) => {
    const unique_id = req.body && typeof req.body.unique_id === 'string'
        ? req.body.unique_id.trim()
        : '';
    const challenge = req.body && typeof req.body.challenge === 'string'
        ? req.body.challenge.trim()
        : '';
    const proof = req.body && typeof req.body.proof === 'string'
        ? req.body.proof.trim()
        : '';

    try {
        const { onboardingService } = req.app.locals.services;
        const provisionResult = await onboardingService.provisionWithProof({
            uniqueId: unique_id,
            challenge,
            proof
        });

        if (!provisionResult.ok) {
            let statusCode = 500;
            if (
                provisionResult.error === 'unique_id is required' ||
                provisionResult.error === 'challenge is required' ||
                provisionResult.error === 'proof is required'
            ) {
                statusCode = 400;
            } else if (provisionResult.error === 'device_not_found') {
                statusCode = 404;
            } else if (
                provisionResult.error === 'device already claimed' ||
                provisionResult.error === 'mqtt_credentials_for_device_exists' ||
                provisionResult.error === 'mqtt_username_exists'
            ) {
                statusCode = 409;
            } else if (
                provisionResult.error === 'invalid or expired challenge' ||
                provisionResult.error === 'invalid proof'
            ) {
                statusCode = 401;
            }

            return res.status(statusCode).json({
                success: false,
                error: provisionResult.error,
                details: provisionResult.details
            });
        }

        return res.status(200).json({
            success: true,
            message: 'Device provisioned successfully',
            device: provisionResult.device,
            mqtt_credentials: provisionResult.mqtt_credentials
        });
    } catch (err) {
        return res.status(500).json({
            success: false,
            error: err.message || 'internal server error'
        });
    }
});

// Route used by user to claim a device
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
        const { deviceService, mqttCredService } = req.app.locals.services;
        const validation = await mqttCredService.validateToken(token);

        if (!validation.ok) {
            const statusCode = validation.error === 'no device found with that credential' ? 404 : 500;
            return res.status(statusCode).json({ success: false, error: validation.error });
        }

        if (validation.device.is_claimed) {
            return res.status(409).json({ success: false, error: 'device is already claimed' });
        }

        const claimResult = await deviceService.claimDeviceById(validation.device.id);
        if (!claimResult.ok) {
            const statusCode = claimResult.error === 'device_already_claimed_or_missing' ? 409 : 500;
            return res.status(statusCode).json({ success: false, error: claimResult.error });
        }

        const claimedDevice = {
            ...claimResult.device,
            mqtt_username: validation.device.mqtt_username,
            mqtt_credential_id: validation.device.mqtt_credential_id
        };

        return res.status(200).json({ success: true, claimed_device: claimedDevice });
    }
    catch (err) {
        return res.status(500).json({ success: false, message: 'Server error', error: err.message || String(err) });
    }
});

async function createDeviceHandler(req, res) {
    const { unique_id } = req.body || {};

    const normalizedUniqueId = typeof unique_id === 'string' ? unique_id.trim() : '';

    if (!normalizedUniqueId) {
        return res.status(400).json({
            success: false,
            error: 'unique_id is required'
        });
    }

    try {
        const { deviceService } = req.app.locals.services;

        const deviceResult = await deviceService.createDeviceRow({
            unique_id: normalizedUniqueId,
            // Factory registration should not define user-facing nickname.
            device_label: null,
            is_claimed: false
        });

        if (deviceResult.ok) {
            return res.status(201).json({
                success: true,
                created: true,
                message: 'Device inserted successfully',
                device: deviceResult.device
            });
        }

        // Factory tools often retry. Treat duplicate unique_id as idempotent success.
        if (deviceResult.error === 'unique_id_exists') {
            const existingDeviceResult = await deviceService.getDeviceByUniqueId(normalizedUniqueId);
            if (existingDeviceResult.ok) {
                return res.status(200).json({
                    success: true,
                    created: false,
                    message: 'Device already exists',
                    device: existingDeviceResult.device
                });
            }

            return res.status(409).json({
                success: false,
                error: 'unique_id_exists',
                message: deviceResult.message || 'device with that unique_id already exists'
            });
        }

        return res.status(500).json({
            success: false,
            error: deviceResult.error || 'device insert failed',
            message: deviceResult.message
        });
    } catch (err) {
        logMessage(`Error inserting device: ${err.message || String(err)}`);
        return res.status(500).json({
            success: false,
            error: err.message || 'Internal server error'
        });
    }
}

// router.post('/devices', createDeviceHandler);

// Backward-compatible alias used by older factory tooling.
router.post('/devices/insert', createDeviceHandler);

export default router;
