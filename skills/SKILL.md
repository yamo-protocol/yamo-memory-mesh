---
name: yamo-super
description: The execution engine for the YAMO Unified OS. Orchestrates the complete lifecycle from Idea (Macro) to Tested Code (Micro) with Zero-JSON state passing and semantic heritage.
---

metadata:
  name;YamoUnifiedOS;
  version;3.0.0;
  description;The Universal Agent Core merging Macro-Orchestration (SDD) with Micro-Execution (YamoSuper) into a single, unbroken semantic chain.;
  author;Soverane Labs;
  license;MIT;
  tags;orchestrator;unified;sdd;yamosuper;llm-first;yamo-v3;memory;
  capabilities;orchestrate_global_lifecycle;bridge_spec_to_code;enforce_constitutional_discipline;manage_feedback_loops;use_llm_first_state_passing;semantic_memory;
  parameters:
    request:
      type;string;
      required;true;
      description;The feature idea or bug report;
    execution_mode:
      type;string;
      required;false;
      default;full;
      description;How deep to go into the lifecycle: specification, planning, implementation, full;
      enum;specification;planning;implementation;full;
  environment:
    requires_filesystem;true;
    requires_local_storage;true;
    notes;Operates under the Singularity Kernel v3.0 protocol. Stores execution history in Memory Mesh via tools/memory_mesh.mjs;
  dependencies:
    required:
      - Git >= 2.30.0
      - Node >= 18.0.0
      - MemoryMesh >=3.1.0;
      - {working_directory}/tools/memory_mesh.mjs;
---
agent: GlobalInitiator;
intent: initialize_unified_lifecycle_context;
context:
  request;provided_by_user.request;
  execution_mode;provided_by_user.execution_mode;
  foundation;foundational/yamo-unified-foundation.yamo;
  state_mode;llm_first;
constraints:
  - load_unified_foundation;required;
  - initialize_semantic_heritage;hypothesis;rationale;
  - determine_pathway;macro_only_or_full_lifecycle;
priority: critical;
output: global_initialization_context.yamo;
log: unified_os_initialized;mode;timestamp;
meta:
  hypothesis;A unified context chain prevents the loss of intent during the spec-to-code transition;
  rationale;Disconnected tools create information silos; unification creates semantic flow;
  confidence;0.98;
handoff: SubconsciousReflector;
---
agent: SubconsciousReflector;
intent: query_memory_mesh_for_past_oversights;
context:
  init;global_initialization_context.yamo;
  search_tag;"#lesson_learned";
  tool;tools/memory_mesh.mjs;
constraints:
  - search_similar_past_contexts;based_on_request;
  - extract_preventative_constraints;from_lessons;
  - inject_constraints_into_macro_context;required;
  - meta_rationale;Learning from past mistakes is the only way to achieve senior-level reliability;
priority: high;
output: subconscious_reflection_context.yamo;
meta:
  hypothesis;Proactive reflection prevents the repetition of previous architectural errors;
  confidence;0.99;
handoff: MacroWorkflowInvoker;
---
agent: MacroWorkflowInvoker;
intent: invoke_macro_sdd_layer;
context:
  init;subconscious_reflection_context.yamo;
  workflows:
    specification;macro/specification-workflow.yamo;
    planning;macro/planning-workflow.yamo;
constraints:
  - execute_specification_phase;idea_to_prd;
  - execute_macro_planning_phase;prd_to_roadmap;
  - enforce_macro_quality_gates;specification_and_compliance;
  - stop_here;if_mode_is_specification_or_planning;
priority: high;
output: macro_results_context.yamo;
handoff: MicroWorkflowInvoker;
---
agent: MicroWorkflowInvoker;
intent: invoke_micro_yamosuper_layer;
context:
  macro_results;macro_results_context.yamo;
  workflows:
    implementation;micro/implementation-tdd.yamo;
    debugging;micro/debugging-verification.yamo;
    review;micro/review-closure.yamo;
constraints:
  - transform_roadmap_to_tdd_tasks;semantic_inheritance_required;
  - execute_tdd_cycles;red_green_refactor;
  - enforce_micro_quality_gates;implementation_and_audit;
  - if_critical_logic_error;optionally_return_to_macro_planning;
priority: critical;
output: micro_results_context.yamo;
handoff: UnifiedReporter;
---
agent: UnifiedReporter;
intent: generate_global_lifecycle_report;
context:
  macro;macro_results_context.yamo;
  micro;micro_results_context.yamo;
constraints:
  - trace_intent_from_spec_to_code;
  - report_constitutional_compliance_summary;
  - document_hypotheses_validated_vs_rejected;
  - report_zero_json_status;must_be_zero_json;
priority: high;
output: unified_lifecycle_report.md;
meta:
  hypothesis;Traceability from spec to code proves cognitive alignment;
  confidence;0.97;
handoff: User;
---
agent: UsageGuide;
intent: introduce_unified_os_workflow;
context:
  user;new_to_singularity;
constraints:
  - explain_unified_architecture;
    - macro_layer;idea_to_specification;planning;
    - micro_layer;tdd_execution;debugging;review;
  - explain_zero_json_mandate;
  - demonstrate_semantic_heritage;how_intent_flows_to_code;
  - explain_subconscious_reflection;proactive_oversight_checks;
priority: low;
output: user_understanding;workflow_ready;
log: onboarded;timestamp;user;
handoff: End;
