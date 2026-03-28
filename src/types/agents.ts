// Copyright (C) 2025 Keygraph, Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License version 3
// as published by the Free Software Foundation.

/**
 * Agent type definitions for the remediation pipeline.
 */

/**
 * List of all agents in execution order.
 * Used for iteration during resume state checking.
 */
export const ALL_AGENTS = [
  'triage',
  'fix-plan',
  'fix-injection',
  'fix-xss',
  'fix-auth',
  'fix-ssrf',
  'fix-authz',
  'fix-review',
  'targeted-validate',
  'shannon-full-audit',
  'compare',
  'report',
] as const;

/**
 * Agent name type derived from ALL_AGENTS.
 * This ensures type safety and prevents drift between type and array.
 */
export type AgentName = typeof ALL_AGENTS[number];

import type { ActivityLogger } from './activity-logger.js';

export type AgentValidator = (sourceDir: string, logger: ActivityLogger) => Promise<boolean>;

export type AgentStatus =
  | 'pending'
  | 'in_progress'
  | 'completed'
  | 'failed'
  | 'rolled-back';

export interface AgentDefinition {
  name: AgentName;
  displayName: string;
  prerequisites: AgentName[];
  promptTemplate: string;
  deliverableFilename: string;
  modelTier?: 'small' | 'medium' | 'large';
}

/**
 * Fix types supported by the remediation pipeline.
 */
export type FixType = 'injection' | 'xss' | 'auth' | 'ssrf' | 'authz';
