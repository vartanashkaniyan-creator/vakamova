// core/database-interface.js

/**
 * رابط انتزاعی برای لایه دیتابیس
 * @interface
 */
class IDatabase {
  async init(schema) { throw new Error('Not implemented'); }
  async close() { throw new Error('Not implemented'); }
  async add(storeName, record) { throw new Error('Not implemented'); }
  async bulkAdd(storeName, records) { throw new Error('Not implemented'); }
  async get(storeName, key) { throw new Error('Not implemented'); }
  async update(storeName, key, updates) { throw new Error('Not implemented'); }
  async delete(storeName, key) { throw new Error('Not implemented'); }
  async clear(storeName) { throw new Error('Not implemented'); }
  async queryByIndex(storeName, indexName, value, options = {}) { throw new Error('Not implemented'); }
  async queryByRange(storeName, indexName, lowerBound, upperBound, options = {}) { throw new Error('Not implemented'); }
  async getAll(storeName, options = {}) { throw new Error('Not implemented'); }
  async count(storeName) { throw new Error('Not implemented'); }
  async transaction(storeNames, mode, transactionLogic) { throw new Error('Not implemented'); }
  async isReady() { throw new Error('Not implemented'); }
  async deleteDatabase() { throw new Error('Not implemented'); }
}

export default IDatabase;
