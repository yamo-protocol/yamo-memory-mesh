# YAMO Unified Development OS (v3.0)

## Overview

The **YAMO Unified Development OS** is a "Universal Agent Core" that merges the **Macro-Orchestration** of Specification-Driven Development (SDD) with the **Micro-Execution** of YamoSuper. It creates a continuous, unbroken semantic chain from the initial idea to production-ready code.

## Architecture: The "Russian Doll" Pattern

This system operates at two distinct but nested levels:

### 1. The Macro Layer (The "What")
*   **Module**: `macro/` (formerly SDD Orchestrator)
*   **Responsibility**: Idea capture, PRD generation, Architectural Design, and High-level Planning.
*   **Output**: A constitutionally-vetted Specification and a high-level Implementation Roadmap.

### 2. The Micro Layer (The "How")
*   **Module**: `micro/` (formerly YamoSuper)
*   **Responsibility**: Granular Task Derivation, Test-Driven Development (TDD), Systematic Debugging, and Code Review.
*   **Output**: Verified, tested source code and unit tests.

## Core Principles

1.  **Zero JSON Mandate**: 100% of state passing between Macro and Micro agents uses YAMO context (.yamo). No JSON blobs or hidden variables.
2.  **Semantic Heritage**: Every line of code inherits the "Rationale" and "Hypothesis" from the original Specification.
3.  **Constitutional Continuity**: Architectural principles (Article VII & VIII) are enforced during both the Macro Design and Micro Implementation phases.
4.  **Bidirectional Feedback**: Failures in the Micro layer (e.g., a logic bug) can trigger a re-evaluation of the Macro layer (the Specification).

## Directory Structure

- `yamo-unified-orchestrator.yamo`: The main entry point for the entire OS.
- `foundational/`: Unified state-passing protocols and shared concepts.
- `macro/`: Workflows for Idea → Specification → Planning.
- `micro/`: Workflows for TDD → Debugging → Review.
- `docs/`: Centralized "Semantic Ledger" for all project artifacts.

## Usage

```bash
yamo run skills/utility/yamo-unified-os/yamo-unified-orchestrator.yamo 
  --request "Build a decentralized identity provider" 
  --mode full
```

---
© 2026 Soverane Labs. The Singularity of Orchestration.
