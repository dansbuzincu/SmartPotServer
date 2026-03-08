# SmartPotServer
Server side for SmartPot

## ESP32 MQTT Onboarding API

This backend supports challenge-based MQTT provisioning for ESP32 onboarding.

### Architecture: Shared Credentials (HiveMQ Free Plan)

All ESP32 devices use **shared credentials** for authentication, but each device has a **unique Client ID** for identity and tracking.

**HiveMQ Setup Required:**
1. In HiveMQ Cloud dashboard, manually create these credentials:
   - Username: `smartpot_device` / Password: `<strong-password>` (for all ESP32 devices)
   - Username: `smartpot_app` / Password: `<strong-password>` (for phone apps)

2. Set the same credentials in `.env`:
   ```
   MQTT_SHARED_ESP_USERNAME=smartpot_device
   MQTT_SHARED_ESP_PASSWORD=<strong-password>
   MQTT_SHARED_APP_USERNAME=smartpot_app
   MQTT_SHARED_APP_PASSWORD=<strong-password>
   ```

3. Configure HiveMQ **Authorization** rules:
   - `smartpot_device` → Publish to `devices/+/#` only
   - `smartpot_app` → Subscribe to `devices/#` only

## Factory Device Registration API

Use this endpoint from the factory tool after hardware verification to register a device in the `devices` table.

### Register device

`POST /api/devices`

Backward-compatible alias: `POST /api/devices/insert`

Request body:

```json
{
	"unique_id": "ESP32-ABC123"
}
```

Notes:

- `unique_id` is required.
- Device is inserted with `is_claimed: false`.
- `device_label` is always stored as `null` at factory registration time.

Created response (`201`):

```json
{
	"success": true,
	"created": true,
	"message": "Device inserted successfully",
	"device": {
		"id": 1,
		"unique_id": "ESP32-ABC123",
		"device_label": null,
		"is_claimed": false
	}
}
```

Idempotent retry response (`200`) when `unique_id` already exists:

```json
{
	"success": true,
	"created": false,
	"message": "Device already exists",
	"device": {
		"id": 1,
		"unique_id": "ESP32-ABC123",
		"device_label": null,
		"is_claimed": false
	}
}
```

Validation error (`400`):

```json
{
	"success": false,
	"error": "unique_id is required"
}
```

### 1) Request challenge

`POST /api/onboarding/challenge`

Request body:

```json
{
	"unique_id": "ESP32-ABC123"
}
```

Success response:

```json
{
	"success": true,
	"unique_id": "ESP32-ABC123",
	"challenge": "<random challenge>",
	"expires_in_ms": 300000
}
```

### 2) Provision with proof

`POST /api/onboarding/provision`

Request body:

```json
{
	"unique_id": "ESP32-ABC123",
	"challenge": "<challenge from step 1>",
	"proof": "<hex hmac sha256 of challenge using device_secret>"
}
```

Success response:

```json
{
	"success": true,
	"message": "Device provisioned successfully",
	"device": {
		"id": 1,
		"unique_id": "ESP32-ABC123",
		"device_label": null,
		"is_claimed": true
	},
	"mqtt_credentials": {
		"mqtt_username": "smartpot_device",
		"mqtt_password": "<shared-password>",
		"mqtt_client_id": "esp-ESP32-ABC123",
		"mqtt_broker_url": "216c41548cba463dac9e11bcd23e57c5.s1.eu.hivemq.cloud",
		"mqtt_broker_port": 8883
	}
}
```

**ESP32 Implementation:**
```cpp
// Use broker info from response
const char* broker = credentials.mqtt_broker_url;
int port = credentials.mqtt_broker_port;

// Use shared credentials from response
client.setUsernamePassword(credentials.mqtt_username, credentials.mqtt_password);

// Use unique Client ID for device identity
client.setId(credentials.mqtt_client_id);  // "esp-ESP32-ABC123"

// Connect to HiveMQ
client.connect(broker, port);

// Publish to device-specific topic
String topic = "devices/" + unique_id + "/temperature";
client.publish(topic, payload);
```

If the device is already claimed, the API returns:

```json
{
	"success": false,
	"error": "device already claimed"
}
```

## Device Secret Configuration

The backend needs to verify device authenticity during onboarding using HMAC challenge-response.

### Recommended: Master Secret (Production)

Use **one master secret** to derive device-specific secrets automatically:

```bash
# In .env (hex-encoded string)
ONBOARDING_MASTER_SECRET=dc5636ab213dfd52feae9ecd451b66bf50c3c99181ae497ace5daf6932a84fe6
```

**How it works:**
- Master secret is stored as hex string in `.env`, decoded to bytes before use
- Backend derives: `device_secret = HMAC-SHA256(master_secret_bytes, unique_id)` → raw bytes
- Device computes: `proof = HMAC-SHA256(device_secret_bytes, challenge)` → hex string
- No need to pre-configure secrets for each device

**Python/ESP32 Implementation:**
```python
import hmac
import hashlib

# Hardcoded in firmware (hex string, burned during factory programming)
MASTER_SECRET_HEX = "dc5636ab213dfd52feae9ecd451b66bf50c3c99181ae497ace5daf6932a84fe6"
master_secret = bytes.fromhex(MASTER_SECRET_HEX)

# Derive device secret (returns raw bytes)
device_secret = hmac.new(master_secret, unique_id.encode("utf-8"), hashlib.sha256).digest()

# Compute proof for challenge-response (returns hex string)
proof = hmac.new(device_secret, challenge.encode("utf-8"), hashlib.sha256).hexdigest()
```

### Alternative: Individual Device Secrets (Testing Only)

For testing specific devices with custom secrets:

**Option 1:** JSON map in `.env`
```text
ONBOARDING_DEVICE_SECRETS={"ESP32-ABC123":"supersecret1","ESP32-XYZ999":"supersecret2"}
```

**Option 2:** Per-device environment variable
```text
DEVICE_SECRET_ESP32_ABC123=supersecret1
```

Variable name is created from `unique_id` by replacing non-alphanumeric characters with `_` and uppercasing.

**Priority order:**
1. Individual device secret in `ONBOARDING_DEVICE_SECRETS` JSON
2. Individual device secret via `DEVICE_SECRET_*` env variable
3. Derived from `ONBOARDING_MASTER_SECRET` (recommended)

---

## Upgrading to Unique Credentials (HiveMQ Paid Plan)

When your business booms 🚀 and you upgrade to HiveMQ Cloud paid plan:

1. **Enable unique credential mode:**
   ```bash
   # In .env
   MQTT_USE_UNIQUE_CREDENTIALS=true
   HIVEMQ_API_URL=https://your-cluster.hivemq.cloud
   HIVEMQ_API_TOKEN=your_api_token
   ```

2. **Switch to unique credential method:**
   ```javascript
   // In OnboardingService.js
   const generatedCreds = this.mqttCredService.buildProvisionedCredentialsUnique({
       uniqueId: normalizedUniqueId,
       deviceId: device.id
   });
   ```

3. **Add HiveMQ API integration** to push credentials automatically.

The database schema already supports this - no migration needed!
