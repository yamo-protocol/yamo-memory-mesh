import { fileURLToPath } from 'url';
import fs from "fs";
import path from "path";

/**
 * Handoff Chain Validator
 * Validates that all agent handoffs point to valid targets
 */
class HandoffValidator {
    constructor() {
        this.errors = [];
        this.warnings = [];
    }

    /**
     * Validate a YAMO skill's handoff chain
     * @param {Object} skill - Parsed YAMO skill structure
     * @returns {{valid: boolean, errors: Array, warnings: Array}}
     */
    validate(skill) {
        this.errors = [];
        this.warnings = [];

        if (!skill.agents || !Array.isArray(skill.agents)) {
            this.errors.push({
                type: 'missing_agents',
                message: 'Skill has no agents array'
            });
            return this.getResult();
        }

        // Extract agent names
        const agentNames = skill.agents.map(a => a.name);

        // Check for duplicate agent names
        const duplicates = this.findDuplicates(agentNames);
        if (duplicates.length > 0) {
            this.errors.push({
                type: 'duplicate_agents',
                message: `Duplicate agent names: ${duplicates.join(', ')}`
            });
        }

        // Validate each agent's handoff
        for (const agent of skill.agents) {
            this.validateAgentHandoff(agent, agentNames);
        }

        // Check for unreachable agents
        this.checkUnreachableAgents(skill.agents);

        // Check for infinite loops
        this.checkInfiniteLoops(skill.agents);

        return this.getResult();
    }

    /**
     * Validate a single agent's handoff
     */
    validateAgentHandoff(agent, validAgentNames) {
        if (!agent.name) {
            this.errors.push({
                type: 'missing_name',
                agent: 'unknown',
                message: 'Agent missing name field'
            });
            return;
        }

        if (!agent.handoff) {
            this.errors.push({
                type: 'missing_handoff',
                agent: agent.name,
                message: `Agent "${agent.name}" has no handoff field`
            });
            return;
        }

        const handoff = agent.handoff;

        // Valid terminal handoffs
        const terminalHandoffs = ['End', 'User', 'Error'];
        if (terminalHandoffs.includes(handoff)) {
            return; // Valid terminal
        }

        // Dynamic handoff (runtime determined)
        if (handoff === 'Dynamic') {
            this.warnings.push({
                type: 'dynamic_handoff',
                agent: agent.name,
                message: `Agent "${agent.name}" uses Dynamic handoff - cannot validate at design time`
            });
            return;
        }

        // Check if handoff target exists
        if (!validAgentNames.includes(handoff)) {
            this.errors.push({
                type: 'invalid_handoff',
                agent: agent.name,
                target: handoff,
                message: `Agent "${agent.name}" hands off to non-existent agent "${handoff}"`
            });
        }

        // Check for self-handoff (usually an error)
        if (handoff === agent.name) {
            this.errors.push({
                type: 'self_handoff',
                agent: agent.name,
                message: `Agent "${agent.name}" hands off to itself (infinite loop)`
            });
        }
    }

    /**
     * Check for unreachable agents (no incoming handoffs)
     */
    checkUnreachableAgents(agents) {
        if (agents.length === 0) return;

        // First agent is always the entry point (SkillEntry or similar)
        const entryPoint = agents[0].name;

        // Collect all handoff targets
        const reachableAgents = new Set([entryPoint]);
        const queue = [entryPoint];

        while (queue.length > 0) {
            const current = queue.shift();
            const agent = agents.find(a => a.name === current);

            if (agent && agent.handoff) {
                const target = agent.handoff;
                if (!['End', 'User', 'Error', 'Dynamic'].includes(target) && !reachableAgents.has(target)) {
                    reachableAgents.add(target);
                    queue.push(target);
                }
            }
        }

        // Find unreachable agents
        for (const agent of agents) {
            if (!reachableAgents.has(agent.name)) {
                this.warnings.push({
                    type: 'unreachable_agent',
                    agent: agent.name,
                    message: `Agent "${agent.name}" is unreachable from entry point "${entryPoint}"`
                });
            }
        }
    }

