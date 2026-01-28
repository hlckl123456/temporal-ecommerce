/**
 * ML Training Workflow - Demonstrates Advanced Temporal Patterns
 *
 * This workflow showcases patterns critical for AI/ML workloads:
 * 1. Checkpoint-based partial replay (avoid re-running expensive training)
 * 2. Controlled non-determinism (seeded randomness for reproducibility)
 * 3. Human-in-the-loop for research decisions
 * 4. Long-running processes (hours to days)
 * 5. Activity result caching for cost optimization
 *
 * Inspired by real ML training workflows at companies like Anthropic,
 * where training runs can cost $100K+ and must be reproducible.
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
} from '@temporalio/workflow';

// Training-specific types
export interface TrainingConfig {
  modelId: string;
  datasetId: string;
  hyperparameters: {
    learningRate: number;
    batchSize: number;
    epochs: number;
    optimizer: string;
  };
  checkpointInterval: number; // Steps between checkpoints
  randomSeed?: number; // For reproducibility
}

export interface TrainingState {
  modelId: string;
  status: TrainingStatus;
  currentEpoch: number;
  totalEpochs: number;
  currentLoss: number;
  bestLoss: number;
  checkpoints: CheckpointInfo[];
  trainingStartTime: number;
  lastUpdateTime: number;
  randomSeed: number;
}

export type TrainingStatus =
  | 'initializing'
  | 'training'
  | 'checkpointing'
  | 'evaluating'
  | 'awaiting_approval'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface CheckpointInfo {
  checkpointId: string;
  epoch: number;
  loss: number;
  timestamp: number;
  s3Path: string;
  merkleRoot?: string; // For cryptographic audit
}

export interface TrainingResult {
  modelId: string;
  finalLoss: number;
  totalEpochs: number;
  checkpoints: CheckpointInfo[];
  trainingDuration: number;
}

export interface ResearcherDecision {
  action: 'continue' | 'adjust' | 'stop';
  newHyperparameters?: TrainingConfig['hyperparameters'];
  reason: string;
}

// Import activity types
import type * as activities from '../activities';

// Activity proxies with appropriate timeouts for ML workloads
const {
  initializeTraining,
  trainEpoch,
  saveCheckpoint,
  evaluateModel,
  cleanupTraining,
} = proxyActivities<typeof activities>({
  startToCloseTimeout: '30 minutes', // Training epochs can be long
  retry: {
    initialInterval: '10s',
    backoffCoefficient: 2,
    maximumInterval: '5 minutes',
    maximumAttempts: 3,
  },
});

// Signals for human-in-the-loop
export const researcherDecisionSignal = defineSignal<[ResearcherDecision]>('researcherDecision');
export const cancelTrainingSignal = defineSignal('cancelTraining');

// Queries for observability
export const trainingStateQuery = defineQuery<TrainingState>('trainingState');

/**
 * Seeded Random Number Generator for Deterministic Randomness
 *
 * Critical for AI research: experiments must be reproducible.
 * Using workflow ID as seed ensures deterministic replay.
 */
class SeededRNG {
  private state: number;

  constructor(seed: number) {
    this.state = seed % 2147483647;
    if (this.state <= 0) this.state += 2147483646;
  }

  next(): number {
    // Linear congruential generator
    this.state = (this.state * 48271) % 2147483647;
    return (this.state - 1) / 2147483646; // [0, 1)
  }

  nextInt(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }
}

/**
 * Main ML Training Workflow
 *
 * Demonstrates how to:
 * - Resume from checkpoints (avoid re-training from scratch)
 * - Use seeded randomness for reproducibility
 * - Wait for researcher decisions
 * - Handle long-running processes
 */
