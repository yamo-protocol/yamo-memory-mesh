import { fileURLToPath } from 'url';
import crypto from "crypto";
import fs from "fs";
import path from "path";

/**
 * Tamper-Proof Audit Logger
 * Implements blockchain-like integrity using HMAC chain with file locking
 */
class AuditLogger {
    constructor(options = {}) {
        this.logPath = options.logPath || path.join(__dirname, '..', 'logs', 'audit.log');
        this.lockPath = this.logPath + '.lock';
        this.lockTimeout = options.lockTimeout || 5000; // 5 seconds default
        this.lockRetryDelay = options.lockRetryDelay || 50; // 50ms between retries
        this.secret = process.env.AUDIT_SECRET || this.generateSecret();
        this.ensureLogDirectory();

        // Warn if using default secret
        if (!process.env.AUDIT_SECRET) {
            console.warn('⚠️  Using auto-generated AUDIT_SECRET. Set AUDIT_SECRET in .env for production');
        }
    }

    /**
     * Ensure log directory exists
     */
    ensureLogDirectory() {
        const logDir = path.dirname(this.logPath);
        if (!fs.existsSync(logDir)) {
            fs.mkdirSync(logDir, { recursive: true });
        }
    }

    /**
     * Generate a secret if none provided
     */
    generateSecret() {
        return crypto.randomBytes(32).toString('hex');
    }

    /**
     * Acquire exclusive lock on log file
     * Uses lock file mechanism for cross-platform compatibility
     * @returns {boolean} - True if lock acquired, false if timeout
     */
    acquireLock() {
        const startTime = Date.now();
        const lockData = {
            pid: process.pid,
            timestamp: new Date().toISOString()
        };

        while (Date.now() - startTime < this.lockTimeout) {
            try {
                // Try to create lock file exclusively (fails if exists)
                fs.writeFileSync(this.lockPath, JSON.stringify(lockData), { flag: 'wx' });
                return true;
            } catch (err) {
                if (err.code === 'EEXIST') {
                    // Lock file exists, check if stale
                    try {
                        const existingLock = JSON.parse(fs.readFileSync(this.lockPath, 'utf8'));
                        const lockAge = Date.now() - new Date(existingLock.timestamp).getTime();

                        // If lock is older than timeout, consider it stale and remove
                        if (lockAge > this.lockTimeout) {
                            console.warn(`⚠️  Removing stale lock file (age: ${lockAge}ms)`);
                            fs.unlinkSync(this.lockPath);
                        }
                    } catch {
                        // Ignore errors reading lock file
                    }

                    // Wait before retry
                    const sleepSync = (ms) => {
                        const start = Date.now();
                        while (Date.now() - start < ms) {}
                    };
                    sleepSync(this.lockRetryDelay);
                } else {
                    throw err;
                }
            }
        }

        return false;
    }

    /**
     * Release lock on log file
     */
    releaseLock() {
        try {
            if (fs.existsSync(this.lockPath)) {
                fs.unlinkSync(this.lockPath);
            }
        } catch (err) {
            console.error(`⚠️  Warning: Failed to release lock: ${err.message}`);
        }
    }

    /**
     * Execute a function with file lock protection
     * @param {Function} fn - Function to execute while holding lock
     * @returns {*} - Result of function
     */
    withLock(fn) {
        if (!this.acquireLock()) {
            throw new Error(`Failed to acquire log file lock after ${this.lockTimeout}ms`);
        }

        try {
            return fn();
        } finally {
            this.releaseLock();
        }
    }

    /**
     * Get hash of last log entry for chain integrity (unsafe - no locking)
     * Internal use only - called from within withLock()
     * @private
     */
    _getLastHashUnsafe() {
        if (!fs.existsSync(this.logPath)) {
            return '0000000000000000000000000000000000000000000000000000000000000000'; // Genesis
        }

        const lines = fs.readFileSync(this.logPath, 'utf8').split('\n').filter(Boolean);
        if (lines.length === 0) {
            return '0000000000000000000000000000000000000000000000000000000000000000';
        }

        try {
            const lastEntry = JSON.parse(lines[lines.length - 1]);
            return lastEntry.integrity_hash || '0000000000000000000000000000000000000000000000000000000000000000';
        } catch {
            return '0000000000000000000000000000000000000000000000000000000000000000';
        }
    }

    /**
     * Get hash of last log entry for chain integrity (thread-safe)
     */
    getLastHash() {
        return this.withLock(() => this._getLastHashUnsafe());
    }

    /**
     * Log an audit event with integrity chain
     * Uses file locking to prevent concurrent write corruption
     * @param {Object} event - Event data to log
     * @returns {Object} - Logged entry with hash
     */
    log(event) {
        return this.withLock(() => {
            const entry = {
                '@timestamp': new Date().toISOString(),
                sequence: this._getSequenceNumberUnsafe(),
                prev_hash: this._getLastHashUnsafe(),
                ...event
            };

            // Generate integrity hash
            const hash = crypto
                .createHmac('sha256', this.secret)
                .update(JSON.stringify(entry))
                .digest('hex');

            entry.integrity_hash = hash;

            // Append to log file
            fs.appendFileSync(this.logPath, JSON.stringify(entry) + '\n');

            return entry;
        });
    }

