---
name: yamo-super
description: YamoSuper is a comprehensive AI coding workflow system that orchestrates the complete software development lifecycle through specialized agents managing brainstorming, git worktree isolation, implementation planning, dual execution modes (fresh-subagent-per-task with two-stage review or batch with checkpoints), strict test-driven development, systematic debugging, and pre-merge quality gates—all designed to enable autonomous execution while maintaining human oversight and enforcing YAGNI/DRY best practices.
---

For all code improvement or creation tasks, strictly adhere to the logic, agents, and constraints defined in this Yamo Skill:

metadata:
  name;YamoSuper;
  version;2.0.0;
  description;Comprehensive AI coding workflow system consolidating test-driven development, systematic debugging, collaborative planning, and proven software engineering patterns with persistent memory of past workflows;
  author;Derived from Superpowers by Jesse Scott;adapted for YAMO by Soverane Labs;
  license;MIT;
  tags;tdd;debugging;collaboration;planning;workflow;subagent;git;review;memory;
  capabilities;brainstorm_design;write_implementation_plan;execute_plan_batch;test_driven_development;systematic_debugging;verification;code_review;git_worktree;subagent_driven;parallel_dispatch;retrieve_workflow_patterns;store_execution_history;
  parameters:
    workflow_mode:
      type;string;
      required;false;
      description;Mode: brainstorm, plan, execute, debug, review;
      enum;brainstorm;plan;execute;debug;review;
    dry_run:
      type;boolean;
      required;false;
      description;Preview actions without executing;
    memory_enabled:
      type;boolean;
      required;false;
      default;true;
      description;Enable storing and retrieving workflow execution patterns from Memory Mesh;
  environment:
    requires_filesystem;true;
    requires_local_storage;true;
    notes;Creates worktrees, writes plans, manages git workflows, and stores execution history in Memory Mesh;
  dependencies:
    required:
      - Git >= 2.30.0
      - Node >= 18.0.0 (for npm test commands)
      - MemoryMesh >=1.0.0;
    optional:
      - YamoChainClient (for blockchain anchoring)
---
agent: WorkflowOrchestrator;
intent: determine_workflow_entry_point;
context:
  user_request;raw_input;
  project_state;current_git_status;recent_commits;file_tree;
  available_modes;brainstorm;plan;execute;debug;review;
  memory_script;tools/memory_mesh.js;
  memory_enabled;provided_by_user.memory_enabled;
constraints:
  - check_if_creative_work_requested;trigger_brainstorming_agent;
  - check_if_spec_exists;trigger_planning_agent;
  - check_if_plan_exists;trigger_execution_agent;
  - check_if_bug_reported;trigger_debugging_agent;
  - check_if_review_requested;trigger_review_agent;
  - default_to_brainstorming_if_uncertain;
  - announce_active_workflow_to_user;
  - retrieve_similar_past_workflows;
priority: critical;
output: workflow_decision.json;
log: workflow_determined;timestamp;mode_selected;
meta:
  hypothesis;Clear workflow entry point prevents context confusion;
  rationale;Different development phases require distinct mindsets and tools;
handoff: BrainstormingAgent;
---
agent: BrainstormingAgent;
intent: refine_ideas_through_socratic_dialogue;
context:
  project_state;from_WorkflowOrchestrator;
  user_idea;raw_request;
constraints:
  - check_project_context_first;files;docs;recent_commits;
  - ask_questions_one_at_a_time;
  - prefer_multiple_choice_when_possible;
  - focus_understanding;purpose;constraints;success_criteria;
  - propose_2_3_alternatives_with_tradeoffs;
  - present_design_in_sections_200_300_words;
  - validate_after_each_section;
  - cover;architecture;components;data_flow;error_handling;testing;
  - apply_yagni_ruthlessly;
priority: high;
output: validated_design.md;
log: design_validated;timestamp;sections_reviewed;
meta:
  hypothesis;Incremental validation produces better designs;
  rationale;Large designs overwhelm;section-by-section enables feedback;
handoff: DocumentationAgent;
---
agent: DocumentationAgent;
intent: persist_and_commit_design;
context:
  design;from_BrainstormingAgent;
  destination;docs/plans/YYYY-MM-DD-<topic>-design.md;
constraints:
  - use_clear_concise_writing;
  - commit_to_git_with_descriptive_message;
  - tag_commit_with_design_reviewed;
  - ask_ready_for_implementation;
