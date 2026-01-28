/**
 * Agent Codebase Analysis Workflows
 *
 * Demonstrates advanced patterns for autonomous agent infrastructure:
 * 1. Crash Recovery - Resume analysis from file N after worker restart
 * 2. Budget Tracking - Prevent runaway costs with approval gates
 * 3. Multi-Agent Coordination - Child workflows for specialist agents
 * 4. Adaptive Execution - Switch strategies based on intermediate results
 * 5. Human-in-the-Loop - Approval gates for high-impact operations
 *
 * Based on patterns from Anthropic's agent workflow strategy for Claude Code.
 */

import {
  proxyActivities,
  defineSignal,
  defineQuery,
  setHandler,
  condition,
  sleep,
  CancellationScope,
  workflowInfo,
  executeChild,
} from '@temporalio/workflow';

import type * as activities from '../activities';

// Activity proxies
const {
  analyzeFile,
  generateRefactorPlan,
  refactorBatch,
  runTests,
  rollbackBatch,
  emitProgress,
  analyzeQuality,
  notifyUser,
  publishProgress,
} = proxyActivities<typeof activities>({
  startToCloseTimeout: '10 minutes',
  retry: {
    initialInterval: '5s',
    backoffCoefficient: 2,
    maximumInterval: '1 minute',
    maximumAttempts: 3,
  },
});

// ==================== Types ====================

export interface CodebaseAnalysisTask {
  taskId: string;
  repositoryPath: string;
  files: string[];
  analysisType: 'architectural' | 'security' | 'performance' | 'quality';
  targetImprovement?: 'performance' | 'maintainability' | 'security';
  budget?: number; // Max cost in dollars
  requiresApproval?: boolean;
}

export interface AnalysisState {
  taskId: string;
  status: AnalysisStatus;
  currentStage: string;
  filesAnalyzed: number;
  totalFiles: number;
  costSoFar: number;
  budgetRemaining: number;
  issues: any[];
  refactorPlan?: any;
  results: any[];
  startTime: number;
  lastUpdateTime: number;
}

export type AnalysisStatus =
  | 'initializing'
  | 'analyzing'
  | 'planning'
  | 'awaiting_approval'
  | 'refactoring'
  | 'testing'
  | 'budget_exceeded'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface ApprovalDecision {
  approved: boolean;
  approvedBy?: string;
  reason?: string;
}

export interface BudgetApproval {
  approved: boolean;
  newBudget?: number;
  reason?: string;
}

// ==================== Signals & Queries ====================

export const approveRefactorPlanSignal = defineSignal<[ApprovalDecision]>('approveRefactorPlan');
export const approveBudgetSignal = defineSignal<[BudgetApproval]>('approveBudget');
export const cancelAnalysisSignal = defineSignal('cancelAnalysis');

export const analysisStateQuery = defineQuery<AnalysisState>('analysisState');

// ==================== Workflow 1: Codebase Analysis with Crash Recovery ====================

/**
 * Main codebase analysis workflow
 *
 * KEY FEATURES:
 * - Crash recovery: Resume from file N after worker crash
 * - Budget tracking: Stop and request approval if budget exceeded
 * - Progress tracking: Real-time updates via queries and signals
 * - Human-in-the-loop: Approval gate for refactoring plan
 *
 * INTERVIEW TALKING POINT:
 * "If analysis crashes at file 47/100, Temporal resumes from file 47 using cached
 * results for files 0-46. No re-analysis, no wasted compute, seamless UX."
 */
