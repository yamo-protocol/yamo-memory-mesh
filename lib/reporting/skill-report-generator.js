import { promises as fs } from 'fs';
import path from 'path';

/**
 * Skill Execution Report Generator
 *
 * Generates JSON reports for skill executions, capturing:
 * - Skill metadata (name, version, type)
 * - Execution details (duration, status, provider)
 * - Input/output metrics
 * - Quality indicators
 */
export class SkillReportGenerator {
    constructor(options = {}) {
        this.reportsDir = options.reportsDir || this._getReportsDir();
        this.version = '1.0.0';
    }

    _getReportsDir() {
        // @ts-ignore
        const home = process.env.HOME || process.env.USERPROFILE || process.cwd();
        return path.join(home, '.yamo', 'reports');
    }

    /**
     * Generate a unique report ID
     * @param {string} sessionId - Session identifier
     * @returns {string} Report ID
     */
    _generateReportId(sessionId) {
        const timestamp = Date.now();
        const shortSession = sessionId ? sessionId.substring(0, 8) : 'unknown';
        return `skill_execution_${timestamp}_${shortSession}`;
    }

    /**
     * Extract skill type from file path or name
     * @param {string} skillName - Name of the skill
     * @param {string[]} contextFiles - Context files used
     * @returns {string} Skill type
     */
    _getSkillType(skillName, contextFiles = []) {
        if (skillName === 'LLMClient') return 'direct';

        const skillFile = contextFiles.find(f => f.endsWith('.yamo'));
        if (!skillFile) return 'unknown';

        if (skillFile.includes('utility/')) return 'utility';
        if (skillFile.includes('generator/')) return 'generator';
        if (skillFile.includes('protocol/')) return 'protocol';
        if (skillFile.includes('system-skills/')) return 'system';

        return 'custom';
    }

    /**
     * Parse skill metadata from .yamo file path
     * @param {string[]} contextFiles - Context files
     * @returns {Object} Skill metadata
     */
    _parseSkillMetadata(contextFiles = []) {
        const skillFile = contextFiles.find(f => f.endsWith('.yamo'));
        if (!skillFile) {
            return { version: null, description: null };
        }

        // Return basic info - full parsing would require reading the file
        return {
            version: '1.0.0', // Default version
            file: skillFile
        };
    }

    /**
     * Create a report object from execution data
     * @param {Object} executionData - Data from skill execution
     * @returns {Object} Report object
     */
    createReport(executionData) {
        const {
            skill,
            sessionId,
            duration,
            provider,
            model,
            promptLength,
            responseLength,
            contextFiles = [],
            parameters = {},
            status = 'success',
            error = null,
            artifactsCreated = [],
            memoryCaptured = false
        } = executionData;

        const reportId = this._generateReportId(sessionId);
        const skillMeta = this._parseSkillMetadata(contextFiles);
        const skillType = this._getSkillType(skill, contextFiles);

        return {
            report_id: reportId,
            timestamp: new Date().toISOString(),
            skill: {
                name: skill,
                version: skillMeta.version,
                type: skillType,
                file: skillMeta.file || null
            },
            execution: {
                session_id: sessionId,
                duration_ms: Math.round(duration),
                status,
                error: error ? String(error) : null,
                provider,
                model
            },
            input: {
                prompt_length: promptLength,
                context_files: contextFiles,
                parameters
            },
            output: {
                response_length: responseLength,
                artifacts_created: artifactsCreated,
                tokens_used: null // Could be populated if provider returns token count
            },
            quality: {
                memory_captured: memoryCaptured,
                artifacts_saved: artifactsCreated.length > 0
            },
            meta: {
                generator: 'yamo-skills',
                version: this.version
            }
        };
    }

    /**
     * Generate filename for a report
     * @param {Object} report - Report object
     * @returns {string} Filename
     */
    getReportFilename(report) {
        // Format: skill-{name}_{timestamp}_{ms}.json
        // Include milliseconds for uniqueness when multiple reports per second
        const safeName = report.skill.name.toLowerCase().replace(/[^a-z0-9]/g, '-');
        const timestamp = report.timestamp.replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
        const ms = report.timestamp.slice(20, 23) || '000';
        return `skill-${safeName}_${timestamp}-${ms}.json`;
    }

    /**
     * Ensure reports directory exists
     */
    async _ensureReportsDir() {
        try {
            await fs.mkdir(this.reportsDir, { recursive: true });
        } catch (error) {
            const e = error instanceof Error ? error : new Error(String(error));
            // @ts-ignore
            if (e.code !== 'EEXIST') {
                throw e;
            }
        }
    }

    /**
     * Save a report to disk
     * @param {Object} report - Report object to save
     * @returns {Promise<string>} Path to saved report
     */
    async saveReport(report) {
        await this._ensureReportsDir();

        const filename = this.getReportFilename(report);
        const filepath = path.join(this.reportsDir, filename);

        await fs.writeFile(filepath, JSON.stringify(report, null, 2), 'utf8');

        return filepath;
    }

    /**
     * Generate and save a report in one call
     * @param {Object} executionData - Data from skill execution
     * @returns {Promise<Object>} Report object with filepath
     */
    async generateAndSave(executionData) {
        const report = this.createReport(executionData);
        const filepath = await this.saveReport(report);

        return {
            ...report,
            _filepath: filepath
        };
    }

    /**
     * List recent reports
     * @param {number} limit - Maximum number of reports to return
     * @returns {Promise<string[]>} Array of report filenames
     */
    async listReports(limit = 10) {
        try {
            await this._ensureReportsDir();
            const files = await fs.readdir(this.reportsDir);

            // Filter JSON files and sort by name (descending = newest first)
            const reports = files
                .filter(f => f.endsWith('.json'))
                .sort((a, b) => b.localeCompare(a))
                .slice(0, limit);

            return reports;
        } catch (error) {
            return [];
        }
    }

    /**
     * Read a specific report
     * @param {string} filename - Report filename
     * @returns {Promise<Object|null>} Report object or null
     */
    async readReport(filename) {
        try {
            const filepath = path.join(this.reportsDir, filename);
            const content = await fs.readFile(filepath, 'utf8');
            return JSON.parse(content);
        } catch (error) {
            return null;
        }
    }

    /**
     * Get aggregate statistics from recent reports
     * @param {number} limit - Number of reports to analyze
     * @returns {Promise<Object>} Statistics object
     */
    async getStats(limit = 100) {
        const reportFiles = await this.listReports(limit);
        const stats = {
            total_reports: reportFiles.length,
            skills_used: {},
            providers_used: {},
            success_count: 0,
            error_count: 0,
            total_duration_ms: 0,
            avg_duration_ms: 0
        };

        for (const filename of reportFiles) {
            const report = await this.readReport(filename);
            if (!report) continue;

            // Count skills
            const skillName = report.skill?.name || 'unknown';
            stats.skills_used[skillName] = (stats.skills_used[skillName] || 0) + 1;

            // Count providers
            const provider = report.execution?.provider || 'unknown';
            stats.providers_used[provider] = (stats.providers_used[provider] || 0) + 1;

            // Count success/error
            if (report.execution?.status === 'success') {
                stats.success_count++;
            } else {
                stats.error_count++;
            }

            // Sum duration
            stats.total_duration_ms += report.execution?.duration_ms || 0;
        }

        if (stats.total_reports > 0) {
            stats.avg_duration_ms = Math.round(stats.total_duration_ms / stats.total_reports);
        }

        return stats;
    }
}

export default SkillReportGenerator;