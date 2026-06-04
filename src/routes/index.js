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

    logMessage(`[Provision] Received unique_id: "${unique_id}" (raw body: ${JSON.stringify(req.body)})`);

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
                    provisionResult.error === 'mqtt_provisioning_for_device_exists' ||
                    provisionResult.error === 'mqtt_client_id_exists'
            ) {
                statusCode = 409;
            } else if (
                provisionResult.error === 'invalid or expired challenge' ||
                provisionResult.error === 'invalid proof'
            ) {
                statusCode = 401;
            }

            logMessage(`[Provision] Error for unique_id="${unique_id}": ${provisionResult.error}`);

            return res.status(statusCode).json({
                success: false,
                error: provisionResult.error,
                details: provisionResult.details
            });
        }

        logMessage(`[Provision] Successfully provisioned unique_id="${unique_id}"`);

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
                mqtt_provisioning_id: validation.device.mqtt_provisioning_id,
                auth_mode: validation.device.auth_mode,
                mqtt_client_id: validation.device.mqtt_client_id
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

async function resolveDeviceIdByUniqueId(req, uniqueId) {
    const normalizedUniqueId = typeof uniqueId === 'string' ? uniqueId.trim() : '';
    if (!normalizedUniqueId) {
        return { ok: false, error: 'unique_id is required' };
    }

    const { deviceService } = req.app.locals.services;
    const deviceResult = await deviceService.getDeviceByIdentifier(normalizedUniqueId);
    if (!deviceResult.ok || !deviceResult.device) {
        return { ok: false, error: 'device_not_found' };
    }

    return { ok: true, deviceId: deviceResult.device.id, device: deviceResult.device };
}

function parseTelemetryHistoryQuery(req) {
    const now = Date.now();
    const defaultFrom = new Date(now - 24 * 60 * 60 * 1000);
    const defaultTo = new Date(now);

    const from = req.query && typeof req.query.from === 'string' ? new Date(req.query.from) : defaultFrom;
    const to = req.query && typeof req.query.to === 'string' ? new Date(req.query.to) : defaultTo;

    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) {
        return { ok: false, error: 'invalid_date_range' };
    }

    const rawLimit = req.query && typeof req.query.limit === 'string' ? Number.parseInt(req.query.limit, 10) : 200;
    const limit = Number.isInteger(rawLimit) ? Math.min(Math.max(rawLimit, 1), 1000) : 200;

    return { ok: true, from, to, limit };
}

router.get('/devices/by-unique-id/:uniqueId/telemetry/latest', async (req, res) => {
    try {
        const resolved = await resolveDeviceIdByUniqueId(req, req.params && req.params.uniqueId);
        if (!resolved.ok) {
            const status = resolved.error === 'unique_id is required' ? 400 : 404;
            return res.status(status).json({ success: false, error: resolved.error });
        }

        const { telemetryService } = req.app.locals.services;
        const latestResult = await telemetryService.getLatestTelemetryByDeviceId(resolved.deviceId);

        if (!latestResult.ok) {
            if (latestResult.error === 'telemetry_not_found') {
                return res.status(404).json({ success: false, error: 'device_not_found' });
            }
            return res.status(500).json({ success: false, error: latestResult.error || 'internal_server_error' });
        }

        return res.status(200).json({
            success: true,
            device: {
                id: resolved.device.id,
                unique_id: resolved.device.unique_id,
                device_label: resolved.device.device_label
            },
            telemetry: latestResult.telemetry
        });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message || 'internal server error' });
    }
});

router.get('/devices/by-unique-id/:uniqueId/telemetry/history', async (req, res) => {
    const query = parseTelemetryHistoryQuery(req);
    if (!query.ok) {
        return res.status(400).json({ success: false, error: query.error });
    }

    try {
        const resolved = await resolveDeviceIdByUniqueId(req, req.params && req.params.uniqueId);
        if (!resolved.ok) {
            const status = resolved.error === 'unique_id is required' ? 400 : 404;
            return res.status(status).json({ success: false, error: resolved.error });
        }

        const { telemetryService } = req.app.locals.services;
        const historyResult = await telemetryService.getTelemetryHistoryByDeviceId(resolved.deviceId, {
            from: query.from,
            to: query.to,
            limit: query.limit
        });

        if (!historyResult.ok) {
            return res.status(500).json({ success: false, error: historyResult.error || 'internal_server_error' });
        }

        return res.status(200).json({
            success: true,
            device: {
                id: resolved.device.id,
                unique_id: resolved.device.unique_id,
                device_label: resolved.device.device_label
            },
            history: historyResult.history
        });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message || 'internal server error' });
    }
});

router.get('/devices/:deviceId/telemetry/latest', async (req, res) => {
    const rawDeviceId = req.params && req.params.deviceId;
    const deviceId = Number.parseInt(rawDeviceId, 10);

    if (!Number.isInteger(deviceId) || deviceId <= 0) {
        return res.status(400).json({ success: false, error: 'invalid_device_id' });
    }

    try {
        const { telemetryService } = req.app.locals.services;
        const latestResult = await telemetryService.getLatestTelemetryByDeviceId(deviceId);

        if (!latestResult.ok) {
            if (latestResult.error === 'telemetry_not_found') {
                return res.status(404).json({ success: false, error: 'device_not_found' });
            }
            return res.status(500).json({ success: false, error: latestResult.error || 'internal_server_error' });
        }

        return res.status(200).json({
            success: true,
            telemetry: latestResult.telemetry
        });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message || 'internal server error' });
    }
});

router.get('/devices/:deviceId/telemetry/history', async (req, res) => {
    const rawDeviceId = req.params && req.params.deviceId;
    const deviceId = Number.parseInt(rawDeviceId, 10);

    if (!Number.isInteger(deviceId) || deviceId <= 0) {
        return res.status(400).json({ success: false, error: 'invalid_device_id' });
    }

    const query = parseTelemetryHistoryQuery(req);
    if (!query.ok) {
        return res.status(400).json({ success: false, error: query.error });
    }

    try {
        const { telemetryService } = req.app.locals.services;
        const historyResult = await telemetryService.getTelemetryHistoryByDeviceId(deviceId, {
            from: query.from,
            to: query.to,
            limit: query.limit
        });

        if (!historyResult.ok) {
            return res.status(500).json({ success: false, error: historyResult.error || 'internal_server_error' });
        }

        return res.status(200).json({
            success: true,
            history: historyResult.history
        });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message || 'internal server error' });
    }
});

export default router;