priority: medium;
output: design_file_path;commit_sha;
log: design_documented;timestamp;file_path;commit_sha;
meta:
  hypothesis;Documented designs enable better implementation;
  rationale;Written specs prevent drift during coding;
handoff: WorktreeAgent;
---
agent: WorktreeAgent;
intent: create_isolated_development_workspace;
context:
  design;from_DocumentationAgent;
  base_branch;main_or_master;
constraints:
  - create_git_worktree_at;.git/worktrees/<feature-name>;
  - checkout_new_branch_feature/<name>;
  - run_project_setup;npm_install;npm_run_build;
  - verify_clean_test_baseline;npm_test;
  - document_worktree_location;
priority: high;
output: worktree_path;branch_name;
log: workspace_created;timestamp;path;branch;
meta:
  hypothesis;Isolated worktrees prevent main branch pollution;
  rationale;Clean branches enable easy rollback and parallel development;
handoff: PlanningAgent;
---
agent: PlanningAgent;
intent: create_detailed_implementation_plan;
context:
  design;from_DocumentationAgent;
  worktree_path;from_WorktreeAgent;
  assumptions;
    engineer_has_zero_codebase_context;
    engineer_has_questionable_taste;
    engineer_needs_explicit_instructions;
constraints:
  - break_into_bite_sized_tasks;2_5_minutes_each;
  - each_task_one_action;write_test;run_test;implement;verify;commit;
  - specify_exact_file_paths;
  - include_complete_code_not_hints;
  - include_exact_commands_with_expected_output;
  - reference_relevant_skills_with_at_syntax;
  - enforce_dry;yagni;tdd;frequent_commits;
  - save_to;docs/plans/YYYY-MM-DD-<feature-name>.md;
  - include_required_header;goal;architecture;tech_stack;
  - include_sub_skill_directive;use_superpowers:executing_plans;
priority: critical;
output: implementation_plan.md;
log: plan_created;timestamp;task_count;
meta:
  hypothesis;Explicit plans enable autonomous subagent execution;
  rationale;Zero_context engineers need complete information;
handoff: ExecutionSelector;
---
agent: ExecutionSelector;
intent: offer_execution_choice;
context:
  plan;from_PlanningAgent;
  worktree_path;from_WorktreeAgent;
constraints:
  - present_two_options;subagent_driven;parallel_session;
  - explain_subagent_driven;same_session;fresh_subagent_per_task;two_stage_review;
  - explain_parallel_session;new_session;batch_execution;checkpoints;
  - await_user_choice;
priority: high;
output: execution_mode;session_instructions;
log: execution_mode_selected;timestamp;mode;
meta:
  hypothesis;Choice accommodates different working styles;
  rationale;Some prefer continuity;others prefer isolation;
handoff: SubagentDriver;
---
agent: SubagentDriver;
intent: execute_plan_via_fresh_subagents;
context:
  plan;from_PlanningAgent;
  worktree_path;from_WorktreeAgent;
constraints:
  - read_plan_once;extract_all_tasks_with_full_text;
  - create_todo_write_with_all_tasks;
  - per_task;
    - dispatch_implementer_subagent_with_full_context;
    - allow_subagent_to_ask_questions_before_work;
    - implementer_subagent_implements_tests_commits_self_reviews;
    - dispatch_spec_compliance_reviewer_subagent;
    - spec_reviewer_confirms_code_matches_spec;
    - if_spec_issues;implementer_fixes;re_review_until_approved;
    - dispatch_code_quality_reviewer_subagent;
    - code_reviewer_approves_quality;
    - if_quality_issues;implementer_fixes;re_review_until_approved;
    - mark_task_complete_in_todo_write;
  - after_all_tasks;dispatch_final_code_reviewer;
  - use_finishing_development_branch_workflow;
  - never_skip_reviews;
  - never_parallel_dispatch_implementers;
  - always_provide_full_text_not_file_references;
  - ensure_scene_setting_context_per_task;
priority: critical;
output: implementation_complete;all_commits;
log: execution_complete;timestamp;tasks_completed;commits;
meta:
  hypothesis;Fresh subagents per task prevent context pollution;
  rationale;Two_stage_review ensures_spec_compliance_and_code_quality;
handoff: BatchExecutor;
---
agent: BatchExecutor;
intent: execute_plan_in_batches_with_checkpoints;
context:
  plan;from_PlanningAgent;
  worktree_path;from_WorktreeAgent;
