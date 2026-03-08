import tokenUtils from "../tokenUtils.js";

class MqttCredService {
    constructor({mqttCredsRepo}) {
        this.mqttCredsRepo = mqttCredsRepo;
    }

    // Static shared credentials (for free HiveMQ plan)
    getSharedEspCredentials() {
        return {
            mqtt_username: process.env.MQTT_SHARED_ESP_USERNAME || 'smartpot_device',
            mqtt_password: process.env.MQTT_SHARED_ESP_PASSWORD || 'change_me_in_production'
        };
    }

    getSharedAppCredentials() {
        return {
            mqtt_username: process.env.MQTT_SHARED_APP_USERNAME || 'smartpot_app',
            mqtt_password: process.env.MQTT_SHARED_APP_PASSWORD || 'change_me_in_production'
        };
    }

    // Build MQTT Client ID for device identity (used with shared credentials)
    buildMqttClientId(uniqueId, deviceId = null) {
        if (typeof uniqueId === 'string' && uniqueId.trim()) {
            return `esp-${uniqueId.trim()}`;
        }
        if (Number.isInteger(deviceId) && deviceId > 0) {
            return `esp-device-${deviceId}`;
        }
        return `esp-${tokenUtils.generateToken().slice(0, 16)}`;
    }

    buildDefaultMqttUsername(uniqueId, deviceId = null) {
        if (typeof uniqueId === 'string' && uniqueId.trim()) {
            const suffix = tokenUtils.hashToken(uniqueId.trim()).slice(0, 24);
            return `sp_${suffix}`;
        }

        if (Number.isInteger(deviceId) && deviceId > 0) {
            return `sp_device_${deviceId}`;
        }

        return `sp_${tokenUtils.generateToken().slice(0, 16)}`;
    }

    buildGeneratedMqttPassword() {
        return tokenUtils.generateToken();
    }

    buildProvisionedCredentials({ uniqueId, deviceId }) {
        // For free HiveMQ plan: return shared credentials + client ID
        const sharedCreds = this.getSharedEspCredentials();
        return {
            mqtt_username: sharedCreds.mqtt_username,
            mqtt_password: sharedCreds.mqtt_password,
            mqtt_client_id: this.buildMqttClientId(uniqueId, deviceId),
            mqtt_broker_url: process.env.MQTT_BROKER_URL || 'localhost',
            mqtt_broker_port: parseInt(process.env.MQTT_BROKER_PORT || '8883', 10),
            // Store client_id in DB for tracking (backwards compatible field name)
            mqtt_password_encrypted: this.buildMqttClientId(uniqueId, deviceId)
        };
    }

    // Legacy method for unique credentials (when upgrading to paid HiveMQ)
    buildProvisionedCredentialsUnique({ uniqueId, deviceId }) {
        return {
            mqtt_username: this.buildDefaultMqttUsername(uniqueId, deviceId),
            mqtt_password: this.buildGeneratedMqttPassword(),
            mqtt_client_id: this.buildMqttClientId(uniqueId, deviceId),
            mqtt_password_encrypted: this.buildGeneratedMqttPassword()
        };
    }

    async createMqttCredRow(deviceId, mqttUsername = null, mqttPasswordEncrypted = null) {
        let newRow = {};

        // Support being called with a single `row` object,
        // or with positional args (deviceId, mqttUsername, mqttPasswordEncrypted).
        if (deviceId && typeof deviceId === 'object') {
            const rowObj = deviceId;
            const normalizedDeviceId = Number(rowObj.device_id);
            if (!Number.isInteger(normalizedDeviceId) || normalizedDeviceId <= 0) {
                return { ok: false, error: 'device_id is required' };
            }

            newRow.device_id = normalizedDeviceId;
            const providedUsername = typeof rowObj.mqtt_username === 'string' ? rowObj.mqtt_username.trim() : '';
            newRow.mqtt_username = providedUsername || this.buildDefaultMqttUsername(rowObj.unique_id, normalizedDeviceId);

            if (typeof rowObj.mqtt_password_encrypted === 'string' && rowObj.mqtt_password_encrypted.trim()) {
                newRow.mqtt_password_encrypted = rowObj.mqtt_password_encrypted.trim();
            } else {
                return { ok: false, error: 'mqtt_password_encrypted is required' };
            }
        } else {
            const normalizedDeviceId = Number(deviceId);
            if (!Number.isInteger(normalizedDeviceId) || normalizedDeviceId <= 0) {
                return { ok: false, error: 'device_id is required when calling with positional args' };
            }

            newRow.device_id = normalizedDeviceId;
            const providedUsername = typeof mqttUsername === 'string' ? mqttUsername.trim() : '';
            newRow.mqtt_username = providedUsername || this.buildDefaultMqttUsername(null, normalizedDeviceId);

            if (typeof mqttPasswordEncrypted !== 'string' || !mqttPasswordEncrypted.trim()) {
                return { ok: false, error: 'mqtt_password_encrypted is required when calling with positional args' };
            }

            newRow.mqtt_password_encrypted = mqttPasswordEncrypted.trim();
        }

        return await this.mqttCredsRepo.insertRow(newRow);
    }

    async validateToken(tokenOrCredential) {
        if (typeof tokenOrCredential !== 'string' || !tokenOrCredential.trim()) {
            return { ok: false, error: 'token is required' };
        }

        const candidate = tokenOrCredential.trim();

        // Factory payloads may already provide the final credential value used in DB.
        const directLookup = await this.mqttCredsRepo.queryDeviceByCredentialValue(candidate);
        if (directLookup.ok) {
            return directLookup;
        }
        if (directLookup.error !== 'no device found with that credential') {
            return directLookup;
        }

        // Backward-compatible claim flow: QR carries raw token while DB stores a hash.
        const tokenHash = tokenUtils.hashToken(candidate);
        if (tokenHash === candidate) {
            return directLookup;
        }

        return await this.mqttCredsRepo.queryDeviceByCredentialValue(tokenHash);
    }

    async deleteMqttCredByDeviceId(deviceId) {
        const normalizedId = Number(deviceId);
        if (!Number.isInteger(normalizedId) || normalizedId <= 0) {
            return { ok: false, error: 'device_id must be a positive integer' };
        }
        return await this.mqttCredsRepo.deleteByDeviceId(normalizedId);
    }

    async shutdown() {
        return;
    }
}

export default MqttCredService;
