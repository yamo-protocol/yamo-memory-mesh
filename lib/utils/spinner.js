/**
 * Spinner and Progress Indicators
 * Provides visual feedback for long-running operations
 */

import { fileURLToPath } from 'url';

class Spinner {
    constructor(text = 'Loading...', options = {}) {
        this.text = text;
        this.frames = options.frames || ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
        this.interval = options.interval || 80;
        this.stream = options.stream || process.stderr;
        this.color = options.color || '\x1b[36m'; // Cyan
        this.frameIndex = 0;
        this.timer = null;
        this.isSpinning = false;
    }

    /**
     * Start the spinner
     */
    start() {
        if (this.isSpinning) return this;

        this.isSpinning = true;
        this.frameIndex = 0;

        // Hide cursor
        this.stream.write('\x1B[?25l');

        this.timer = setInterval(() => {
            const frame = this.frames[this.frameIndex];
            this.stream.write(`\r${this.color}${frame}\x1b[0m ${this.text}`);
            this.frameIndex = (this.frameIndex + 1) % this.frames.length;
        }, this.interval);

        return this;
    }

    /**
     * Update spinner text
     */
    update(text) {
        this.text = text;
        return this;
    }

    /**
     * Stop with success message
     */
    succeed(text) {
        return this.stop('\x1b[32m✔\x1b[0m', text);
    }

    /**
     * Stop with failure message
     */
    fail(text) {
        return this.stop('\x1b[31m✖\x1b[0m', text);
    }

    /**
     * Stop with warning message
     */
    warn(text) {
        return this.stop('\x1b[33m⚠\x1b[0m', text);
    }

    /**
     * Stop with info message
     */
    info(text) {
        return this.stop('\x1b[36mℹ\x1b[0m', text);
    }

    /**
     * Stop the spinner
     */
    stop(symbol, text) {
        if (!this.isSpinning) return this;

        clearInterval(this.timer);
        this.isSpinning = false;

        // Clear current line
        this.stream.write('\r\x1b[K');

        // Show cursor
        this.stream.write('\x1B[?25h');

        if (symbol && text) {
            this.stream.write(`${symbol} ${text}\n`);
        } else if (text) {
            this.stream.write(`${text}\n`);
        }

        return this;
    }

    /**
     * Clear the spinner without message
     */
    clear() {
        if (!this.isSpinning) return this;

        clearInterval(this.timer);
        this.isSpinning = false;

        this.stream.write('\r\x1b[K');
        this.stream.write('\x1B[?25h');

        return this;
    }
}

class ProgressBar {
    constructor(total, options = {}) {
        this.total = total;
        this.current = 0;
        this.width = options.width || 40;
        this.stream = options.stream || process.stderr;
        this.format = options.format || ':bar :percent :current/:total';
        this.complete = options.complete || '█';
        this.incomplete = options.incomplete || '░';
        this.renderThrottle = options.renderThrottle || 16; // ~60fps
        this.lastRender = 0;
    }

    /**
     * Update progress
     */
    tick(amount = 1) {
        this.current = Math.min(this.current + amount, this.total);

        const now = Date.now();
        if (now - this.lastRender < this.renderThrottle && this.current < this.total) {
            return this;
        }
        this.lastRender = now;

        this.render();
        return this;
    }

    /**
     * Render the progress bar
     */
    render() {
        const percent = Math.floor((this.current / this.total) * 100);
        const completeLength = Math.floor(this.width * (this.current / this.total));
        const incompleteLength = this.width - completeLength;

        const bar = this.complete.repeat(completeLength) + this.incomplete.repeat(incompleteLength);

        let output = this.format
            .replace(':bar', bar)
            .replace(':percent', `${percent}%`)
            .replace(':current', this.current)
            .replace(':total', this.total);

        this.stream.write(`\r${output}`);

        if (this.current >= this.total) {
            this.stream.write('\n');
        }

        return this;
    }

