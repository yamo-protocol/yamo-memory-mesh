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
        // @ts-ignore
        this.logPath = options.logPath || path.join(process.cwd(), 'logs', 'audit.log');
        this.lockPath = this.logPath + '.lock';
        // @ts-ignore
        this.lockTimeout = options.lockTimeout || 5000;
        // @ts-ignore
        this.lockRetryDelay = options.lockRetryDelay || 50;
        this.secret = process.env.AUDIT_SECRET || this.generateSecret();
        this.ensureLogDirectory();

        if (!process.env.AUDIT_SECRET) {
            console.warn('⚠️  Using auto-generated AUDIT_SECRET. Set AUDIT_SECRET in .env for production');
        }
    }

    ensureLogDirectory() {
        const logDir = path.dirname(this.logPath);
        if (!fs.existsSync(logDir)) {
            fs.mkdirSync(logDir, { recursive: true });
        }
    }

    generateSecret() {
        return crypto.randomBytes(32).toString('hex');
    }

    acquireLock() {
        const startTime = Date.now();
        const lockData = {
            pid: process.pid,
            timestamp: new Date().toISOString()
        };

        while (Date.now() - startTime < this.lockTimeout) {
            try {
                fs.writeFileSync(this.lockPath, JSON.stringify(lockData), { flag: 'wx' });
                return true;
            } catch (err) {
                // @ts-ignore
                if (err && err.code === 'EEXIST') {
                    try {
                        const existingLock = JSON.parse(fs.readFileSync(this.lockPath, 'utf8'));
                        const lockAge = Date.now() - new Date(existingLock.timestamp).getTime();
                        if (lockAge > this.lockTimeout) {
                            fs.unlinkSync(this.lockPath);
                        }
                    } catch { /* ignore */ }
                    const start = Date.now();
                    while (Date.now() - start < this.lockRetryDelay) {}
                } else {
                    throw err;
                }
            }
        }
        return false;
    }

    releaseLock() {
        try {
            if (fs.existsSync(this.lockPath)) {
                fs.unlinkSync(this.lockPath);
            }
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.error(`⚠️  Warning: Failed to release lock: ${message}`);
        }
    }

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

    _getLastHashUnsafe() {
        if (!fs.existsSync(this.logPath)) {
            return '0000000000000000000000000000000000000000000000000000000000000000';
        }
        const lines = fs.readFileSync(this.logPath, 'utf8').split('\n').filter(Boolean);
        if (lines.length === 0) return '0000000000000000000000000000000000000000000000000000000000000000';
        try {
            const lastEntry = JSON.parse(lines[lines.length - 1]);
            return lastEntry.integrity_hash || '0000000000000000000000000000000000000000000000000000000000000000';
        } catch {
            return '0000000000000000000000000000000000000000000000000000000000000000';
        }
    }

    getLastHash() {
        return this.withLock(() => this._getLastHashUnsafe());
    }

    log(event) {
        return this.withLock(() => {
            const entry = {
                '@timestamp': new Date().toISOString(),
                sequence: this._getSequenceNumberUnsafe(),
                prev_hash: this._getLastHashUnsafe(),
                ...event
            };
            const hash = crypto.createHmac('sha256', this.secret).update(JSON.stringify(entry)).digest('hex');
            entry.integrity_hash = hash;
            fs.appendFileSync(this.logPath, JSON.stringify(entry) + '\n');
            return entry;
        });
    }

    _getSequenceNumberUnsafe() {
        if (!fs.existsSync(this.logPath)) return 1;
        const lines = fs.readFileSync(this.logPath, 'utf8').split('\n').filter(Boolean);
        return lines.length + 1;
    }

    verify() {
        if (!fs.existsSync(this.logPath)) {
            // @ts-ignore
            return { valid: true, errors: [], total: 0, message: 'No audit log exists' };
        }
        const lines = fs.readFileSync(this.logPath, 'utf8').split('\n').filter(Boolean);
        const errors = [];
        let prevHash = '0000000000000000000000000000000000000000000000000000000000000000';
        for (let i = 0; i < lines.length; i++) {
            try {
                const entry = JSON.parse(lines[i]);
                const { integrity_hash, ...data } = entry;
                if (entry.prev_hash !== prevHash) {
                    errors.push({ line: i + 1, type: 'chain_broken', message: `Previous hash mismatch.` });
                }
                const expected = crypto.createHmac('sha256', this.secret).update(JSON.stringify(data)).digest('hex');
                if (expected !== integrity_hash) {
                    errors.push({ line: i + 1, type: 'tampered', message: `Integrity hash mismatch.` });
                }
                prevHash = integrity_hash;
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                errors.push({ line: i + 1, type: 'parse_error', message: `Failed to parse JSON: ${message}` });
            }
        }
        return {
            valid: errors.length === 0,
            errors,
            total: lines.length,
            // @ts-ignore
            message: errors.length === 0 ? `✅ All ${lines.length} entries verified successfully` : `❌ ${errors.length} issues found`
        };
    }

    export() {
        if (!fs.existsSync(this.logPath)) return [];
        const lines = fs.readFileSync(this.logPath, 'utf8').split('\n').filter(Boolean);
        return lines.map(line => JSON.parse(line));
    }

    tail(count = 10) {
        const entries = this.export();
        return entries.slice(-count);
    }
}

export default AuditLogger;