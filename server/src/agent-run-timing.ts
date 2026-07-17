export type AgentRunTimingEntry = {
  time: string;
  level: "INFO" | "ERROR";
  msg: "AGENT_RUN_TIMING";
  component: "vibe-design";
  scope: "agent.run";
  event: string;
  run_id: string;
  provider: string;
  agent_target_id: string;
  total_elapsed_ms: number;
  [key: string]: unknown;
};

export function createAgentRunTimingLogger(
  input: { runId: string; provider: string; agentTargetId: string },
  options: {
    now?: () => number;
    sink?: (entry: AgentRunTimingEntry) => void;
  } = {},
) {
  const now = options.now ?? Date.now;
  const startedAt = now();
  const sink =
    options.sink ??
    ((entry: AgentRunTimingEntry) => {
      console.info(JSON.stringify(entry));
    });

  function emit(
    event: string,
    fields: Record<string, unknown> = {},
    level: "INFO" | "ERROR" = "INFO",
  ) {
    const timestamp = now();
    sink({
      time: new Date(timestamp).toISOString(),
      level,
      msg: "AGENT_RUN_TIMING",
      component: "vibe-design",
      scope: "agent.run",
      event,
      run_id: input.runId,
      provider: input.provider,
      agent_target_id: input.agentTargetId,
      total_elapsed_ms: Math.max(0, timestamp - startedAt),
      ...fields,
    });
  }

  async function measure<T>(
    phase: "prepare" | "run" | "cleanup",
    stage: string,
    action: () => Promise<T> | T,
    fields: Record<string, unknown> = {},
  ): Promise<T> {
    const stageStartedAt = now();
    try {
      const result = await action();
      emit("agent_stage_done", {
        phase,
        stage,
        elapsed_ms: Math.max(0, now() - stageStartedAt),
        ...fields,
      });
      return result;
    } catch (error) {
      emit(
        "agent_stage_failed",
        {
          phase,
          stage,
          elapsed_ms: Math.max(0, now() - stageStartedAt),
          error_name: error instanceof Error ? error.name : "unknown",
          ...fields,
        },
        "ERROR",
      );
      throw error;
    }
  }

  return {
    emit,
    measure,
    elapsed: () => Math.max(0, now() - startedAt),
  };
}

export type AgentRunTimingLogger = ReturnType<typeof createAgentRunTimingLogger>;
