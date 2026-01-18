/**
 * Spinner and Progress Indicators
 */

import { fileURLToPath } from 'url';

class Spinner {
    constructor(text = 'Loading...', options = {}) {
        this.text = text;
        // @ts-ignore
        this.frames = options.frames || ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
        // @ts-ignore
        this.interval = options.interval || 80;
        // @ts-ignore
        this.stream = options.stream || process.stderr;
        // @ts-ignore
        this.color = options.color || '\x1b[36m';
        this.frameIndex = 0;
        this.timer = null;
        this.isSpinning = false;
    }

    start() {
        if (this.isSpinning) return this;
        this.isSpinning = true;
        this.frameIndex = 0;
        this.stream.write('\x1B[?25l');
        this.timer = setInterval(() => {
            const frame = this.frames[this.frameIndex];
            this.stream.write(`\r${this.color}${frame}\x1b[0m ${this.text}`);
            this.frameIndex = (this.frameIndex + 1) % this.frames.length;
        }, this.interval);
        return this;
    }

    update(text) {
        this.text = text;
        return this;
    }

    succeed(text) {
        return this.stop('\x1b[32m✔\x1b[0m', text);
    }

    fail(text) {
        return this.stop('\x1b[31m✖\x1b[0m', text);
    }

    warn(text) {
        return this.stop('\x1b[33m⚠\x1b[0m', text);
    }

    info(text) {
        return this.stop('\x1b[36mℹ\x1b[0m', text);
    }

    /**
     * @param {string|null} symbol
     * @param {string|null} text
     */
    stop(symbol = null, text = null) {
        if (!this.isSpinning) return this;
        if (this.timer) {
            // @ts-ignore
            clearInterval(this.timer);
        }
        this.isSpinning = false;
        this.stream.write('\r\x1b[K');
        this.stream.write('\x1B[?25h');
        if (symbol && text) {
            this.stream.write(`${symbol} ${text}\n`);
        } else if (text) {
            this.stream.write(`${text}\n`);
        }
        return this;
    }

    clear() {
        if (!this.isSpinning) return this;
        if (this.timer) {
            // @ts-ignore
            clearInterval(this.timer);
        }
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
        // @ts-ignore
        this.width = options.width || 40;
        // @ts-ignore
        this.stream = options.stream || process.stderr;
        // @ts-ignore
        this.format = options.format || ':bar :percent :current/:total';
        // @ts-ignore
        this.complete = options.complete || '█';
        // @ts-ignore
        this.incomplete = options.incomplete || '░';
        // @ts-ignore
        this.renderThrottle = options.renderThrottle || 16;
        this.lastRender = 0;
    }

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

    render() {
        const percent = Math.floor((this.current / this.total) * 100);
        const completeLength = Math.floor(this.width * (this.current / this.total));
        const incompleteLength = this.width - completeLength;
        const bar = this.complete.repeat(completeLength) + this.incomplete.repeat(incompleteLength);
        // @ts-ignore
        let output = this.format.replace(':bar', bar).replace(':percent', `${percent}%`).replace(':current', String(this.current)).replace(':total', String(this.total));
        this.stream.write(`\r${output}`);
        if (this.current >= this.total) {
            this.stream.write('\n');
        }
        return this;
    }

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

    add(key, text, status = 'pending') {
        this.spinners.set(key, { text, status, startTime: Date.now() });
        this.render();
        return this;
    }

    update(key, status, text = null) {
        const spinner = this.spinners.get(key);
        if (spinner) {
            spinner.status = status;
            if (text) spinner.text = text;
            this.render();
        }
        return this;
    }

    succeed(key, text) { return this.update(key, 'success', text); }
    fail(key, text) { return this.update(key, 'fail', text); }
    warn(key, text) { return this.update(key, 'warn', text); }

    render() {
        this.stream.write('\r\x1b[K');
        const lines = [];
        for (const [key, spinner] of this.spinners) {
            // @ts-ignore
            const symbol = { pending: '\x1b[36m⋯\x1b[0m', success: '\x1b[32m✔\x1b[0m', fail: '\x1b[31m✖\x1b[0m', warn: '\x1b[33m⚠\x1b[0m' }[spinner.status];
            const duration = ((Date.now() - spinner.startTime) / 1000).toFixed(1);
            lines.push(`${symbol} ${spinner.text} (${duration}s)`);
        }
        this.stream.write(lines.join('\n'));
        if (lines.length > 1) {
            this.stream.write(`\x1b[${lines.length - 1}A`);
        }
        return this;
    }

    done() {
        this.stream.write('\n'.repeat(this.spinners.size));
        return this;
    }
}

export { Spinner, ProgressBar, MultiSpinner };