    /**
     * Check for infinite loops in handoff chain
     */
    checkInfiniteLoops(agents) {
        for (const agent of agents) {
            const visited = new Set();
            let current = agent.name;

            while (current) {
                if (visited.has(current)) {
                    // Found a cycle
                    this.errors.push({
                        type: 'infinite_loop',
                        agent: agent.name,
                        cycle: Array.from(visited).concat([current]),
                        message: `Infinite loop detected: ${Array.from(visited).join(' → ')} → ${current}`
                    });
                    break;
                }

                visited.add(current);

                // Find next agent
                const nextAgent = agents.find(a => a.name === current);
                if (!nextAgent) break;

                const handoff = nextAgent.handoff;

                // Terminal conditions
                if (['End', 'User', 'Error', 'Dynamic'].includes(handoff)) {
                    break;
                }

                current = handoff;
            }
        }
    }

    /**
     * Find duplicate values in array
     */
    findDuplicates(arr) {
        const seen = new Set();
        const duplicates = new Set();

        for (const item of arr) {
            if (seen.has(item)) {
                duplicates.add(item);
            }
            seen.add(item);
        }

        return Array.from(duplicates);
    }

    /**
     * Get validation result
     */
    getResult() {
        return {
            valid: this.errors.length === 0,
            errors: this.errors,
            warnings: this.warnings,
            summary: this.errors.length === 0
                ? `✅ Handoff chain valid${this.warnings.length > 0 ? ` (${this.warnings.length} warnings)` : ''}`
                : `❌ ${this.errors.length} errors, ${this.warnings.length} warnings`
        };
    }

    /**
     * Validate a YAMO file from disk
     */
    validateFile(yamoPath) {
        if (!fs.existsSync(yamoPath)) {
            return {
                valid: false,
                errors: [{ type: 'file_not_found', message: `File not found: ${yamoPath}` }],
                warnings: []
            };
        }

        const content = fs.readFileSync(yamoPath, 'utf8');
        const skill = this.parseYAMO(content);

        if (!skill) {
            return {
                valid: false,
                errors: [{ type: 'parse_error', message: 'Failed to parse YAMO file' }],
                warnings: []
            };
        }

        return this.validate(skill);
    }

    /**
     * Simple YAMO parser (for validation purposes)
     */
    parseYAMO(content) {
        const agents = [];
        const agentBlocks = content.split(/---+/).slice(1); // Skip metadata

        for (const block of agentBlocks) {
            const agentMatch = block.match(/agent:\s*([^;]+);/);
            const handoffMatch = block.match(/handoff:\s*([^;]+);/);

            if (agentMatch) {
                agents.push({
                    name: agentMatch[1].trim(),
                    handoff: handoffMatch ? handoffMatch[1].trim() : null
                });
            }
        }

        return { agents };
    }

    /**
     * Generate a visual representation of the handoff chain
     */
    visualize(skill) {
        if (!skill.agents) return '';

        let output = '📊 Handoff Chain Visualization:\n\n';

        for (const agent of skill.agents) {
            const handoff = agent.handoff || 'MISSING';
            const symbol = this.getHandoffSymbol(handoff);
            output += `  ${agent.name} ${symbol} ${handoff}\n`;
        }

        return output;
    }

    /**
     * Get symbol for handoff type
     */
    getHandoffSymbol(handoff) {
        if (handoff === 'End') return '🏁';
        if (handoff === 'User') return '👤';
        if (handoff === 'Error') return '⚠️ ';
        if (handoff === 'Dynamic') return '🔀';
        return '→';
    }
}

// CLI usage
if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const validator = new HandoffValidator();
    const skillPath = process.argv[2];

    if (!skillPath) {
        console.log('Usage: node handoff_validator.js <path-to-skill.yamo>');
        console.log('Example: node handoff_validator.js ../system-skills/llm/skill-llm-client.yamo');
        process.exit(1);
    }

    console.log(`🔍 Validating: ${skillPath}\n`);

    const result = validator.validateFile(skillPath);

    console.log(result.summary);
    console.log();

    if (result.errors.length > 0) {
        console.log('❌ Errors:');
        result.errors.forEach(err => {
            console.log(`   [${err.type}] ${err.message}`);
        });
        console.log();
    }

    if (result.warnings.length > 0) {
        console.log('⚠️  Warnings:');
        result.warnings.forEach(warn => {
            console.log(`   [${warn.type}] ${warn.message}`);
        });
        console.log();
    }

    // Show visualization
    const content = fs.readFileSync(skillPath, 'utf8');
    const skill = validator.parseYAMO(content);
    console.log(validator.visualize(skill));

    process.exit(result.valid ? 0 : 1);
}

export default HandoffValidator;