export async function codebaseAnalysisWorkflow(
  task: CodebaseAnalysisTask
): Promise<AnalysisState> {
  const state: AnalysisState = {
    taskId: task.taskId,
    status: 'initializing',
    currentStage: 'initialization',
    filesAnalyzed: 0,
    totalFiles: task.files.length,
    costSoFar: 0,
    budgetRemaining: task.budget || 100.0,
    issues: [],
    results: [],
    startTime: Date.now(),
    lastUpdateTime: Date.now(),
  };

  // Set up query handler for real-time state inspection
  setHandler(analysisStateQuery, () => state);

  // Set up signal handlers
  let planApproval: ApprovalDecision | undefined;
  let budgetApproval: BudgetApproval | undefined;
  let cancelled = false;

  setHandler(approveRefactorPlanSignal, (decision) => {
    planApproval = decision;
  });

  setHandler(approveBudgetSignal, (approval) => {
    budgetApproval = approval;
  });

  setHandler(cancelAnalysisSignal, () => {
    cancelled = true;
  });

  try {
    // === STAGE 1: File-by-File Analysis (CRASH RECOVERY DEMO) ===
    state.status = 'analyzing';
    state.currentStage = 'file-analysis';

    const analyses = [];

    for (let i = 0; i < task.files.length; i++) {
      // Check for cancellation
      if (cancelled) {
        state.status = 'cancelled';
        return state;
      }

      const filePath = task.files[i];

      // Each file analysis is an activity (durable)
      // ✅ CRASH HERE? Workflow resumes from file i+1, not file 0
      const analysis = await analyzeFile({
        filePath,
        analysisType: task.analysisType,
      });

      analyses.push(analysis);
      state.filesAnalyzed = i + 1;
      state.costSoFar += analysis.cost;
      state.budgetRemaining = (task.budget || 100) - state.costSoFar;
      state.lastUpdateTime = Date.now();

      // Collect issues
      state.issues.push(...analysis.issues);

      // === BUDGET TRACKING ===
      // If budget exceeded, pause and request approval
      if (state.costSoFar > (task.budget || 100)) {
        state.status = 'budget_exceeded';
        state.currentStage = 'awaiting-budget-approval';

        await notifyUser(
          `Budget exceeded: $${state.costSoFar.toFixed(2)} > $${task.budget?.toFixed(2)}`,
          { taskId: task.taskId }
        );

        // Wait for budget approval (with timeout)
        const hasApproval = await condition(() => budgetApproval !== undefined, '1 hour');

        if (!hasApproval || !budgetApproval?.approved) {
          state.status = 'cancelled';
          state.currentStage = 'budget-exceeded';
          return state;
        }

        // Increase budget if approved
        if (budgetApproval.newBudget) {
          state.budgetRemaining = budgetApproval.newBudget - state.costSoFar;
        }

        budgetApproval = undefined; // Reset for next time
        state.status = 'analyzing';
      }

      // Emit progress every 10 files (fire-and-forget for real-time UI)
      if (i % 10 === 0 || i === task.files.length - 1) {
        await emitProgress({
          workflowId: workflowInfo().workflowId,
          stage: 'analysis',
          current: i + 1,
          total: task.files.length,
          percent: ((i + 1) / task.files.length) * 100,
        });
      }
    }

    state.results = analyses;

    // === STAGE 2: Generate Refactor Plan ===
    if (task.targetImprovement && analyses.length > 0) {
      state.status = 'planning';
      state.currentStage = 'generating-refactor-plan';

      const plan = await generateRefactorPlan({
        analyses,
        targetImprovement: task.targetImprovement,
        strategy: 'incremental',
      });

      state.refactorPlan = plan;
      state.costSoFar += 0.1; // Plan generation cost

      // === STAGE 3: Human-in-the-Loop Approval ===
      if (task.requiresApproval) {
        state.status = 'awaiting_approval';
        state.currentStage = 'awaiting-plan-approval';

        await notifyUser('Refactor plan generated. Awaiting approval.', {
          planId: plan.planId,
          estimatedCost: plan.estimatedCost,
          totalBatches: plan.batches.length,
        });

        // Wait for approval signal (could be hours)
        // ✅ Worker doesn't hold resources while waiting
        const hasApproval = await condition(() => planApproval !== undefined, '24 hours');

        if (!hasApproval || !planApproval?.approved) {
          state.status = 'cancelled';
          state.currentStage = 'plan-rejected';
          return state;
        }

        // === STAGE 4: Execute Refactoring in Batches (with Compensation) ===
        state.status = 'refactoring';
        state.currentStage = 'executing-refactor';

        for (const batch of plan.batches) {
          try {
            // Refactor batch
            const result = await refactorBatch({
              batch,
              strategy: 'incremental',
            });

            state.costSoFar += result.cost;

            // Run tests
            state.status = 'testing';
            const testResult = await runTests({
              batchId: batch.batchId,
            });

            if (!testResult.passed) {
              // === COMPENSATION: Rollback this batch ===
              await rollbackBatch(batch.batchId);

              await notifyUser(`Batch ${batch.batchId} failed tests. Rolled back.`, {
                errors: testResult.errors,
              });

              // Continue with next batch (or stop - depending on requirements)
            }

            state.status = 'refactoring'; // Back to refactoring
          } catch (error) {
            // Activity failed - compensate
            await rollbackBatch(batch.batchId);
            throw error;
          }
        }
      }
    }

    // === COMPLETION ===
    state.status = 'completed';
    state.currentStage = 'completed';
    state.lastUpdateTime = Date.now();

    await notifyUser('Analysis completed successfully', {
      taskId: task.taskId,
      filesAnalyzed: state.filesAnalyzed,
      totalCost: state.costSoFar,
    });

    return state;
  } catch (error) {
    state.status = 'failed';
    state.currentStage = 'error';
    throw error;
  }
}