    /**
     * Update with custom current value
     */
    update(current) {
        this.current = Math.min(current, this.total);
        this.render();
        return this;
    }
}

class MultiSpinner {
    constructor() {
        this.spinners = new Map();
        this.stream = process.stderr;
    }

    /**
     * Add a spinner
     */
    add(key, text, status = 'pending') {
        this.spinners.set(key, {
            text,
            status,  // pending, success, fail, warn
            startTime: Date.now()
        });
        this.render();
        return this;
    }

    /**
     * Update spinner status
     */
    update(key, status, text) {
        const spinner = this.spinners.get(key);
        if (spinner) {
            spinner.status = status;
            if (text) spinner.text = text;
            this.render();
        }
        return this;
    }

    /**
     * Mark as success
     */
    succeed(key, text) {
        return this.update(key, 'success', text);
    }

    /**
     * Mark as failed
     */
    fail(key, text) {
        return this.update(key, 'fail', text);
    }

    /**
     * Mark as warning
     */
    warn(key, text) {
        return this.update(key, 'warn', text);
    }

    /**
     * Render all spinners
     */
    render() {
        // Clear previous output
        this.stream.write('\r\x1b[K');

        const lines = [];
        for (const [key, spinner] of this.spinners) {
            const symbol = {
                pending: '\x1b[36m⋯\x1b[0m',
                success: '\x1b[32m✔\x1b[0m',
                fail: '\x1b[31m✖\x1b[0m',
                warn: '\x1b[33m⚠\x1b[0m'
            }[spinner.status];

            const duration = ((Date.now() - spinner.startTime) / 1000).toFixed(1);
            lines.push(`${symbol} ${spinner.text} (${duration}s)`);
        }

        this.stream.write(lines.join('\n'));

        // Move cursor back up
        if (lines.length > 1) {
            this.stream.write(`\x1b[${lines.length - 1}A`);
        }

        return this;
    }

    /**
     * Complete and clear
     */
    done() {
        this.stream.write('\n'.repeat(this.spinners.size));
        return this;
    }
}

// CLI demo
if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const demo = process.argv[2] || 'spinner';

    if (demo === 'spinner') {
        console.log('🎨 Spinner Demo\n');

        const spinner = new Spinner('Loading data...');
        spinner.start();

        setTimeout(() => {
            spinner.update('Processing data...');
        }, 1500);

        setTimeout(() => {
            spinner.update('Finalizing...');
        }, 3000);

        setTimeout(() => {
            spinner.succeed('Data loaded successfully!');
        }, 4000);

    } else if (demo === 'progress') {
        console.log('🎨 Progress Bar Demo\n');

        const progress = new ProgressBar(100, {
            format: 'Progress [:bar] :percent :current/:total'
        });

        const interval = setInterval(() => {
            progress.tick();
            if (progress.current >= progress.total) {
                clearInterval(interval);
                console.log('✅ Complete!');
            }
        }, 50);

    } else if (demo === 'multi') {
        console.log('🎨 Multi-Spinner Demo\n');

        const multi = new MultiSpinner();

        multi.add('task1', 'Loading config...');
        multi.add('task2', 'Connecting to database...');
        multi.add('task3', 'Fetching data...');

        setTimeout(() => multi.succeed('task1', 'Config loaded'), 1000);
        setTimeout(() => multi.fail('task2', 'Database connection failed'), 2000);
        setTimeout(() => multi.succeed('task3', 'Data fetched'), 3000);
        setTimeout(() => multi.done(), 3500);

    } else {
        console.log('Spinner and Progress Bar Utilities');
        console.log('Usage:');
        console.log('  node spinner.js spinner   - Demo spinner');
        console.log('  node spinner.js progress  - Demo progress bar');
        console.log('  node spinner.js multi     - Demo multi-spinner');
    }
}

export { Spinner, ProgressBar, MultiSpinner };
