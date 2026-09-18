import {
    getInstructionAccess,
    partitionBasicBlocks
} from "../ir/ir.js";

/**
 * Builds RAW/WAR/WAW dependencies for every basic block.
 *
 * RAW: current instruction reads a value written by an earlier instruction.
 * WAR: current instruction writes a value an earlier instruction still reads.
 * WAW: two instructions write the same logical destination.
 *
 * Tomasulo's register renaming removes WAR/WAW hazards in hardware, while RAW
 * is a true data dependency and cannot be removed. The static 8051 scheduler
 * conservatively preserves all three kinds.
 */
export class DependencyAnalyzer {
    analyze(instructions) {
        const blocks = partitionBasicBlocks(instructions);
        const edges = [];

        for (const block of blocks) {
            this.analyzeBlock(block, edges);
        }

        const predecessors = new Map();
        const successors = new Map();

        for (const instruction of instructions) {
            predecessors.set(instruction.id, []);
            successors.set(instruction.id, []);
        }

        for (const edge of edges) {
            predecessors.get(edge.to)?.push(edge);
            successors.get(edge.from)?.push(edge);
        }

        return {
            blocks,
            edges,
            predecessors,
            successors
        };
    }

    analyzeBlock(block, edges) {
        const instructions = block.instructions;

        for (let currentIndex = 0; currentIndex < instructions.length; currentIndex += 1) {
            const current = instructions[currentIndex];
            const currentAccess = getInstructionAccess(current);

            for (let priorIndex = 0; priorIndex < currentIndex; priorIndex += 1) {
                const prior = instructions[priorIndex];
                const priorAccess = getInstructionAccess(prior);

                this.addHazards(
                    prior,
                    current,
                    priorAccess,
                    currentAccess,
                    block.id,
                    edges
                );
            }
        }
    }

    addHazards(prior, current, priorAccess, currentAccess, blockId, edges) {
        const add = (type, register) => {
            // Avoid duplicate edges when the same instruction pair conflicts
            // through more than one rule on the same logical value.
            if (
                !edges.some(
                    (edge) =>
                        edge.from === prior.id &&
                        edge.to === current.id &&
                        edge.type === type &&
                        edge.register === register
                )
            ) {
                edges.push({
                    from: prior.id,
                    to: current.id,
                    type,
                    register,
                    blockId
                });
            }
        };

        for (const register of priorAccess.writes) {
            if (currentAccess.reads.has(register)) {
                add("RAW", register);
            }

            if (currentAccess.writes.has(register)) {
                add("WAW", register);
            }
        }

        for (const register of priorAccess.reads) {
            if (currentAccess.writes.has(register)) {
                add("WAR", register);
            }
        }
    }
}
