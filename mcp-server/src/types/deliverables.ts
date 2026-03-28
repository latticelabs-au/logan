// Copyright (C) 2025 Keygraph, Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License version 3
// as published by the Free Software Foundation.

/**
 * Deliverable Type Definitions
 *
 * Maps deliverable types to their filenames and defines validation requirements.
 * Must match the exact mappings from tools/save_deliverable.js.
 */

export enum DeliverableType {
  // Triage agent
  TRIAGE = 'TRIAGE',

  // Fix planning agent
  FIX_PLAN = 'FIX_PLAN',

  // Fix implementation agents
  INJECTION_FIX = 'INJECTION_FIX',
  XSS_FIX = 'XSS_FIX',
  AUTH_FIX = 'AUTH_FIX',
  SSRF_FIX = 'SSRF_FIX',
  AUTHZ_FIX = 'AUTHZ_FIX',

  // Fix review agent
  FIX_REVIEW = 'FIX_REVIEW',

  // Validation agents
  TARGETED_VALIDATION = 'TARGETED_VALIDATION',
  SHANNON_FULL_AUDIT = 'SHANNON_FULL_AUDIT',

  // Comparison agent
  COMPARISON = 'COMPARISON',

  // Remediation report agent
  REMEDIATION_REPORT = 'REMEDIATION_REPORT',
}

/**
 * Hard-coded filename mappings from agent prompts
 * Must match tools/save_deliverable.js exactly
 */
export const DELIVERABLE_FILENAMES: Record<DeliverableType, string> = {
  [DeliverableType.TRIAGE]: 'remediation_plan.json',
  [DeliverableType.FIX_PLAN]: 'fix_specifications.json',
  [DeliverableType.INJECTION_FIX]: 'injection_fix_report.md',
  [DeliverableType.XSS_FIX]: 'xss_fix_report.md',
  [DeliverableType.AUTH_FIX]: 'auth_fix_report.md',
  [DeliverableType.SSRF_FIX]: 'ssrf_fix_report.md',
  [DeliverableType.AUTHZ_FIX]: 'authz_fix_report.md',
  [DeliverableType.FIX_REVIEW]: 'fix_review_report.md',
  [DeliverableType.TARGETED_VALIDATION]: 'targeted_validation_report.md',
  [DeliverableType.SHANNON_FULL_AUDIT]: 'shannon_full_audit_report.md',
  [DeliverableType.COMPARISON]: 'comparison_report.json',
  [DeliverableType.REMEDIATION_REPORT]: 'remediation_report.md',
};

/**
 * Queue types that require JSON validation
 */
export const QUEUE_TYPES: DeliverableType[] = [
  DeliverableType.TRIAGE,
  DeliverableType.FIX_PLAN,
  DeliverableType.COMPARISON,
];

/**
 * Type guard to check if a deliverable type is a queue
 */
export function isQueueType(type: string): boolean {
  return QUEUE_TYPES.includes(type as DeliverableType);
}

/**
 * Deliverable queue structure for JSON validation
 */
export interface DeliverableQueue {
  [key: string]: unknown;
}
