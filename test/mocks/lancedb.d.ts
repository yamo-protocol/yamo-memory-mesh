export class MockTable {
    constructor(name: any);
    name: any;
    data: any[];
    add(records: any): Promise<{
        success: boolean;
    }>;
    count(): Promise<number>;
    search(vector: any): {
        limit: (n: any) => {
            execute: () => Promise<{
                toArray: () => any[];
            }[]>;
        };
    };
}
export class MockConnection {
    openTable(name: any): Promise<MockTable>;
    createTable(name: any): Promise<MockTable>;
    tableNames(): Promise<never[]>;
}
export function mockConnect(uri: any): Promise<MockConnection>;
