// Mock LanceDB Connection and Table

export class MockTable {
  name: string;
  data: any[];

  constructor(name: string) {
    this.name = name;
    this.data = [];
  }

  async add(records: any[]) {
    this.data.push(...records);
    return { success: true };
  }

  async count() {
    return this.data.length;
  }

  search(_vector: number[]) {
    return {
      limit: (n: number) => ({
        toArray: async () => {
          return this.data.slice(0, n).map(r => ({
            ...r,
            _distance: 0.1,
            content: r.content,
            id: r.id
          }));
        }
      })
    };
  }

  query() {
    return {
      where: (_condition: string) => ({
        toArray: async () => this.data
      }),
      limit: (_n: number) => ({
        toArray: async () => this.data
      }),
      toArray: async () => this.data
    };
  }
}

export class MockConnection {
  async openTable(name: string) {
    return new MockTable(name);
  }
  async createTable(name: string) {
    return new MockTable(name);
  }
  async tableNames() {
    return [];
  }
  disconnect() {}
}

export const mockConnect = async (uri: string) => {
  if (uri.includes('fail')) throw new Error('Connection failed');
  return new MockConnection();
};
