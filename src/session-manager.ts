// Copyright (C) 2025 Keygraph, Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License version 3
// as published by the Free Software Foundation.

import { path, fs } from 'zx';
import type { AgentName, AgentDefinition, AgentValidator } from './types/index.js';
import type { ActivityLogger } from './types/activity-logger.js';

// Agent definitions for the remediation pipeline
// NOTE: deliverableFilename values must match mcp-server/src/types/deliverables.ts:DELIVERABLE_FILENAMES
export const AGENTS: Readonly<Record<AgentName, AgentDefinition>> = Object.freeze({
  'triage': {
    name: 'triage',
    displayName: 'Triage agent',
    prerequisites: [],
    promptTemplate: 'triage',
    deliverableFilename: 'remediation_plan.json',
  },
  'fix-plan': {
    name: 'fix-plan',
    displayName: 'Fix planning agent',
    prerequisites: ['triage'],
    promptTemplate: 'fix-plan',
    deliverableFilename: 'fix_specifications.json',
    modelTier: 'large',
  },
  'fix-injection': {
    name: 'fix-injection',
    displayName: 'Injection fix agent',
    prerequisites: ['fix-plan'],
    promptTemplate: 'fix-injection',
    deliverableFilename: 'injection_fix_report.md',
  },
  'fix-xss': {
    name: 'fix-xss',
    displayName: 'XSS fix agent',
    prerequisites: ['fix-plan'],
    promptTemplate: 'fix-xss',
    deliverableFilename: 'xss_fix_report.md',
  },
  'fix-auth': {
    name: 'fix-auth',
    displayName: 'Auth fix agent',
    prerequisites: ['fix-plan'],
    promptTemplate: 'fix-auth',
    deliverableFilename: 'auth_fix_report.md',
  },
  'fix-ssrf': {
    name: 'fix-ssrf',
    displayName: 'SSRF fix agent',
    prerequisites: ['fix-plan'],
    promptTemplate: 'fix-ssrf',
    deliverableFilename: 'ssrf_fix_report.md',
  },
  'fix-authz': {
    name: 'fix-authz',
    displayName: 'Authz fix agent',
    prerequisites: ['fix-plan'],
    promptTemplate: 'fix-authz',
    deliverableFilename: 'authz_fix_report.md',
  },
  'fix-review': {
    name: 'fix-review',
    displayName: 'Fix review agent',
    prerequisites: ['fix-injection', 'fix-xss', 'fix-auth', 'fix-ssrf', 'fix-authz'],
    promptTemplate: 'fix-review',
    deliverableFilename: 'fix_review_report.md',
  },
  'shannon-validate': {
    name: 'shannon-validate',
    displayName: 'Shannon validation agent',
    prerequisites: ['fix-review'],
    promptTemplate: 'shannon-validate',
    deliverableFilename: 'shannon_validation_report.md',
  },
  'compare': {
    name: 'compare',
    displayName: 'Comparison agent',
    prerequisites: ['shannon-validate'],
    promptTemplate: 'compare',
    deliverableFilename: 'comparison_report.json',
  },
  'report': {
    name: 'report',
    displayName: 'Report agent',
    prerequisites: ['compare'],
    promptTemplate: 'report-remediation',
    deliverableFilename: 'remediation_report.md',
    modelTier: 'small',
  },
});

// Phase names for metrics aggregation
export type PhaseName =
  | 'triage'
  | 'planning'
  | 'fix-implementation'
  | 'review'
  | 'validation'
  | 'comparison'
  | 'reporting';

// Map agents to their corresponding phases (single source of truth)
export const AGENT_PHASE_MAP: Readonly<Record<AgentName, PhaseName>> = Object.freeze({
  'triage': 'triage',
  'fix-plan': 'planning',
  'fix-injection': 'fix-implementation',
  'fix-xss': 'fix-implementation',
  'fix-auth': 'fix-implementation',
  'fix-ssrf': 'fix-implementation',
  'fix-authz': 'fix-implementation',
  'fix-review': 'review',
  'shannon-validate': 'validation',
  'compare': 'comparison',
  'report': 'reporting',
});

// Factory function for deliverable file existence validators
function createDeliverableValidator(filename: string): AgentValidator {
  return async (sourceDir: string): Promise<boolean> => {
    const filePath = path.join(sourceDir, 'deliverables', filename);
    return await fs.pathExists(filePath);
  };
}

// Direct agent-to-validator mapping — checks deliverable file existence
export const AGENT_VALIDATORS: Record<AgentName, AgentValidator> = Object.freeze({
  'triage': createDeliverableValidator('remediation_plan.json'),
  'fix-plan': createDeliverableValidator('fix_specifications.json'),
  'fix-injection': createDeliverableValidator('injection_fix_report.md'),
  'fix-xss': createDeliverableValidator('xss_fix_report.md'),
  'fix-auth': createDeliverableValidator('auth_fix_report.md'),
  'fix-ssrf': createDeliverableValidator('ssrf_fix_report.md'),
  'fix-authz': createDeliverableValidator('authz_fix_report.md'),
  'fix-review': createDeliverableValidator('fix_review_report.md'),
  'shannon-validate': createDeliverableValidator('shannon_validation_report.md'),
  'compare': createDeliverableValidator('comparison_report.json'),

  // Final remediation report
  'report': async (sourceDir: string, logger: ActivityLogger): Promise<boolean> => {
    const reportFile = path.join(sourceDir, 'deliverables', 'remediation_report.md');
    const reportExists = await fs.pathExists(reportFile);

    if (!reportExists) {
      logger.error('Missing required deliverable: remediation_report.md');
    }

    return reportExists;
  },
});
