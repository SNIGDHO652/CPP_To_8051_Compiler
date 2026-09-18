import {
    CONTROL_FLOW_OPS,
    SIDE_EFFECT_OPS,
    formatInstruction,
    isSchedulableInstruction,
    partitionBasicBlocks
} from "../ir/ir.js";

/**
 * Latencies are educational scheduling weights, not official 8051 cycle counts.
 * They simply make the scheduler prefer expensive operations on the critical
 * path, which is a common list-scheduling heuristic.
 */
const LATENCY = {
    MOV: 1,
    INC: 1,
    DEC: 1,
    ADD: 1,
    SUB: 1,
    AND: 1,
    OR: 1,
    XOR: 1,
    BNOT: 1,
    NEG: 1,
    LNOT: 1,
    EQ: 1,
    NE: 1,
    LT: 1,
    LE: 1,
    GT: 1,
    GE: 1,
    SHL: 2,
    SHR: 2,
    MUL: 4,
    DIV: 6,
    MOD: 6
};

/**
 * Performs conservative list scheduling inside basic blocks only.
 *
 * Important distinction:
 * Tomasulo is dynamic hardware scheduling. This class is compile-time static
 * scheduling inspired by the same dependency reasoning. It never moves an
 * instruction across a branch, label, return, or hardware-port side effect.
 */
export class InstructionScheduler {
    schedule(instructions, dependencyGraph) {
        const blocks = partitionBasicBlocks(instructions);
        const scheduled = [];
        const blockReports = [];

        for (const block of blocks) {
            const result = this.scheduleBlock(block, dependencyGraph);

            scheduled.push(...result.instructions);
            blockReports.push(result.report);
        }

        return {
            instructions: scheduled,
            blocks: blockReports
        };
    }

    scheduleBlock(block, dependencyGraph) {
        // A block can contain a leading label or a trailing control instruction.
        // These stay fixed. Only the pure middle region is reordered.
        const prefix = [];
        const suffix = [];
        const body = [...block.instructions];

        while (body.length > 0 && body[0].op === "LABEL") {
            prefix.push(body.shift());
        }

        while (
            body.length > 0 &&
            (
                CONTROL_FLOW_OPS.has(body[body.length - 1].op) ||
                SIDE_EFFECT_OPS.has(body[body.length - 1].op)
            )
        ) {
            suffix.unshift(body.pop());
        }

        // If any remaining instruction is itself a barrier, preserve the entire
        // block. This keeps the algorithm simple and safe for an educational
        // compiler.
        if (body.some((instruction) => !isSchedulableInstruction(instruction))) {
            return {
                instructions: block.instructions,
                report: {
                    blockId: block.id,
                    changed: false,
                    original: block.instructions.map(formatInstruction),
                    scheduled: block.instructions.map(formatInstruction)
                }
            };
        }

        const bodyIds = new Set(body.map((instruction) => instruction.id));
        const predecessorIds = new Map(
            body.map((instruction) => [instruction.id, new Set()])
        );

        for (const edge of dependencyGraph.edges) {
            if (bodyIds.has(edge.from) && bodyIds.has(edge.to)) {
                predecessorIds.get(edge.to).add(edge.from);
            }
        }

        const remaining = new Map(
            body.map((instruction, index) => [
                instruction.id,
                {
                    instruction,
                    sourceIndex: index
                }
            ])
        );

        const emitted = new Set();
        const ordered = [];

        while (remaining.size > 0) {
            const ready = [...remaining.values()].filter(({ instruction }) =>
                [...predecessorIds.get(instruction.id)].every(
                    (predecessorId) => emitted.has(predecessorId)
                )
            );

            if (ready.length === 0) {
                // Dependency graphs for a valid straight-line block should be
                // acyclic. Falling back to source order is safer than emitting
                // partially scheduled code if a future IR extension violates
                // that assumption.
                ordered.push(
                    ...[...remaining.values()]
                        .sort((a, b) => a.sourceIndex - b.sourceIndex)
                        .map((entry) => entry.instruction)
                );
                break;
            }

            ready.sort((left, right) => {
                const latencyDifference =
                    this.latency(right.instruction.op) -
                    this.latency(left.instruction.op);

                if (latencyDifference !== 0) {
                    return latencyDifference;
                }

                return left.sourceIndex - right.sourceIndex;
            });

            const chosen = ready[0];

            ordered.push(chosen.instruction);
            emitted.add(chosen.instruction.id);
            remaining.delete(chosen.instruction.id);
        }

        const result = [...prefix, ...ordered, ...suffix];

        return {
            instructions: result,
            report: {
                blockId: block.id,
                changed:
                    result.map((instruction) => instruction.id).join(",") !==
                    block.instructions.map((instruction) => instruction.id).join(","),
                original: block.instructions.map(formatInstruction),
                scheduled: result.map(formatInstruction)
            }
        };
    }

    latency(op) {
        return LATENCY[op] ?? 1;
    }
}

export function schedulingLatency(op) {
    return LATENCY[op] ?? 1;
}
