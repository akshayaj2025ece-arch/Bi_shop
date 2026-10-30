/**
 * Server-side Saga Orchestrator for BISHOP.
 * Implements Topic 18 (Distributed Transactions) and Topic 19 (Saga Pattern).
 * Coordinates multi-step business transactions (stock reservation -> payment -> order commitment)
 * with reliable compensating actions if any intermediate step fails.
 */

if (typeof window !== "undefined") {
  throw new Error("Security Error: server-only module '@/server/common/saga' cannot be executed in browser context.");
}

export interface SagaStep<TContext = any> {
  name: string;
  execute: (context: TContext) => Promise<void>;
  compensate: (context: TContext) => Promise<void>;
}

export interface SagaResult<TContext = any> {
  success: boolean;
  context: TContext;
  executedSteps: string[];
  failedStep?: string;
  compensatedSteps: string[];
  error?: string;
}

export class SagaOrchestrator<TContext = any> {
  private steps: SagaStep<TContext>[] = [];

  public addStep(step: SagaStep<TContext>): this {
    this.steps.push(step);
    return this;
  }

  /**
   * Executes the saga steps in sequence.
   * If any step fails, automatically triggers compensating actions in reverse order.
   */
  public async execute(initialContext: TContext): Promise<SagaResult<TContext>> {
    const executedSteps: SagaStep<TContext>[] = [];
    const compensatedStepNames: string[] = [];
    const context = { ...initialContext };

    for (const step of this.steps) {
      try {
        console.log(`[SAGA] Executing step: "${step.name}"`);
        await step.execute(context);
        executedSteps.push(step);
      } catch (stepError: any) {
        console.error(`[SAGA] Step "${step.name}" FAILED:`, stepError?.message || stepError);

        // Run compensating actions in reverse order for all completed steps
        const toCompensate = [...executedSteps].reverse();
        for (const compStep of toCompensate) {
          try {
            console.log(`[SAGA-COMPENSATION] Compensating step: "${compStep.name}"`);
            await compStep.compensate(context);
            compensatedStepNames.push(compStep.name);
          } catch (compErr: any) {
            console.error(`[SAGA-COMPENSATION ERROR] Failed to compensate "${compStep.name}":`, compErr?.message || compErr);
          }
        }

        return {
          success: false,
          context,
          executedSteps: executedSteps.map((s) => s.name),
          failedStep: step.name,
          compensatedSteps: compensatedStepNames,
          error: stepError?.message || String(stepError),
        };
      }
    }

    return {
      success: true,
      context,
      executedSteps: executedSteps.map((s) => s.name),
      compensatedSteps: [],
    };
  }
}
