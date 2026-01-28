# 🎯 Using This Project in Anthropic Interviews

## Quick Reference

**GitHub**: https://github.com/hlckl123456/temporal-ecommerce
**Elevator Pitch**: "Production-grade Temporal.io demo showing Saga pattern, ML training workflows, checkpoint recovery, and seeded randomness - the exact patterns needed for AI training orchestration."

---

## 🎬 Interview Scenarios

### Scenario 1: "Tell me about a complex distributed system you've built"

**Your answer**:
> "I built a production-grade workflow orchestration system using Temporal.io to solve distributed transaction challenges. It has two workflows: e-commerce order processing (demonstrating Saga pattern) and ML model training (demonstrating checkpoint recovery and seeded randomness).
>
> The order workflow coordinates inventory, payment, and shipping across multiple services with automatic compensation on failures. The ML workflow shows how to resume expensive training runs from checkpoints—critical for AI workloads where re-training costs $100K+.
>
> Let me walk you through the architecture..."

**Show them**: [Open GitHub, navigate to `README.md`]

---

### Scenario 2: "How would you design a system for orchestrating long-running ML training jobs?"

**Your answer (using this project)**:

**Step 1: Explain the problem**
> "ML training jobs have unique challenges:
> - **Long-running**: Days to weeks
> - **Expensive**: $50K-$1M in GPU costs
> - **Non-deterministic**: Researchers need randomness, but reproducibility required
> - **Human-in-the-loop**: Researchers need to pause, adjust hyperparameters, resume
> - **Compliance**: Need tamper-evident audit trail for AI safety
>
> Traditional approaches—manual state management, cron jobs, or Step Functions—can't handle all these."

**Step 2: Introduce Temporal**
> "Temporal provides durable execution: workflows survive crashes, have built-in retry logic, and maintain complete history. I implemented this pattern in a demo project."

**Step 3: Walk through your code**

Open `src/workflows/ml-training-workflow.ts` and explain:

1. **Checkpoint Recovery** (lines 167-177)
   > "Every N epochs, we save a checkpoint to S3. If the workflow fails at epoch 150, we resume from checkpoint at epoch 140 instead of restarting from epoch 0. This saves 70% of compute."

2. **Seeded Randomness** (lines 90-108)
   > "The SeededRNG class uses workflow ID as seed. On first execution, it generates random numbers for batch shuffling. On replay after crash, same seed = same random sequence. This gives reproducibility by default, with researcher override via signals."

3. **Human Intervention** (lines 185-206)
   > "Every 10 epochs, workflow pauses for researcher review. They can continue, adjust hyperparameters, or stop. Workflow waits up to 2 hours using `condition()`. This is critical for research: can't automate everything."

4. **Cryptographic Audit** (Show `ml-training.ts:185-201`)
   > "Each checkpoint includes a Merkle root of training data. This creates tamper-evident lineage for compliance. If regulator asks 'what data trained this model?', we provide cryptographic proof."

**Step 4: Address scale**
> "In production at Anthropic's scale, we'd:
> - Self-host Temporal (data sovereignty)
> - Multi-region deployment for HA
> - Custom interceptors for audit logging
> - Adaptive checkpointing based on compute cost
>
> The $1M/year operational cost is justified because workflow correctness is core to the business."

**Show them**: [Open `ANTHROPIC_ALIGNMENT.md`]

---

### Scenario 3: "How do you handle failures in distributed systems?"

**Your answer**:
> "Two patterns: **Saga for compensation** and **Checkpoint for recovery**."

**Show Saga Pattern**:
Open `src/workflows/order-workflow.ts:240-296`

> "This implements the Saga pattern. If shipping fails after payment succeeded, we automatically refund and release inventory—in reverse order. The key is `CancellationScope.nonCancellable()` ensures compensations complete even if workflow is cancelled.
>
> Temporal guarantees: if `processPayment()` returns successfully, it won't be called again on replay. Activity results are cached in history."

**Show Checkpoint Recovery**:
Open `src/workflows/ml-training-workflow.ts:167-177`

> "Checkpoints save expensive state to S3. When training resumes, we load the checkpoint and skip already-completed epochs. This is like Git branches for model training—you can branch from any checkpoint."

---

### Scenario 4: "How do you ensure reproducibility in ML experiments?"

**Your answer**:
> "Three mechanisms: **seeded randomness**, **deterministic replay**, and **cryptographic audit**."

**Show code**:
```typescript
// ml-training-workflow.ts:90-108
class SeededRNG {
  constructor(seed: number) {
    this.state = seed % 2147483647;
  }
  next(): number {
    this.state = (this.state * 48271) % 2147483647;
    return (this.state - 1) / 2147483646;
  }
}

// In workflow
const seed = config.randomSeed || hashWorkflowId(workflowInfo().workflowId);
const rng = new SeededRNG(seed);
```

> "Every random decision uses this seeded RNG. Same workflow ID = same seed = same random sequence. On replay, Temporal replays the exact same decisions. This ensures:
> 1. **Default reproducibility**: Run workflow twice = identical results
> 2. **Researcher override**: Signal with explicit seed for A/B testing
> 3. **Audit trail**: Workflow history includes all random choices"

---

### Scenario 5: "What are the trade-offs of using Temporal vs building custom orchestration?"

**Your answer**:

**Show** `QUALITY_REPORT.md` or `ANTHROPIC_ALIGNMENT.md` cost section:

**Build Custom**:
```
Development: 4 weeks
Maintenance: 2-3 engineers
Bugs: Lost state, inconsistent compensation, race conditions
Annual cost: ~$500K
Reliability: 95% uptime (manual state management is hard)
```

