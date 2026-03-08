class DeviceService {
    constructor({devicesRepo}) {
        this.devicesRepo = devicesRepo;
    }

    async createDeviceRow(uniqueId, deviceLabel = null) {

      let newRow = {};

      // Support being called with a single `row` object (routes pass an object),
      // or with positional args (uniqueId, deviceLabel).
      if (uniqueId && typeof uniqueId === 'object') {
        const rowObj = uniqueId;
        if (typeof rowObj.unique_id !== 'string' || !rowObj.unique_id.trim()) {
          return { ok: false, error: 'unique_id is required' };
        }

        newRow.unique_id = rowObj.unique_id.trim();
        newRow.device_label = rowObj.device_label ?? rowObj.name ?? null;
        newRow.is_claimed = typeof rowObj.is_claimed === 'boolean'
          ? rowObj.is_claimed
          : !!rowObj.claimed;
      } else {
        if (typeof uniqueId !== 'string' || !uniqueId.trim()) {
          return { ok: false, error: 'unique_id is required when calling with positional args' };
        }
        newRow.unique_id = uniqueId.trim();
        newRow.device_label = deviceLabel;
        newRow.is_claimed = false;
      }

      return await this.devicesRepo.insertRow(newRow);
    }

    async claimDeviceById(deviceId) {
        const normalizedId = Number(deviceId);
        if (!Number.isInteger(normalizedId) || normalizedId <= 0) {
            return { ok: false, error: 'device_id must be a positive integer' };
        }
        return await this.devicesRepo.claimDeviceById(normalizedId);
    }

    async getDeviceByUniqueId(uniqueId) {
      if (typeof uniqueId !== 'string' || !uniqueId.trim()) {
        return { ok: false, error: 'unique_id is required' };
      }
      return await this.devicesRepo.queryByUniqueId(uniqueId.trim());
    }

    async deleteDeviceById(deviceId) {
        const normalizedId = Number(deviceId);
        if (!Number.isInteger(normalizedId) || normalizedId <= 0) {
            return { ok: false, error: 'device_id must be a positive integer' };
        }
        return await this.devicesRepo.deleteById(normalizedId);
    }

    async shutdown() {
        return;
    }
}


export default DeviceService;