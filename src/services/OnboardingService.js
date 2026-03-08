import crypto from 'crypto';
import tokenUtils from '../tokenUtils.js';

class OnboardingService {
    constructor({ deviceService, mqttCredService, challengeTtlMs = 5 * 60 * 1000 }) {
        this.deviceService = deviceService;
        this.mqttCredService = mqttCredService;
        this.challengeTtlMs = challengeTtlMs;
        this.pendingChallenges = new Map();
    }

    parseDeviceSecretsFromEnv() {
        const raw = process.env.ONBOARDING_DEVICE_SECRETS;
        if (!raw || !raw.trim()) {
            return {};
        }

        try {
            const parsed = JSON.parse(raw);
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
                return {};
            }
            return parsed;
        } catch {
            return {};
        }
    }

    getDeviceSecret(uniqueId) {
        console.log(`[OnboardingService] Looking for device secret for uniqueId="${uniqueId}"`);
        
        // Priority 1: Individual device secret from JSON map (for testing/override)
        const secretsMap = this.parseDeviceSecretsFromEnv();
        const fromMap = secretsMap[uniqueId];
        if (typeof fromMap === 'string' && fromMap.trim()) {
            console.log(`[OnboardingService] Found explicit secret in ONBOARDING_DEVICE_SECRETS map`);
            return fromMap.trim();
        }

        // Priority 2: Individual device env variable (for testing/override)
        const envKey = `DEVICE_SECRET_${uniqueId.replace(/[^a-zA-Z0-9]/g, '_').toUpperCase()}`;
        const fromEnvKey = process.env[envKey];
        if (typeof fromEnvKey === 'string' && fromEnvKey.trim()) {
            console.log(`[OnboardingService] Found explicit secret in env key ${envKey}`);
            return fromEnvKey.trim();
        }

        // Priority 3: Derive from master secret (scalable for production)
        const masterSecretHex = process.env.ONBOARDING_MASTER_SECRET;
        if (typeof masterSecretHex === 'string' && masterSecretHex.trim()) {
            console.log(`[OnboardingService] Deriving device secret from ONBOARDING_MASTER_SECRET`);
            
            // Decode hex master secret to bytes (to match Python bytes.fromhex())
            const masterSecret = Buffer.from(masterSecretHex.trim(), 'hex');
            
            // Return raw bytes Buffer (to match Python's .digest())
            const derivedSecret = crypto
                .createHmac('sha256', masterSecret)
                .update(uniqueId)
                .digest();  // Returns Buffer, not hex string
            
            return derivedSecret;
        }

        console.log(`[OnboardingService] No device secret found for uniqueId="${uniqueId}"`);
        console.log(`[OnboardingService] Configure either ONBOARDING_MASTER_SECRET or device-specific secret`);
        return null;
    }

    purgeExpiredChallenges() {
        const now = Date.now();
        for (const [uniqueId, challengeInfo] of this.pendingChallenges.entries()) {
            if (!challengeInfo || challengeInfo.expiresAt <= now) {
                this.pendingChallenges.delete(uniqueId);
            }
        }
    }

    computeExpectedProof(deviceSecret, challenge) {
        return crypto
            .createHmac('sha256', deviceSecret)
            .update(challenge)
            .digest('hex');
    }

    isProofValid(expectedProof, providedProof) {
        if (typeof expectedProof !== 'string' || typeof providedProof !== 'string') {
            return false;
        }
        if (expectedProof.length !== providedProof.length) {
            return false;
        }

        const expectedBuffer = Buffer.from(expectedProof, 'utf8');
        const providedBuffer = Buffer.from(providedProof, 'utf8');
        return crypto.timingSafeEqual(expectedBuffer, providedBuffer);
    }

    async createChallenge(uniqueId) {
        const normalizedUniqueId = typeof uniqueId === 'string' ? uniqueId.trim() : '';
        if (!normalizedUniqueId) {
            return { ok: false, error: 'unique_id is required' };
        }

        const deviceResult = await this.deviceService.getDeviceByUniqueId(normalizedUniqueId);
        if (!deviceResult.ok) {
            return { ok: false, error: deviceResult.error };
        }

        if (deviceResult.device.is_claimed) {
            return { ok: false, error: 'device already claimed' };
        }

        const deviceSecret = this.getDeviceSecret(normalizedUniqueId);
        if (!deviceSecret) {
            return { ok: false, error: 'device secret is not configured' };
        }

        this.purgeExpiredChallenges();

        const challenge = tokenUtils.generateToken();
        this.pendingChallenges.set(normalizedUniqueId, {
            challenge,
            expiresAt: Date.now() + this.challengeTtlMs
        });

        return {
            ok: true,
            challenge,
            expires_in_ms: this.challengeTtlMs
        };
    }

    async provisionWithProof({ uniqueId, challenge, proof }) {
        const normalizedUniqueId = typeof uniqueId === 'string' ? uniqueId.trim() : '';
        const normalizedChallenge = typeof challenge === 'string' ? challenge.trim() : '';
        const normalizedProof = typeof proof === 'string' ? proof.trim().toLowerCase() : '';

        if (!normalizedUniqueId) {
            return { ok: false, error: 'unique_id is required' };
        }
        if (!normalizedChallenge) {
            return { ok: false, error: 'challenge is required' };
        }
        if (!normalizedProof) {
            return { ok: false, error: 'proof is required' };
        }

        this.purgeExpiredChallenges();

        const challengeInfo = this.pendingChallenges.get(normalizedUniqueId);
        if (!challengeInfo || challengeInfo.challenge !== normalizedChallenge || challengeInfo.expiresAt <= Date.now()) {
            return { ok: false, error: 'invalid or expired challenge' };
        }

        const deviceResult = await this.deviceService.getDeviceByUniqueId(normalizedUniqueId);
        if (!deviceResult.ok) {
            return { ok: false, error: deviceResult.error };
        }

        const device = deviceResult.device;
        if (device.is_claimed) {
            return { ok: false, error: 'device already claimed' };
        }

        const deviceSecret = this.getDeviceSecret(normalizedUniqueId);
        if (!deviceSecret) {
            return { ok: false, error: 'device secret is not configured' };
        }

        const expectedProof = this.computeExpectedProof(deviceSecret, normalizedChallenge).toLowerCase();
        if (!this.isProofValid(expectedProof, normalizedProof)) {
            return { ok: false, error: 'invalid proof' };
        }

        const generatedCreds = this.mqttCredService.buildProvisionedCredentials({
            uniqueId: normalizedUniqueId,
            deviceId: device.id
        });

        const credentialResult = await this.mqttCredService.createMqttCredRow({
            device_id: device.id,
            unique_id: normalizedUniqueId,
            mqtt_username: generatedCreds.mqtt_username,
            mqtt_password_encrypted: generatedCreds.mqtt_password_encrypted
        });

        if (!credentialResult.ok) {
            if (
                credentialResult.error === 'mqtt_credentials_for_device_exists' ||
                credentialResult.error === 'mqtt_username_exists'
            ) {
                return { ok: false, error: credentialResult.error };
            }
            return { ok: false, error: credentialResult.error || 'mqtt provisioning failed' };
        }

        const claimResult = await this.deviceService.claimDeviceById(device.id);
        if (!claimResult.ok) {
            const rollbackResult = await this.mqttCredService.deleteMqttCredByDeviceId(device.id);
            if (!rollbackResult.ok) {
                return {
                    ok: false,
                    error: 'failed to claim device and rollback credentials',
                    details: {
                        claim_error: claimResult.error,
                        rollback_error: rollbackResult.error
                    }
                };
            }

            if (claimResult.error === 'device_already_claimed_or_missing') {
                return { ok: false, error: 'device already claimed' };
            }
            return { ok: false, error: claimResult.error || 'failed to claim device' };
        }

        this.pendingChallenges.delete(normalizedUniqueId);

        return {
            ok: true,
            device: claimResult.device,
            mqtt_credentials: {
                mqtt_username: generatedCreds.mqtt_username,
                mqtt_password: generatedCreds.mqtt_password,
                mqtt_client_id: generatedCreds.mqtt_client_id,
                mqtt_broker_url: generatedCreds.mqtt_broker_url,
                mqtt_broker_port: generatedCreds.mqtt_broker_port
            }
        };
    }
}

export default OnboardingService;
