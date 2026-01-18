/**
 * FilterBuilder - Fluent API for building LanceDB filter expressions
 * Provides type-safe filter construction for metadata queries
 */

class FilterBuilder {
  /**
   * Create a new FilterBuilder
   */
  constructor() {
    this.filters = [];
    this.operator = 'AND';
  }

  /**
   * Add equality filter
   * @param {string} field - Field name
   * @param {*} value - Value to compare
   * @returns {FilterBuilder} this for chaining
   */
  equals(field, value) {
    this.filters.push(`${field} = ${this._quote(value)}`);
    return this;
  }

  /**
   * Add inequality filter
   * @param {string} field - Field name
   * @param {*} value - Value to compare
   * @returns {FilterBuilder} this for chaining
   */
  notEquals(field, value) {
    this.filters.push(`${field} != ${this._quote(value)}`);
    return this;
  }

  /**
   * Add greater than filter
   * @param {string} field - Field name
   * @param {number} value - Value to compare
   * @returns {FilterBuilder} this for chaining
   */
  gt(field, value) {
    this.filters.push(`${field} > ${value}`);
    return this;
  }

  /**
   * Add greater than or equal filter
   * @param {string} field - Field name
   * @param {number} value - Value to compare
   * @returns {FilterBuilder} this for chaining
   */
  gte(field, value) {
    this.filters.push(`${field} >= ${value}`);
    return this;
  }

  /**
   * Add less than filter
   * @param {string} field - Field name
   * @param {number} value - Value to compare
   * @returns {FilterBuilder} this for chaining
   */
  lt(field, value) {
    this.filters.push(`${field} < ${value}`);
    return this;
  }

  /**
   * Add less than or equal filter
   * @param {string} field - Field name
   * @param {number} value - Value to compare
   * @returns {FilterBuilder} this for chaining
   */
  lte(field, value) {
    this.filters.push(`${field} <= ${value}`);
    return this;
  }

  /**
   * Add contains filter (LIKE)
   * @param {string} field - Field name
   * @param {string} value - Value to search for
   * @returns {FilterBuilder} this for chaining
   */
  contains(field, value) {
    this.filters.push(`${field} LIKE '%${this._escapeLike(value)}%'`);
    return this;
  }

  /**
   * Add starts with filter
   * @param {string} field - Field name
   * @param {string} value - Value to match
   * @returns {FilterBuilder} this for chaining
   */
  startsWith(field, value) {
    this.filters.push(`${field} LIKE '${this._escapeLike(value)}%'`);
    return this;
  }

  /**
   * Add ends with filter
   * @param {string} field - Field name
   * @param {string} value - Value to match
   * @returns {FilterBuilder} this for chaining
   */
  endsWith(field, value) {
    this.filters.push(`${field} LIKE '%${this._escapeLike(value)}'`);
    return this;
  }

  /**
   * Add IN array filter
   * @param {string} field - Field name
   * @param {Array} values - Array of values
   * @returns {FilterBuilder} this for chaining
   */
  in(field, values) {
    if (!Array.isArray(values) || values.length === 0) {
      throw new Error('IN filter requires non-empty array');
    }
    const quoted = values.map(v => this._quote(v)).join(', ');
    this.filters.push(`${field} IN [${quoted}]`);
    return this;
  }

  /**
   * Add NOT IN array filter
   * @param {string} field - Field name
   * @param {Array} values - Array of values
   * @returns {FilterBuilder} this for chaining
   */
  notIn(field, values) {
    if (!Array.isArray(values) || values.length === 0) {
      throw new Error('NOT IN filter requires non-empty array');
    }
    const quoted = values.map(v => this._quote(v)).join(', ');
    this.filters.push(`${field} NOT IN [${quoted}]`);
    return this;
  }

  /**
   * Add range filter (inclusive)
   * @param {string} field - Field name
   * @param {number} min - Minimum value
   * @param {number} max - Maximum value
   * @returns {FilterBuilder} this for chaining
   */
  range(field, min, max) {
    this.filters.push(`${field} >= ${min} AND ${field} <= ${max}`);
    return this;
  }

  /**
   * Add date range filter
   * @param {string} field - Field name
   * @param {string|Date} startDate - Start date
   * @param {string|Date} endDate - End date
   * @returns {FilterBuilder} this for chaining
   */
  dateRange(field, startDate, endDate) {
    const start = startDate instanceof Date ? startDate.toISOString() : startDate;
    const end = endDate instanceof Date ? endDate.toISOString() : endDate;
    this.filters.push(`${field} >= '${start}' AND ${field} <= '${end}'`);
    return this;
  }

  /**
   * Add nested metadata filter
   * @param {string} field - Metadata field name
   * @param {*} value - Value to compare
   * @returns {FilterBuilder} this for chaining
   */
  metadata(field, value) {
    this.filters.push(`metadata.${field} = ${this._quote(value)}`);
    return this;
  }

  /**
   * Combine filters with AND
   * @returns {FilterBuilder} this for chaining
   */
  and() {
    this.operator = 'AND';
    return this;
  }

  /**
   * Combine filters with OR
   * @returns {FilterBuilder} this for chaining
   */
  or() {
    this.operator = 'OR';
    return this;
  }

  /**
   * Build and return the filter string
   * @returns {string} Filter expression
   */
  build() {
    if (this.filters.length === 0) {
      return '';
    }

    return this.filters.join(` ${this.operator} `);
  }

  /**
   * Check if builder has any filters
   * @returns {boolean} True if filters exist
   */
  hasFilters() {
    return this.filters.length > 0;
  }

  /**
   * Get filter count
   * @returns {number} Number of filters
   */
  count() {
    return this.filters.length;
  }

  /**
   * Reset all filters
   * @returns {FilterBuilder} this for chaining
   */
  reset() {
    this.filters = [];
    this.operator = 'AND';
    return this;
  }

  /**
   * Quote string values for SQL
   * @private
   * @param {*} value - Value to quote
   * @returns {string} Quoted value
   */
  _quote(value) {
    if (typeof value === 'string') {
      return `'${value.replace(/'/g, "''")}'`;
    }
    if (value === null) {
      return 'NULL';
    }
    if (typeof value === 'boolean') {
      return value ? 'true' : 'false';
    }
    return String(value);
  }

  /**
   * Escape special LIKE characters
   * @private
   * @param {string} value - Value to escape
   * @returns {string} Escaped value
   */
  _escapeLike(value) {
    return value.replace(/'/g, "''").replace(/%/g, '\\%').replace(/_/g, '\\_');
  }

  /**
   * Create a new builder instance
   * @returns {FilterBuilder} New builder
   */
  static create() {
    return new FilterBuilder();
  }
}

export default FilterBuilder;
