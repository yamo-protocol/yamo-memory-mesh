// Mock LanceDB Connection and Table

export class MockTable {
  constructor(name) {
    this.name = name;
    this.data = [];
  }

  async add(records) {
    this.data.push(...records);
    return { success: true };
  }

  async count() {
    return this.data.length;
  }

  search(vector) {
    return {
      limit: (n) => ({
        execute: async () => {
          // Return pseudo-results
          return [{
            toArray: () => this.data.slice(0, n).map(r => ({
              ...r,
              _distance: 0.1,
              content: r.content,
              id: r.id
            }))
          }];
        }
      })
    };
  }
}

export class MockConnection {
  async openTable(name) {
    return new MockTable(name);
  }
  async createTable(name) {
    return new MockTable(name);
  }
  async tableNames() {
    return [];
  }
}

export const mockConnect = async (uri) => {
  if (uri.includes('fail')) throw new Error('Connection failed');
  return new MockConnection();
};
