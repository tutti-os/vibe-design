import { describe, expect, it } from "vitest";
import {
  createAgentRunTimingLogger,
  type AgentRunTimingEntry,
} from "./agent-run-timing.js";

describe("createAgentRunTimingLogger", () => {
  it("emits structured timing fields without project paths or credentials", async () => {
    let now = 1_000;
    const entries: AgentRunTimingEntry[] = [];
    const log = createAgentRunTimingLogger(
      {
        runId: "run-1",
        provider: "codex",
        agentTargetId: "local:codex",
      },
      { now: () => now, sink: (entry) => entries.push(entry) },
    );

    await log.measure("prepare", "skill_context", async () => {
      now = 1_025;
    });
    log.emit("agent_execution_started", { model: "gpt-5.4" });

    expect(entries).toEqual([
      expect.objectContaining({
        msg: "AGENT_RUN_TIMING",
        event: "agent_stage_done",
        phase: "prepare",
        stage: "skill_context",
        elapsed_ms: 25,
        total_elapsed_ms: 25,
      }),
      expect.objectContaining({
        event: "agent_execution_started",
        provider: "codex",
        agent_target_id: "local:codex",
      }),
    ]);
    expect(JSON.stringify(entries)).not.toContain("cwd");
    expect(JSON.stringify(entries)).not.toContain("credential");
  });
});
