// Copyright (C) 2025 Keygraph, Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License version 3
// as published by the Free Software Foundation.

/**
 * Temporal workflow for Logan remediation pipeline.
 *
 * Orchestrates the security remediation workflow:
 * 1. Triage (sequential) — Analyze Shannon audit findings
 * 2. Fix Planning (sequential) — Generate fix specifications
 * 3. Fix Implementation (5 parallel agents) — Apply fixes per vuln type
 * 4. Fix Review (sequential) — Review all applied fixes
 * 5. Shannon Validation (sequential) — Re-run Shannon to verify fixes
 * 6. Comparison (sequential) — Compare before/after security posture
 * 7. Reporting (sequential) — Generate remediation report
 *
 * Features:
 * - Queryable state via getProgress
 * - Automatic retry with backoff for transient/billing errors
 * - Non-retryable classification for permanent errors
 * - Audit correlation via workflowId
 * - Graceful failure handling: fix agents continue if one fails
 */

import {
  log,
  proxyActivities,
  setHandler,
  workflowInfo,
} from '@temporalio/workflow';
import type * as activities from './activities.js';
import type { ActivityInput } from './activities.js';
import {
  getProgress,
  type PipelineInput,
  type PipelineState,
  type PipelineProgress,
  type PipelineSummary,
  type AgentMetrics,
  type ResumeState,
} from './shared.js';
import type { AgentName } from '../types/agents.js';
import { ALL_AGENTS } from '../types/agents.js';
import { toWorkflowSummary } from './summary-mapper.js';
import { formatWorkflowError } from './workflow-errors.js';

// Retry configuration for production (long intervals for billing recovery)
const PRODUCTION_RETRY = {
  initialInterval: '5 minutes',
  maximumInterval: '30 minutes',
  backoffCoefficient: 2,
  maximumAttempts: 50,
  nonRetryableErrorTypes: [
    'AuthenticationError',
    'PermissionError',
    'InvalidRequestError',
    'RequestTooLargeError',
    'ConfigurationError',
    'InvalidTargetError',
    'ExecutionLimitError',
  ],
};

// Retry configuration for pipeline testing (fast iteration)
const TESTING_RETRY = {
  initialInterval: '10 seconds',
  maximumInterval: '30 seconds',
  backoffCoefficient: 2,
  maximumAttempts: 5,
  nonRetryableErrorTypes: PRODUCTION_RETRY.nonRetryableErrorTypes,
};

// Activity proxy with production retry configuration (default)
const acts = proxyActivities<typeof activities>({
  startToCloseTimeout: '2 hours',
  heartbeatTimeout: '60 minutes',
  retry: PRODUCTION_RETRY,
});

// Activity proxy with testing retry configuration (fast)
const testActs = proxyActivities<typeof activities>({
  startToCloseTimeout: '30 minutes',
  heartbeatTimeout: '30 minutes',
  retry: TESTING_RETRY,
});

// Retry configuration for subscription plans (5h+ rolling rate limit windows)
const SUBSCRIPTION_RETRY = {
  initialInterval: '5 minutes',
  maximumInterval: '6 hours',
  backoffCoefficient: 2,
  maximumAttempts: 100,
  nonRetryableErrorTypes: PRODUCTION_RETRY.nonRetryableErrorTypes,
};

// Activity proxy for subscription plan recovery (extended timeouts)
const subscriptionActs = proxyActivities<typeof activities>({
  startToCloseTimeout: '8 hours',
  heartbeatTimeout: '2 hours',
  retry: SUBSCRIPTION_RETRY,
});

// Retry configuration for preflight validation (short timeout, few retries)
const PREFLIGHT_RETRY = {
  initialInterval: '10 seconds',
  maximumInterval: '1 minute',
  backoffCoefficient: 2,
  maximumAttempts: 3,
  nonRetryableErrorTypes: PRODUCTION_RETRY.nonRetryableErrorTypes,
};

// Activity proxy for preflight validation (short timeout)
const preflightActs = proxyActivities<typeof activities>({
  startToCloseTimeout: '2 minutes',
  heartbeatTimeout: '2 minutes',
  retry: PREFLIGHT_RETRY,
});

/**
 * Compute aggregated metrics from the current pipeline state.
 * Called on both success and failure to provide partial metrics.
 */
function computeSummary(state: PipelineState): PipelineSummary {
  const metrics = Object.values(state.agentMetrics);
  return {
    totalCostUsd: metrics.reduce((sum, m) => sum + (m.costUsd ?? 0), 0),
    totalDurationMs: Date.now() - state.startTime,
    totalTurns: metrics.reduce((sum, m) => sum + (m.numTurns ?? 0), 0),
    agentCount: state.completedAgents.length,
  };
}