**Use Temporal**:
```
Development: 3 days (93% faster)
Maintenance: 1 engineer (Temporal handles state)
Bugs: Rare (Temporal's 10+ years of production hardening)
Annual cost: ~$50K (cloud) or ~$1M (self-hosted with extensions)
Reliability: 99.99% uptime
```

**For Anthropic's use case (self-hosted)**:
> "We'd accept $1M/year because:
> 1. Data sovereignty (can't use Temporal Cloud)
> 2. Cryptographic audit trail (compliance requirement)
> 3. Checkpoint extensions (save $1M+ in compute)
> 4. Workflow correctness is core competency, not commodity
>
> Single prevented training failure = $100K saved. ROI is clear."

---

### Scenario 6: "Walk me through your testing strategy"

**Your answer**:
> "Multi-layered: **unit tests** for activities, **replay tests** for determinism, **integration tests** for end-to-end, and **chaos tests** for failures."

**Show** `tests/integration/order-workflow.test.ts`:

> "Temporal's test environment lets us:
> 1. **Test activities** in isolation with mocked dependencies
> 2. **Test workflows** with TestWorkflowEnvironment (in-memory, no Docker)
> 3. **Test replay behavior**: Record execution, replay from history, verify same decisions
> 4. **Test compensation**: Inject failures, verify Saga rollback
>
> The key is replay testing catches non-determinism bugs (Date.now(), Math.random()) before production."

---

## 🎭 Demo Script (5 minutes)

If interviewer says "show me how it works":

**1. Architecture Overview** (30 seconds)
- Open `README.md`, scroll to architecture diagram
- "Two workflows: e-commerce and ML training. Both use Temporal for durable execution."

**2. Saga Pattern** (1 minute)
- Open `src/workflows/order-workflow.ts`
- Scroll to line 240 (compensation logic)
- "If any step fails, automatic rollback in reverse order. Non-cancellable scope ensures completion."

**3. Checkpoint Recovery** (1 minute)
- Open `src/workflows/ml-training-workflow.ts`
- Show lines 167-177 (checkpointing)
- "Save state every N epochs. Resume from checkpoint on failure. Saves compute."

**4. Seeded Randomness** (1 minute)
- Show lines 90-108 (SeededRNG class)
- "Deterministic RNG for reproducibility. Same seed = same results."

**5. Observability** (1 minute)
- Show query handler (lines 128-135)
- "Real-time state inspection without breaking determinism."

**6. Testing** (30 seconds)
- Show `tests/integration/order-workflow.test.ts`
- "Replay-based testing. Record execution, verify replay produces same decisions."

---

## 💬 Common Questions & Answers

### Q: "Why Temporal instead of Step Functions?"

**A**:
> "Step Functions uses JSON DSL which can't express complex conditional logic needed for research workflows. Example: 'If safety eval fails, branch to adjusted RLHF with different reward model, but keep pre-training results.' That requires programmatic control flow.
>
> Also, Step Functions is AWS-locked. Temporal's open-source core gives flexibility to run on-prem for data sovereignty."

### Q: "How do you handle workflow version upgrades?"

**A**:
> "Two strategies shown in `ANTHROPIC_ALIGNMENT.md`:
> 1. **Versioning**: Deploy V2 alongside V1. New workflows use V2, old ones complete on V1.
> 2. **Patching**: Use `workflow.patched()` for conditional logic. Old workflows follow legacy path, new ones take updated path.
>
> After 90% drainage, force-migrate or terminate remaining old workflows."

### Q: "What happens if Temporal server crashes?"

**A**:
> "Workflows pause, not lost. When server restarts:
> 1. History is persisted in Postgres (replicated, backed up)
> 2. Workers reconnect and poll for tasks
> 3. Workflows resume from last completed activity
> 4. Zero data loss, zero duplicates
>
> For HA, we'd run multi-region active-passive with 30-60s failover."

### Q: "How do you prevent non-determinism bugs?"

**A**:
> "Three defenses:
> 1. **Code review**: Check for Date.now(), Math.random(), API calls in workflow code
> 2. **Replay tests**: Record execution, replay, verify same decisions
> 3. **Linting**: Custom ESLint rules to flag non-deterministic operations
>
> Temporal's SDK also wraps Date.now() to return deterministic time during replay."

---

## 📝 Key Points to Memorize

1. **Saga Pattern** = Automatic compensation, prevents inconsistent state
2. **Checkpoint Recovery** = Resume from arbitrary point, saves compute
3. **Seeded RNG** = Reproducibility by default, override for exploration
4. **Audit Trail** = Merkle roots for compliance, tamper-evident
5. **Self-Host** = Data sovereignty, $1M/year justified for core competency
6. **Versioning** = Separate code paths for gradual rollout
7. **Testing** = Replay-based, catches non-determinism
8. **Observability** = State via activities, not I/O in query handlers

---

## 🚀 Preparation Checklist

Before interview:
- [ ] Clone repo locally, verify it runs
- [ ] Read `README.md` fully
- [ ] Read `ANTHROPIC_ALIGNMENT.md` fully
- [ ] Understand Saga pattern (order-workflow.ts:240-296)
- [ ] Understand checkpoint recovery (ml-training-workflow.ts:167-177)
- [ ] Understand seeded RNG (ml-training-workflow.ts:90-108)
- [ ] Practice 5-minute demo script
- [ ] Memorize 8 key points above
- [ ] Read your `/Users/Claus/Documents/我的信息台/hello_interview/patterns/anthropic_workflow_strategy.md`

**You're ready! This project demonstrates you understand:**
- ✅ Temporal's core primitives
- ✅ Advanced patterns for AI/ML
- ✅ Trade-offs at scale
- ✅ Production considerations

**Good luck with your Anthropic interview! 🎯**
