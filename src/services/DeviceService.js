import CDatabaseManager from "../database/CDatabaseManager.js";
import DevicesRepo from "../repos/DevicesRepo.js";
import tokenUtils from "../tokenUtils.js";


class DeviceService {
    constructor({devicesRepo}) {
        this.devicesRepo = devicesRepo;
    }

    async createDeviceRow(uniqueId, name = null, token) {

      let newRow = {};

      // Support being called with a single `row` object (routes pass an object),
      // or with positional args (uniqueId, name, token).
      if (uniqueId && typeof uniqueId === 'object') {
        const rowObj = uniqueId;
        newRow.unique_id = rowObj.unique_id;
        if (rowObj.token_hash) {
          newRow.token_hash = rowObj.token_hash;
        } else if (rowObj.token) {
          newRow.token_hash = tokenUtils.hashToken(rowObj.token);
        } else if (typeof token === 'string') {
          newRow.token_hash = tokenUtils.hashToken(token);
        } else {
          return { ok: false, error: 'token or token_hash required' };
        }
        newRow.name = rowObj.name || null;
        newRow.claimed = !!rowObj.claimed;
      } else {
        newRow.unique_id = uniqueId;
        if (typeof token !== 'string') {
          return { ok: false, error: 'token is required when calling with positional args' };
        }
        newRow.token_hash = tokenUtils.hashToken(token);
        newRow.name = name;
        newRow.claimed = false;
      }

      return await this.devicesRepo.insertRow(newRow);
    }

    async claimDevice(token) {
        const hashedToken = tokenUtils.hashToken(token);
        return await this.devicesRepo.claimToken(hashedToken);
    }

    async validateToken(token) {
        return await this.devicesRepo.queryForToken(token);
    }

    async shutdown() {
        await this.database.shutdown();
    }
}


export default DeviceService;