constraints:
  - group_tasks_into_logical_batches;
  - execute_batch sequentially;
  - after_each_batch;
    - run_all_tests;verify_passing;
    - request_human_checkpoint;
    - await_approval_before_next_batch;
  - commit_after_each_batch;
  - report_progress_clearly;
priority: high;
output: batches_completed;checkpoint_status;
log: batch_execution_complete;timestamp;batches;checkpoints_passed;
meta:
  hypothesis;Checkpoints maintain human oversight;
  rationale;Batch execution balances autonomy_with_control;
handoff: TDDAgent;
---
agent: TDDAgent;
intent: enforce_test_driven_development_cycle;
context:
  task;from_SubagentDriver_or_BatchExecutor;
constraints:
  - iron_law;no_production_code_without_failing_test_first;
  - red;write_one_minimal_test;
    - one_behavior_per_test;
    - clear_name_describing_behavior;
    - use_real_code_not_mocks;
  - verify_red;run_test;confirm_fails_correctly;
    - test_must_fail_not_error;
    - failure_message_must_be_expected;
    - fails_because_feature_missing_not_typo;
  - green;write_minimal_code_to_pass;
    - simplest_possible_implementation;
    - no_features_beyond_test;
    - no_refactoring_during_green;
  - verify_green;run_test;confirm_passes;
    - test_passes;
    - other_tests_still_pass;
    - output_pristine_no_errors;
  - refactor;clean_up_only_after_green;
    - remove_duplication;
    - improve_names;
    - extract_helpers;
    - keep_tests_green;
  - red_flags;code_before_test;test_passes_immediately;rationalizing_exceptions;
  - penalty;delete_code_start_over;
priority: critical;
output: test_coverage;implementation;
log: tdd_cycle_complete;timestamp;test_name;status;
meta:
  hypothesis;Watching_test_fail_proves_it_tests_something;
  rationale;tests_after_answer_what_does_this_do;tests_first_answer_what_should_this_do;
handoff: DebuggingAgent;
---
agent: DebuggingAgent;
intent: systematic_root_cause_analysis;
context:
  bug_report;user_report_or_test_failure;
constraints:
  - phase_1_define_problem;
    - describe_symptoms_precisely;
    - identify_affected_components;
    - determine_frequency_always_sometimes_intermittent;
  - phase_2_gather_evidence;
    - reproduce_bug_reliably;
    - collect_logs_stack_traces;
    - identify_when_started_working;
  - phase_3_isolate_cause;
    - use_root_cause_tracing;
    - use_defense_in_depth_analysis;
    - use_condition_based_waiting_for_race_conditions;
    - binary_search_git_history;
    - minimize_reproduction_case;
  - phase_4_verify_fix;
    - write_failing_test_reproducing_bug;
    - apply_tdd_cycle_to_fix;
    - use_verification_before_completion;
  - never_fix_without_test;
  - never_apply_bandages;
priority: high;
output: root_cause;fix_verification_test;
log: bug_resolved;timestamp;root_cause;test_added;
meta:
  hypothesis;Systematic_debugging_faster_than_shotgun_debugging;
  rationale;root_cause_elimination_prevents_reoccurrence;
handoff: VerificationAgent;
---
agent: VerificationAgent;
intent: ensure_fix_actually_works;
context:
  proposed_fix;from_DebuggingAgent;
  original_bug;from_DebuggingAgent;
constraints:
  - reproduce_original_bug_first;confirm_exists;
  - apply_fix;
  - verify_bug_gone;
  - verify_no_regressions;
  - verify_edge_cases;
  - run_full_test_suite;
  - check_output_pristine;
  - if_not_fixed;restart_debugging;
priority: high;
output: verification_status;regression_check;
log: verification_complete;timestamp;status;regressions;
meta:
  hypothesis;Verification_catches_incomplete_fixes;
  rationale;feeling_fixed_does_not_mean_fixed;
handoff: CodeReviewAgent;
---
agent: CodeReviewAgent;
intent: conduct_pre_merge_quality_gate;
context:
  implementation;from_SubagentDriver_or_BatchExecutor;
  plan;from_PlanningAgent;
constraints:
  - review_against_plan;
    - all_requirements_implemented;
    - no_extra_features_beyond_spec;
    - file_matches_match_plan;
  - code_quality_check;
    - tests_cover_all_cases;
    - tests_use_real_code_not_mocks;
    - code_is_clean_not_clever;
    - names_are_clear;
    - no_duplication;
    - proper_error_handling;
  - report_by_severity;
    - critical;blocks_progress;must_fix;
    - important;should_fix_before_merge;
    - minor;nice_to_have;
  - if_critical_issues;block_progress;
  - if_no_issues;approve;
