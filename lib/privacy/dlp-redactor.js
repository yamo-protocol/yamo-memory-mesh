import { fileURLToPath } from 'url';
import fs from "fs";
import path from "path";

/**
 * DLP (Data Loss Prevention) Redactor
 * Scans text for sensitive information and replaces with tokens
 */
class DLPRedactor {
    constructor(patternsPath = null) {
        // Load patterns
        const defaultPath = path.join(__dirname, '..', 'system-skills', 'privacy', 'dlp_patterns.json');
        const patternFile = patternsPath || defaultPath;

        if (!fs.existsSync(patternFile)) {
            console.warn('⚠️  DLP patterns file not found, using minimal defaults');
            this.patterns = this.getMinimalPatterns();
        } else {
            this.patterns = JSON.parse(fs.readFileSync(patternFile, 'utf8'));
        }

        this.counters = {};
        this.redactionMap = {};
    }

    /**
     * Minimal fallback patterns if file not found
     */
    getMinimalPatterns() {
        return {
            pii: {
                email: { pattern: '\\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Z|a-z]{2,}\\b', token_prefix: 'EMAIL' }
            },
            secrets: {
                generic_api_key: {
                    pattern: '(?:api[_-]?key)[\\s:=]+[\'"]?([a-zA-Z0-9_\\-\\.]{20,})[\'"]?',
                    token_prefix: 'API_KEY',
                    case_insensitive: true
                }
            },
            internal_assets: {}
        };
    }

    /**
     * Redact sensitive information from text
     * @param {string} text - Input text to scan
     * @param {string} privacyLevel - 'low', 'medium', 'high' (default: medium)
     * @returns {{sanitized: string, redactionMap: Object, findings: Array}}
     */
    redact(text, privacyLevel = 'medium') {
        if (!text) return { sanitized: '', redactionMap: {}, findings: [] };

        let sanitized = text;
        const findings = [];
        this.counters = {};
        this.redactionMap = {};

        // Determine which categories to scan based on privacy level
        const categoriesToScan = this.getCategoriesToScan(privacyLevel);

        // Scan each category
        for (const category of categoriesToScan) {
            if (!this.patterns[category]) continue;

            for (const [name, config] of Object.entries(this.patterns[category])) {
                try {
                    // Use 'gi' flags if pattern is case-insensitive, otherwise just 'g'
                    const flags = config.case_insensitive ? 'gi' : 'g';
                    const regex = new RegExp(config.pattern, flags);
                    const matches = [...sanitized.matchAll(regex)];

                    for (const match of matches) {
                        const originalValue = match[1] || match[0]; // Use capture group if exists

                        // Skip if already redacted
                        if (originalValue.startsWith('<') && originalValue.endsWith('>')) {
                            continue;
                        }

                        // Generate token
                        const counter = (this.counters[config.token_prefix] || 0) + 1;
                        this.counters[config.token_prefix] = counter;
                        const token = `<${config.token_prefix}_${counter}>`;

                        // Store mapping for rehydration
                        this.redactionMap[token] = originalValue;

                        // Replace in text
                        sanitized = sanitized.replace(originalValue, token);

                        // Record finding
                        findings.push({
                            type: name,
                            category: category,
                            token: token,
                            position: match.index,
                            length: originalValue.length
                        });
                    }
                } catch (error) {
                    console.error(`⚠️  DLP pattern error for ${name}:`, error.message);
                }
            }
        }

        return {
            sanitized,
            redactionMap: this.redactionMap,
            findings,
            stats: {
                original_length: text.length,
                sanitized_length: sanitized.length,
                redactions: findings.length,
                privacy_level: privacyLevel
            }
        };
    }

    /**
     * Restore redacted information
     * @param {string} text - Text with redaction tokens
     * @param {Object} redactionMap - Map of tokens to original values
     * @returns {string} - Rehydrated text
     */
    rehydrate(text, redactionMap = null) {
        if (!text) return '';

        const map = redactionMap || this.redactionMap;
        let rehydrated = text;

        for (const [token, originalValue] of Object.entries(map)) {
            rehydrated = rehydrated.replaceAll(token, originalValue);
        }

        return rehydrated;
    }

    /**
     * Determine which pattern categories to use based on privacy level
     */
    getCategoriesToScan(privacyLevel) {
        switch (privacyLevel) {
            case 'low':
                // Only redact high-risk secrets
                return ['secrets'];
            case 'high':
                // Redact everything including internal assets
                return ['pii', 'secrets', 'internal_assets'];
            case 'medium':
            default:
                // Redact PII and secrets, but allow internal assets
                return ['pii', 'secrets'];
        }
    }

    /**
     * Validate that text doesn't contain obvious secrets
     * Useful for pre-upload checks
     */
    containsSecrets(text) {
        if (!this.patterns.secrets) return false;

        for (const [name, config] of Object.entries(this.patterns.secrets)) {
            // Use 'gi' flags if pattern is case-insensitive, otherwise just 'g'
            const flags = config.case_insensitive ? 'gi' : 'g';
            const regex = new RegExp(config.pattern, flags);
            if (regex.test(text)) {
                return { found: true, type: name };
            }
        }

        return { found: false };
    }

    /**
     * Generate SIEM-compliant audit log for redaction event
     */
    generateAuditLog(result, metadata = {}) {
        return {
            '@timestamp': new Date().toISOString(),
            event: {
                kind: 'event',
                category: 'process',
                type: 'info',
                action: 'dlp_redaction'
            },
            dlp: {
                findings_count: result.findings.length,
                privacy_level: result.stats.privacy_level,
                categories: [...new Set(result.findings.map(f => f.category))],
                types: result.findings.map(f => f.type)
            },
            user: metadata.user_id || 'unknown',
            source: {
                bytes: result.stats.original_length
            },
            destination: {
                bytes: result.stats.sanitized_length
            },
            message: `DLP scan completed: ${result.findings.length} findings redacted`
        };
    }
}

// Example usage
if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const redactor = new DLPRedactor();

    const testText = `
    Contact John Doe at john.doe@company.com or call (555) 123-4567.
    API Key: sk-abc123testkeyEXAMP
    AWS Key: AKIAIOSFODNN7EXAM
    Database: postgres://admin:secret123@10.0.1.5:5432/mydb
    Credit Card: 4532-1234-5678-9010
    `;

    console.log('🔍 Testing DLP Redactor\n');
    console.log('Original:', testText);

    const result = redactor.redact(testText, 'high');

    console.log('\n✅ Sanitized:', result.sanitized);
    console.log('\n📊 Stats:', result.stats);
    console.log('\n🔍 Findings:', result.findings);

    const rehydrated = redactor.rehydrate(result.sanitized, result.redactionMap);
    console.log('\n♻️  Rehydrated:', rehydrated);

    const auditLog = redactor.generateAuditLog(result, { user_id: 'test_user' });
    console.log('\n📝 Audit Log:', JSON.stringify(auditLog, null, 2));
}

export default DLPRedactor;