// ==================== Workflow 2: Multi-Agent Coordination ====================

export interface MultiAgentTask {
  projectName: string;
  requirements: string[];
}

/**
 * Multi-agent coordination workflow
 *
 * Demonstrates:
 * - Child workflows for specialist agents
 * - Parallel execution where independent
 * - Sequential execution with dependencies
 * - Failure isolation
 *
 * INTERVIEW TALKING POINT:
 * "Each specialist agent is a child workflow with its own history. If the security
 * analyzer fails, we don't re-run the architecture analyzer. Failure isolation FTW."
 */
export async function multiAgentCodebaseWorkflow(
  task: MultiAgentTask
): Promise<{ status: string; results: any }> {
  // Phase 1: Parallel independent analysis
  // Architecture analyzer and security analyzer can run concurrently
  const [architectureResult, securityResult] = await Promise.all([
    executeChild(codebaseAnalysisWorkflow, {
      workflowId: `${task.projectName}-architecture-${Date.now()}`,
      args: [
        {
          taskId: `arch-${Date.now()}`,
          repositoryPath: `/projects/${task.projectName}`,
          files: ['file1.ts', 'file2.ts'], // Simplified
          analysisType: 'architectural',
        },
      ],
    }),

    executeChild(codebaseAnalysisWorkflow, {
      workflowId: `${task.projectName}-security-${Date.now()}`,
      args: [
        {
          taskId: `sec-${Date.now()}`,
          repositoryPath: `/projects/${task.projectName}`,
          files: ['file1.ts', 'file2.ts'],
          analysisType: 'security',
        },
      ],
    }),
  ]);

  // Phase 2: Performance analysis depends on architecture results
  // Only run if architecture analysis found performance issues
  let performanceResult = null;

  if (architectureResult.issues.some((i: any) => i.type === 'performance-issue')) {
    performanceResult = await executeChild(codebaseAnalysisWorkflow, {
      workflowId: `${task.projectName}-performance-${Date.now()}`,
      args: [
        {
          taskId: `perf-${Date.now()}`,
          repositoryPath: `/projects/${task.projectName}`,
          files: ['file1.ts', 'file2.ts'],
          analysisType: 'performance',
        },
      ],
    });
  }

  return {
    status: 'completed',
    results: {
      architecture: architectureResult,
      security: securityResult,
      performance: performanceResult,
    },
  };
}

// ==================== Workflow 3: Adaptive Execution ====================

export interface AdaptiveAnalysisTask {
  topic: string;
  maxDepth: number;
}

export type Strategy = 'breadth-first' | 'depth-first';

/**
 * Adaptive analysis workflow
 *
 * Demonstrates:
 * - Strategy switching based on intermediate results
 * - Quality-driven early exit
 * - Cost optimization through adaptive behavior
 *
 * INTERVIEW TALKING POINT:
 * "The agent adjusts its strategy mid-execution based on quality metrics. Started
 * with breadth-first, switched to depth-first when coverage was high but novelty
 * was low. All strategy changes are recorded in workflow history (deterministic)."
 */
export async function adaptiveAnalysisWorkflow(
  task: AdaptiveAnalysisTask
): Promise<{ strategy: Strategy; depth: number; results: any[] }> {
  let strategy: Strategy = 'breadth-first'; // Start broad
  let depth = 1;
  const results: any[] = [];

  while (depth <= task.maxDepth) {
    // Simulate research with current strategy
    const batchResults = await analyzeFile({
      filePath: `${task.topic}-depth-${depth}`,
      analysisType: 'quality',
      depth,
    });

    results.push(batchResults);

    // Analyze quality of results
    const quality = await analyzeQuality({ results });

    // === ADAPTIVE DECISION ===
    // Switch strategy based on quality metrics
    if (quality.recommendation === 'complete') {
      // Quality threshold met - exit early (cost optimization)
      break;
    } else if (quality.recommendation === 'switch-strategy' && quality.suggestedStrategy) {
      strategy = quality.suggestedStrategy;

      await publishProgress({
        workflowId: workflowInfo().workflowId,
        event: 'strategy-switch',
        oldStrategy: strategy,
        newStrategy: quality.suggestedStrategy,
        reason: `Coverage: ${quality.coverage.toFixed(2)}, Novelty: ${quality.novelty.toFixed(2)}`,
      });
    }

    depth++;

    // Rate limiting
    await sleep('5 seconds');
  }

  return {
    strategy,
    depth: depth - 1,
    results,
  };
}