    /**
     * Get next sequence number (unsafe - no locking)
     * Internal use only - called from within withLock()
     * @private
     */
    _getSequenceNumberUnsafe() {
        if (!fs.existsSync(this.logPath)) {
            return 1;
        }

        const lines = fs.readFileSync(this.logPath, 'utf8').split('\n').filter(Boolean);
        return lines.length + 1;
    }

    /**
     * Get next sequence number (thread-safe)
     */
    getSequenceNumber() {
        return this.withLock(() => this._getSequenceNumberUnsafe());
    }

    /**
     * Verify integrity of entire audit log
     * @returns {{valid: boolean, errors: Array, total: number}}
     */
    verify() {
        if (!fs.existsSync(this.logPath)) {
            return { valid: true, errors: [], total: 0, message: 'No audit log exists' };
        }

        const lines = fs.readFileSync(this.logPath, 'utf8').split('\n').filter(Boolean);
        const errors = [];
        let prevHash = '0000000000000000000000000000000000000000000000000000000000000000';

        for (let i = 0; i < lines.length; i++) {
            try {
                const entry = JSON.parse(lines[i]);
                const { integrity_hash, ...data } = entry;

                // Check previous hash chain
                if (entry.prev_hash !== prevHash) {
                    errors.push({
                        line: i + 1,
                        type: 'chain_broken',
                        message: `Previous hash mismatch. Expected: ${prevHash}, Got: ${entry.prev_hash}`
                    });
                }

                // Verify integrity hash
                const expected = crypto
                    .createHmac('sha256', this.secret)
                    .update(JSON.stringify(data))
                    .digest('hex');

                if (expected !== integrity_hash) {
                    errors.push({
                        line: i + 1,
                        type: 'tampered',
                        message: `Integrity hash mismatch. Entry may have been tampered with.`
                    });
                }

                prevHash = integrity_hash;

            } catch (error) {
                errors.push({
                    line: i + 1,
                    type: 'parse_error',
                    message: `Failed to parse JSON: ${error.message}`
                });
            }
        }

        return {
            valid: errors.length === 0,
            errors,
            total: lines.length,
            message: errors.length === 0
                ? `✅ All ${lines.length} entries verified successfully`
                : `❌ ${errors.length} integrity issues found`
        };
    }

    /**
     * Log a security event (high severity)
     */
    logSecurityEvent(event, severity = 'high') {
        return this.log({
            event: {
                kind: 'alert',
                category: 'security',
                type: 'access',
                severity: severity
            },
            ...event
        });
    }

    /**
     * Log DLP scan result
     */
    logDLPScan(findings, metadata = {}) {
        return this.log({
            event: {
                kind: 'event',
                category: 'process',
                type: 'dlp_scan'
            },
            dlp: {
                findings_count: findings.length,
                types: findings.map(f => f.type)
            },
            user: metadata.user_id || 'unknown',
            message: `DLP scan: ${findings.length} findings`
        });
    }

    /**
     * Log LLM API call
     */
    logLLMCall(provider, model, metadata = {}) {
        return this.log({
            event: {
                kind: 'event',
                category: 'process',
                type: 'llm_call'
            },
            llm: {
                provider,
                model
            },
            user: metadata.user_id || 'unknown',
            message: `LLM call to ${provider}/${model}`
        });
    }

    /**
     * Export audit log as JSON array
     */
    export() {
        if (!fs.existsSync(this.logPath)) return [];

        const lines = fs.readFileSync(this.logPath, 'utf8').split('\n').filter(Boolean);
        return lines.map(line => JSON.parse(line));
    }

    /**
     * Get recent entries
     */
    tail(count = 10) {
        const entries = this.export();
        return entries.slice(-count);
    }
}

// CLI usage
if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const logger = new AuditLogger();
    const command = process.argv[2];

    if (command === 'verify') {
        console.log('🔍 Verifying audit log integrity...\n');
        const result = logger.verify();
        console.log(result.message);
        if (!result.valid) {
            console.error('\n❌ Errors found:');
            result.errors.forEach(err => {
                console.error(`   Line ${err.line}: [${err.type}] ${err.message}`);
            });
            process.exit(1);
        }
    } else if (command === 'tail') {
        const count = parseInt(process.argv[3]) || 10;
        const entries = logger.tail(count);
        console.log(`📜 Last ${count} audit entries:\n`);
        entries.forEach(entry => {
            console.log(JSON.stringify(entry, null, 2));
        });
    } else if (command === 'test') {
        console.log('🧪 Testing audit logger...\n');

        logger.logSecurityEvent({
            action: 'login_attempt',
            user: 'test_user',
            result: 'success'
        });

        logger.logLLMCall('openai', 'gpt-4', { user_id: 'test_user' });

        logger.logDLPScan([
            { type: 'email', category: 'pii' },
            { type: 'api_key', category: 'secrets' }
        ], { user_id: 'test_user' });

        console.log('✅ 3 test entries logged');
        console.log('\n🔍 Verifying integrity...');
        const result = logger.verify();
        console.log(result.message);
    } else {
        console.log('Usage:');
        console.log('  node audit_logger.js verify   - Verify log integrity');
        console.log('  node audit_logger.js tail [N] - Show last N entries');
        console.log('  node audit_logger.js test     - Run test');
    }
}

export default AuditLogger;