/** Result from a single fix agent in the parallel phase. */
interface FixAgentResult {
  agentName: AgentName;
  metrics: AgentMetrics | null;
  error: string | null;
}

export async function remediationPipelineWorkflow(
  input: PipelineInput
): Promise<PipelineState> {
  const { workflowId } = workflowInfo();

  // Select activity proxy based on mode: testing (fast), subscription (extended), or default
  function selectActivityProxy(pipelineInput: PipelineInput) {
    if (pipelineInput.pipelineTestingMode) return testActs;
    if (pipelineInput.pipelineConfig?.retry_preset === 'subscription') return subscriptionActs;
    return acts;
  }

  const a = selectActivityProxy(input);

  const state: PipelineState = {
    status: 'running',
    currentPhase: null,
    currentAgent: null,
    completedAgents: [],
    failedAgent: null,
    error: null,
    startTime: Date.now(),
    agentMetrics: {},
    summary: null,
  };

  setHandler(getProgress, (): PipelineProgress => ({
    ...state,
    workflowId,
    elapsedMs: Date.now() - state.startTime,
  }));

  // Build ActivityInput with required workflowId for audit correlation
  // Activities require workflowId (non-optional), PipelineInput has it optional
  // Use spread to conditionally include optional properties (exactOptionalPropertyTypes)
  // sessionId is workspace name for resume, or workflowId for new runs
  const sessionId = input.sessionId || input.resumeFromWorkspace || workflowId;

  const activityInput: ActivityInput = {
    webUrl: input.webUrl,
    repoPath: input.repoPath,
    workflowId,
    sessionId,
    ...(input.configPath !== undefined && { configPath: input.configPath }),
    ...(input.outputPath !== undefined && { outputPath: input.outputPath }),
    ...(input.pipelineTestingMode !== undefined && {
      pipelineTestingMode: input.pipelineTestingMode,
    }),
  };

  let resumeState: ResumeState | null = null;

  if (input.resumeFromWorkspace) {
    // 1. Load resume state (validates workspace, cross-checks deliverables)
    resumeState = await a.loadResumeState(
      input.resumeFromWorkspace,
      input.webUrl,
      input.repoPath
    );

    // 2. Restore git workspace and clean up incomplete deliverables
    const incompleteAgents = ALL_AGENTS.filter(
      (agentName) => !resumeState!.completedAgents.includes(agentName)
    ) as AgentName[];

    await a.restoreGitCheckpoint(
      input.repoPath,
      resumeState.checkpointHash,
      incompleteAgents
    );

    // 3. Short-circuit if all agents already completed
    if (resumeState.completedAgents.length === ALL_AGENTS.length) {
      log.info(`All ${ALL_AGENTS.length} agents already completed. Nothing to resume.`);
      state.status = 'completed';
      state.completedAgents = [...resumeState.completedAgents];
      state.summary = computeSummary(state);
      return state;
    }

    // 4. Record this resume attempt in session.json and workflow.log
    await a.recordResumeAttempt(
      activityInput,
      input.terminatedWorkflows || [],
      resumeState.checkpointHash,
      resumeState.originalWorkflowId,
      resumeState.completedAgents
    );

    log.info('Resume state loaded and workspace restored');
  }

  const shouldSkip = (agentName: string): boolean => {
    return resumeState?.completedAgents.includes(agentName) ?? false;
  };

  // Run a sequential agent phase
  async function runSequentialPhase(
    phaseName: string,
    agentName: AgentName,
    runAgent: (input: ActivityInput) => Promise<AgentMetrics>
  ): Promise<void> {
    if (!shouldSkip(agentName)) {
      state.currentPhase = phaseName;
      state.currentAgent = agentName;
      await a.logPhaseTransition(activityInput, phaseName, 'start');
      state.agentMetrics[agentName] = await runAgent(activityInput);
      state.completedAgents.push(agentName);
      await a.logPhaseTransition(activityInput, phaseName, 'complete');
    } else {
      log.info(`Skipping ${agentName} (already complete)`);
      state.completedAgents.push(agentName);
    }
  }

  // Build configs for the 5 parallel fix agents
  function buildFixConfigs(): Array<{
    agentName: AgentName;
    runAgent: () => Promise<AgentMetrics>;
  }> {
    return [
      {
        agentName: 'fix-injection',
        runAgent: () => a.runFixInjectionAgent(activityInput),
      },
      {
        agentName: 'fix-xss',
        runAgent: () => a.runFixXssAgent(activityInput),
      },
      {
        agentName: 'fix-auth',
        runAgent: () => a.runFixAuthAgent(activityInput),
      },
      {
        agentName: 'fix-ssrf',
        runAgent: () => a.runFixSsrfAgent(activityInput),
      },
      {
        agentName: 'fix-authz',
        runAgent: () => a.runFixAuthzAgent(activityInput),
      },
    ];
  }

  // Aggregate results from settled fix agent promises into workflow state
  function aggregateFixResults(
    results: PromiseSettledResult<FixAgentResult>[]
  ): void {
    const failedAgents: string[] = [];

    for (const result of results) {
      if (result.status === 'fulfilled') {
        const { agentName, metrics } = result.value;

        if (metrics) {
          state.agentMetrics[agentName] = metrics;
          state.completedAgents.push(agentName);
        } else if (shouldSkip(agentName)) {
          state.completedAgents.push(agentName);
        }
      } else {
        const errorMsg =
          result.reason instanceof Error
            ? result.reason.message
            : String(result.reason);
        failedAgents.push(errorMsg);
      }
    }

    if (failedAgents.length > 0) {
      log.warn(`${failedAgents.length} fix agent(s) failed`, {
        failures: failedAgents,
      });
    }
  }

  // Run thunks with a concurrency limit, returning PromiseSettledResult for each.
  // When limit >= thunks.length (default), all launch concurrently.
  // NOTE: Results are in completion order, not input order. Callers must key on value fields, not index.
  async function runWithConcurrencyLimit(
    thunks: Array<() => Promise<FixAgentResult>>,
    limit: number
  ): Promise<PromiseSettledResult<FixAgentResult>[]> {
    const results: PromiseSettledResult<FixAgentResult>[] = [];
    const inFlight = new Set<Promise<void>>();

    for (const thunk of thunks) {
      const slot = thunk().then(
        (value) => { results.push({ status: 'fulfilled', value }); },
        (reason: unknown) => { results.push({ status: 'rejected', reason }); }
      ).finally(() => { inFlight.delete(slot); });

      inFlight.add(slot);

      if (inFlight.size >= limit) {
        await Promise.race(inFlight);
      }
    }

    await Promise.allSettled(inFlight);
    return results;
  }

  try {
    // === Preflight Validation ===
    // Quick sanity checks before committing to expensive agent runs.
    // NOT using runSequentialPhase — preflight doesn't produce AgentMetrics.
    state.currentPhase = 'preflight';
    state.currentAgent = null;
    await preflightActs.runPreflightValidation(activityInput);
    log.info('Preflight validation passed');

    // === Phase 1: Triage ===
    await runSequentialPhase('triage', 'triage', a.runTriageAgent);

    // === Phase 2: Fix Planning ===
    await runSequentialPhase('planning', 'fix-plan', a.runFixPlanAgent);

    // === Phase 3: Fix Implementation (5 parallel agents) ===
    state.currentPhase = 'fix-implementation';
    state.currentAgent = 'fix-agents';
    await a.logPhaseTransition(activityInput, 'fix-implementation', 'start');

    const maxConcurrent = input.pipelineConfig?.max_concurrent_pipelines ?? 5;

    const fixConfigs = buildFixConfigs();
    const fixThunks: Array<() => Promise<FixAgentResult>> = [];

    for (const config of fixConfigs) {
      if (!shouldSkip(config.agentName)) {
        fixThunks.push(async (): Promise<FixAgentResult> => {
          const metrics = await config.runAgent();
          return { agentName: config.agentName, metrics, error: null };
        });
      } else {
        log.info(`Skipping ${config.agentName} (already complete)`);
        state.completedAgents.push(config.agentName);
      }
    }

    const fixResults = await runWithConcurrencyLimit(fixThunks, maxConcurrent);
    aggregateFixResults(fixResults);

    await a.logPhaseTransition(activityInput, 'fix-implementation', 'complete');

    // === Phase 4: Fix Review ===
    await runSequentialPhase('review', 'fix-review', a.runFixReviewAgent);

    // === Phase 5: Shannon Validation ===
    await runSequentialPhase('validation', 'shannon-validate', a.runShannonValidateAgent);

    // === Phase 6: Comparison ===
    await runSequentialPhase('comparison', 'compare', a.runCompareAgent);

    // === Phase 7: Reporting ===
    await runSequentialPhase('reporting', 'report', a.runReportAgent);

    state.status = 'completed';
    state.currentPhase = null;
    state.currentAgent = null;
    state.summary = computeSummary(state);

    // Log workflow completion summary
    await a.logWorkflowComplete(activityInput, toWorkflowSummary(state, 'completed'));

    return state;
  } catch (error) {
    state.status = 'failed';
    state.failedAgent = state.currentAgent;
    state.error = formatWorkflowError(error, state.currentPhase, state.currentAgent);
    state.summary = computeSummary(state);

    // Log workflow failure summary
    await a.logWorkflowComplete(activityInput, toWorkflowSummary(state, 'failed'));

    throw error;
  }
}
