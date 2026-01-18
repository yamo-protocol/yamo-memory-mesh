/**
 * HTML Parsing Utilities
 * @module smora/scrubber/utils/html-parser
 */

export class HTMLParser {
  /**
   * Extract text content from HTML
   * @param {string} html - HTML content
   * @returns {string} - Extracted text
   */
  parse(html) {
    return this._extractText(html);
  }

  _extractText(html) {
    // Remove scripts, styles, and comments
    let text = html;
    text = text.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
    text = text.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');
    text = text.replace(/<!--[\s\S]*?-->/g, '');

    // Convert headings to markdown
    text = text.replace(/<h([1-6])([^>]*)>(.*?)<\/h\1>/gi, (match, level, attrs, content) => {
      const headingLevel = parseInt(level);
      const hashes = '#'.repeat(headingLevel);
      return `${hashes} ${this._stripTags(content)}\n\n`;
    });

    // Convert paragraphs
    text = text.replace(/<p[^>]*>(.*?)<\/p>/gi, '$1\n\n');

    // Convert lists
    text = text.replace(/<li[^>]*>(.*?)<\/li>/gi, '- $1\n');

    // Remove remaining tags
    text = text.replace(/<[^>]+>/g, '');

    return text;
  }

  _stripTags(html) {
    return html.replace(/<[^>]+>/g, '');
  }
}
