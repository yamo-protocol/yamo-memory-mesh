export declare class MemoryMesh {
    constructor();
    init(): Promise<void>;
    add(content: string, metadata?: Record<string, any>): Promise<{
        id: string;
        content: string;
        metadata: Record<string, any>;
        created_at: string;
    }>;
    addBatch(entries: Array<{
        content: string;
        metadata?: Record<string, any>;
    }>): Promise<{
        count: number;
        success: boolean;
        ids: string[];
    }>;
    search(query: string, options?: {
        limit?: number;
        filter?: string;
        useCache?: boolean;
    }): Promise<Array<{
        id: string;
        content: string;
        metadata: Record<string, any>;
        score: number;
        created_at: string;
    }>>;
    get(id: string): Promise<{
        id: string;
        content: string;
        metadata: Record<string, any>;
        created_at: string;
        updated_at: string;
    } | null>;
    getAll(options?: {
        limit?: number;
    }): Promise<Array<any>>;
    update(id: string, content: string, metadata?: Record<string, any>): Promise<{
        id: string;
        content: string;
        success: boolean;
    }>;
    delete(id: string): Promise<{
        deleted: string;
        success: boolean;
    }>;
    stats(): Promise<{
        count: number;
        tableName: string;
        uri: string;
        isConnected: boolean;
        embedding: any;
    }>;
    healthCheck(): Promise<{
        status: string;
        timestamp: string;
        checks: Record<string, any>;
    }>;
}

export declare class Scrubber {
    constructor(config?: ScrubberConfig);
    process(document: {
        content: string;
        source: string;
        type: 'html' | 'md' | 'txt';
    }): Promise<ScrubberResult>;
}

export interface ScrubberConfig {
    enabled?: boolean;
    structural?: {
        stripHTML?: boolean;
        normalizeMarkdown?: boolean;
        collapseWhitespace?: boolean;
        removeScripts?: boolean;
        removeStyles?: boolean;
    };
    semantic?: {
        removeDuplicates?: boolean;
        removeBoilerplate?: boolean;
        minSignalRatio?: number;
    };
    chunking?: {
        maxTokens?: number;
        minTokens?: number;
        splitOnHeadings?: boolean;
    };
    validation?: {
        enforceMinLength?: boolean;
    };
}

export interface ScrubberResult {
    chunks: Array<{
        text: string;
        metadata: Record<string, any>;
    }>;
    metadata: {
        source: string;
        type: string;
        processingTimestamp: string;
    };
    telemetry: {
        totalDuration: number;
        stages: Record<string, any>;
    };
    success: boolean;
    error?: string;
}
