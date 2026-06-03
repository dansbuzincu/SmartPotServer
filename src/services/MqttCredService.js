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
        const mqttClientId = this.buildMqttClientId(uniqueId, deviceId);
        return {
            mqtt_username: sharedCreds.mqtt_username,
            mqtt_password: sharedCreds.mqtt_password,
            mqtt_client_id: mqttClientId,
            mqtt_broker_url: process.env.MQTT_BROKER_URL || 'localhost',
            mqtt_broker_port: parseInt(process.env.MQTT_BROKER_PORT || '8883', 10),
            auth_mode: 'shared_password'
        };
    }

    // Legacy method for unique credentials (when upgrading to paid HiveMQ)
    buildProvisionedCredentialsUnique({ uniqueId, deviceId }) {
        return {
            mqtt_username: this.buildDefaultMqttUsername(uniqueId, deviceId),
            mqtt_password: this.buildGeneratedMqttPassword(),
            mqtt_client_id: this.buildMqttClientId(uniqueId, deviceId),
            auth_mode: 'unique_password'
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
            newRow.auth_mode = typeof rowObj.auth_mode === 'string' && rowObj.auth_mode.trim()
                ? rowObj.auth_mode.trim()
                : 'shared_password';
            newRow.mqtt_client_id = typeof rowObj.mqtt_client_id === 'string' && rowObj.mqtt_client_id.trim()
                ? rowObj.mqtt_client_id.trim()
                : this.buildMqttClientId(rowObj.unique_id, normalizedDeviceId);
            const providedUsername = typeof rowObj.mqtt_username === 'string' ? rowObj.mqtt_username.trim() : '';
            newRow.mqtt_username = providedUsername || this.buildDefaultMqttUsername(rowObj.unique_id, normalizedDeviceId);
            newRow.mqtt_password = typeof rowObj.mqtt_password === 'string' && rowObj.mqtt_password.trim()
                ? rowObj.mqtt_password.trim()
                : null;
            newRow.certificate_fingerprint = typeof rowObj.certificate_fingerprint === 'string' && rowObj.certificate_fingerprint.trim()
                ? rowObj.certificate_fingerprint.trim()
                : null;
            newRow.active = typeof rowObj.active === 'boolean' ? rowObj.active : true;
        } else {
            const normalizedDeviceId = Number(deviceId);
            if (!Number.isInteger(normalizedDeviceId) || normalizedDeviceId <= 0) {
                return { ok: false, error: 'device_id is required when calling with positional args' };
            }

            newRow.device_id = normalizedDeviceId;
            newRow.auth_mode = 'shared_password';
            newRow.mqtt_client_id = this.buildMqttClientId(null, normalizedDeviceId);
            const providedUsername = typeof mqttUsername === 'string' ? mqttUsername.trim() : '';
            newRow.mqtt_username = providedUsername || this.buildDefaultMqttUsername(null, normalizedDeviceId);
            newRow.mqtt_password = typeof mqttPasswordEncrypted === 'string' && mqttPasswordEncrypted.trim()
                ? mqttPasswordEncrypted.trim()
                : null;
            newRow.certificate_fingerprint = null;
            newRow.active = true;
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
        return directLookup;
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