priority: critical;
output: review_report;approval_status;
log: review_complete;timestamp;critical;important;minor;status;
meta:
  hypothesis;Pre_merge_review_catches_issues_early;
  rationale;merge_reviews_are_too_late_for_easy_fixes;
handoff: BranchFinisher;
---
agent: BranchFinisher;
intent: complete_development_branch_workflow;
context:
  implementation;from_CodeReviewAgent;
  worktree_path;from_WorktreeAgent;
constraints:
  - verify_all_tests_pass;
  - verify_no_regressions;
  - present_options;
    - merge_to_main;
    - create_pull_request;
    - keep_branch_for_more_work;
    - discard_branch;
  - if_merge;merge_fast_forward_or_squash;delete_worktree;
  - if_pull_request;create_pr_with_description;link_to_plan;
  - if_discard;delete_branch;remove_worktree;
  - document_decision;
priority: high;
output: merge_status;pr_url_or_branch_deleted;
log: branch_completed;timestamp;outcome;
meta:
  hypothesis;Explicit_branch_completion_prevents_orphan_branches;
  rationale;clear_decisions_prevent_branch_accumulation;
handoff: ParallelDispatcher;
---
agent: ParallelDispatcher;
intent: coordinate_concurrent_subagent_workflows;
context:
  independent_tasks;task_list;
constraints:
  - identify_truly_independent_tasks;
  - dispatch_subagents_in_parallel;
  - wait_for_all_subagents;
  - collect_results;
  - detect_conflicts;
  - if_conflicts;resolve_sequentially;
  - merge_results;
priority: medium;
output: parallel_results;conflict_resolution_log;
log: parallel_dispatch_complete;timestamp;tasks;conflicts;
meta:
  hypothesis;Parallel_execution_saves_wall_clock_time;
  rationale;independent_tasks_have_no_dependencies;
handoff: SkillMetaAgent;
---
agent: SkillMetaAgent;
intent: enable_skill_creation_and_extension;
context:
  new_skill_idea;user_request;
constraints:
  - use_writing_skills_skill;
  - follow_skill_structure;
    - metadata_block;
    - agent_definitions;
    - constraints_as_semicolon_key_values;
    - triple_dash_delimiters;
    - explicit_handoff_chains;
  - ensure_v1_compliance;
  - scaffold_tests;
  - validate_syntax;
  - classify_category;
priority: low;
output: new_skill_yamo;test_plan;
log: skill_created;timestamp;name;category;
meta:
  hypothesis;Meta_skills_enable_ecosystem_growth;
  rationale;extensible_systems_adapt_to_new_needs;
handoff: End;
---
agent: UsageGuide;
intent: introduce_superpowers_workflow;
context:
  user;new_to_superpowers;
constraints:
  - explain_basic_workflow;
    - brainstorming;design_refinement;
    - using_git_worktrees;isolated_workspace;
    - writing_plans;implementation_breakdown;
    - subagent_driven_or_executing_plans;task_execution;
    - test_driven_development;red_green_refactor;
    - systematic_debugging;root_cause_analysis;
    - requesting_code_review;quality_gate;
    - finishing_development_branch;merge_pr_discard;
  - explain_skills_trigger_automatically;
  - explain_mandatory_not_suggestions;
  - demonstrate_with_example;
priority: low;
output: user_understanding;workflow_ready;
log: onboarded;timestamp;user;
meta:
  hypothesis;clear_introduction_enables_effective_use;
  rationale;understanding_why_builds_compliance;
handoff: WorkflowMemoryStore;
---
agent: WorkflowMemoryStore;
intent: store_workflow_execution_for_pattern_recognition;
context:
  workflow_decision;from_WorkflowOrchestrator;
  memory_script;tools/memory_mesh.js;
  memory_enabled;provided_by_user.memory_enabled;
constraints:
  - generate_workflow_embedding;
  - tag_by_mode_project_type_and_outcome;
  - store_execution_patterns;
  - enable_future_recommendations;
priority: low;
output: workflow_memory_receipt.json;
log: workflow_stored;memory_id;
meta:
  hypothesis;Storing workflows enables pattern recognition for future recommendations;
handoff: End;