export async function mlTrainingWorkflow(
  config: TrainingConfig,
  resumeFromCheckpoint?: CheckpointInfo
): Promise<TrainingResult> {
  // Initialize state
  const startTime = Date.now();

  // Seeded RNG for reproducibility
  const seed = config.randomSeed || hashWorkflowId(workflowInfo().workflowId);
  const rng = new SeededRNG(seed);

  const state: TrainingState = {
    modelId: config.modelId,
    status: 'initializing',
    currentEpoch: resumeFromCheckpoint?.epoch || 0,
    totalEpochs: config.hyperparameters.epochs,
    currentLoss: resumeFromCheckpoint?.loss || Infinity,
    bestLoss: resumeFromCheckpoint?.loss || Infinity,
    checkpoints: resumeFromCheckpoint ? [resumeFromCheckpoint] : [],
    trainingStartTime: startTime,
    lastUpdateTime: startTime,
    randomSeed: seed,
  };

  let cancelled = false;
  let researcherDecision: ResearcherDecision | undefined;

  // Setup signal handlers
  setHandler(researcherDecisionSignal, (decision: ResearcherDecision) => {
    researcherDecision = decision;
  });

  setHandler(cancelTrainingSignal, () => {
    cancelled = true;
  });

  // Setup query handler for real-time observability
  setHandler(trainingStateQuery, () => state);

  try {
    // === Phase 1: Initialize Training ===
    state.status = 'initializing';

    const initResult = await initializeTraining({
      modelId: config.modelId,
      datasetId: config.datasetId,
      hyperparameters: config.hyperparameters,
      randomSeed: seed,
      resumeFromCheckpoint: resumeFromCheckpoint?.s3Path,
    });

    // === Phase 2: Training Loop with Checkpoints ===
    state.status = 'training';

    for (let epoch = state.currentEpoch; epoch < state.totalEpochs; epoch++) {
      // Check for cancellation
      if (cancelled) {
        throw new Error('Training cancelled by researcher');
      }

      // Train one epoch
      const epochResult = await trainEpoch({
        modelId: config.modelId,
        epoch,
        batchSize: config.hyperparameters.batchSize,
        learningRate: config.hyperparameters.learningRate,
        // Use seeded randomness for batch shuffling
        shuffleSeed: rng.nextInt(0, 1000000),
      });

      // Update state (deterministic via activity result)
      state.currentEpoch = epoch;
      state.currentLoss = epochResult.loss;
      state.lastUpdateTime = Date.now();

      if (epochResult.loss < state.bestLoss) {
        state.bestLoss = epochResult.loss;
      }

      // === Checkpoint Strategy (Save Expensive Compute) ===
      // Every N epochs, create checkpoint so we can resume without re-training
      if ((epoch + 1) % config.checkpointInterval === 0) {
        state.status = 'checkpointing';

        const checkpoint = await saveCheckpoint({
          modelId: config.modelId,
          epoch: epoch + 1,
          loss: epochResult.loss,
          hyperparameters: config.hyperparameters,
        });

        state.checkpoints.push({
          checkpointId: checkpoint.checkpointId,
          epoch: epoch + 1,
          loss: epochResult.loss,
          timestamp: Date.now(),
          s3Path: checkpoint.s3Path,
          merkleRoot: checkpoint.merkleRoot, // For audit trail
        });

        state.status = 'training';
      }

      // === Human-in-the-Loop for Research Decisions ===
      // Every 10 epochs, pause for researcher review
      if ((epoch + 1) % 10 === 0) {
        state.status = 'awaiting_approval';

        // Wait for researcher decision (with timeout)
        const hasDecision = await condition(() => researcherDecision !== undefined, '2 hours');

        if (hasDecision && researcherDecision) {
          if (researcherDecision.action === 'stop') {
            // Researcher wants to stop early
            break;
          } else if (researcherDecision.action === 'adjust') {
            // Researcher wants to adjust hyperparameters
            // In real system, would update config and continue
            // For demo, we just log the decision
            state.status = 'training';
            researcherDecision = undefined;
          } else {
            // Continue training
            state.status = 'training';
            researcherDecision = undefined;
          }
        } else {
          // Timeout - continue training with current config
          state.status = 'training';
        }
      }

      // Simulate inter-epoch delay (in real system, this is actual training time)
      await sleep('100ms'); // Shortened for demo; real training takes minutes/hours per epoch
    }

    // === Phase 3: Final Evaluation ===
    state.status = 'evaluating';

    const evalResult = await evaluateModel({
      modelId: config.modelId,
      datasetId: config.datasetId,
      checkpointId: state.checkpoints[state.checkpoints.length - 1]?.checkpointId,
    });

    state.status = 'completed';

    return {
      modelId: config.modelId,
      finalLoss: state.currentLoss,
      totalEpochs: state.currentEpoch + 1,
      checkpoints: state.checkpoints,
      trainingDuration: Date.now() - startTime,
    };
  } catch (error) {
    state.status = 'failed';

    // Cleanup resources
    await CancellationScope.nonCancellable(async () => {
      try {
        await cleanupTraining({
          modelId: config.modelId,
          checkpoints: state.checkpoints,
        });
      } catch (cleanupError) {
        // Log but don't fail cleanup
        console.error('Failed to cleanup training:', cleanupError);
      }
    });

    throw error;
  }
}

/**
 * Hash workflow ID to generate deterministic seed
 */
function hashWorkflowId(workflowId: string): number {
  let hash = 0;
  for (let i = 0; i < workflowId.length; i++) {
    const char = workflowId.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash);
}
