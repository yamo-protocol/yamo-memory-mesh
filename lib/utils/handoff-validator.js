import fs from 'fs';
import path from 'path';

/**
 * Handoff Package Validator
 * Verifies that a handoff package is complete and valid.
 */
class HandoffValidator {
    constructor(packagePath) {
        this.packagePath = packagePath;
        this.requiredFiles = [
            'context.md',
            'memory.json',
            'metadata.json'
        ];
    }

    validate() {
        /** @type {{valid: boolean, errors: string[], warnings: string[], summary: string}} */
        const result = {
            valid: true,
            errors: [],
            warnings: [],
            summary: ''
        };

        if (!fs.existsSync(this.packagePath)) {
            result.valid = false;
            result.errors.push(`Package path not found: ${this.packagePath}`);
            return result;
        }

        // Check required files
        for (const file of this.requiredFiles) {
            const filePath = path.join(this.packagePath, file);
            if (!fs.existsSync(filePath)) {
                result.valid = false;
                result.errors.push(`Missing required file: ${file}`);
            }
        }

        // Validate metadata
        const metadataPath = path.join(this.packagePath, 'metadata.json');
        if (fs.existsSync(metadataPath)) {
            try {
                const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
                if (!metadata.timestamp) result.warnings.push('Metadata missing timestamp');
                if (!metadata.source) result.warnings.push('Metadata missing source');
            } catch (e) {
                result.valid = false;
                result.errors.push('Invalid metadata.json format');
            }
        }

        result.summary = result.valid 
            ? `✅ Package valid with ${result.warnings.length} warnings` 
            : `❌ Package invalid with ${result.errors.length} errors`;

        return result;
    }
}

// CLI usage
if (process.argv[1] === import.meta.url) {
    const pkgPath = process.argv[2] || '.';
    const validator = new HandoffValidator(pkgPath);
    const result = validator.validate();

    if (!result.valid) {
        console.log(result.summary);
        console.log('\n❌ Errors found:');
        result.errors.forEach(err => console.log(`   - ${err}`));
        process.exit(1);
    } else {
        console.log(result.summary);
        console.log('\n✅ Handoff package is valid!');
        
        if (result.warnings.length > 0) {
            console.log('\n⚠️  Warnings:');
            result.warnings.forEach(warn => console.log(`   - ${warn}`));
        }
    }
}

export default HandoffValidator;
