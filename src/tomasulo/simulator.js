import {
    formatInstruction,
    getInstructionAccess,
    isSchedulableInstruction,
    operandKey,
    partitionBasicBlocks
} from "../ir/ir.js";
import { schedulingLatency } from "../scheduler/instruction-scheduler.js";

/**
 * Reservation-station groups used by the educational Tomasulo simulator.
 *
 * The 8051 itself does NOT contain these structures. They model a hypothetical
 * out-of-order machine so students can see instruction-level parallelism in the
 * compiler's IR before the real sequential 8051 backend is emitted.
 */
const STATION_LAYOUT = [
    { prefix: "Load", count: 2, kinds: new Set(["MOV", "INC", "DEC"]) },
    {
        prefix: "Add",
        count: 3,
        kinds: new Set([
            "ADD",
            "SUB",
            "AND",
            "OR",
            "XOR",
            "BNOT",
            "NEG",
            "LNOT",
            "EQ",
            "NE",
            "LT",
            "LE",
            "GT",
            "GE",
            "SHL",
            "SHR"
        ])
    },
    { prefix: "Mul", count: 2, kinds: new Set(["MUL"]) },
    { prefix: "Div", count: 2, kinds: new Set(["DIV", "MOD"]) }
];

function createStations() {
    const stations = [];

    for (const group of STATION_LAYOUT) {
        for (let index = 1; index <= group.count; index += 1) {
            stations.push({
                name: `${group.prefix}${index}`,
                acceptedOps: group.kinds,
                busy: false,
                instruction: null,
                op: null,
                qj: null,
                qk: null,
                vj: null,
                vk: null,
                destination: null,
                remaining: 0,
                issueCycle: null,
                executeStart: null,
                executeEnd: null,
                readyToWrite: false
            });
        }
    }

    return stations;
}

function clearStation(station) {
    station.busy = false;
    station.instruction = null;
    station.op = null;
    station.qj = null;
    station.qk = null;
    station.vj = null;
    station.vk = null;
    station.destination = null;
    station.remaining = 0;
    station.issueCycle = null;
    station.executeStart = null;
    station.executeEnd = null;
    station.readyToWrite = false;
}

function operandLabel(operand) {
    if (!operand) {
        return "-";
    }

    if (operand.kind === "immediate") {
        return `#${operand.value}`;
    }

    return operandKey(operand) ?? "-";
}

/**
 * Simulates Tomasulo one basic block at a time.
 *
 * Why per basic block?
 * Compile time generally does not know which branch a runtime program will
 * take or how many times a loop will iterate. Basic blocks avoid pretending we
 * know dynamic control flow while still demonstrating issue, execution,
 * register renaming, reservation stations, wake-up, and common-data-bus write
 * back for straight-line instruction sequences.
 */
export class TomasuloSimulator {
    run(instructions) {
        const blocks = partitionBasicBlocks(instructions);
        const snapshots = [];
        const timings = [];
        const blockSummaries = [];

        for (const block of blocks) {
            const candidates = block.instructions.filter(isSchedulableInstruction);

            if (candidates.length === 0) {
                continue;
            }

            const result = this.runBlock(block.id, candidates);

            snapshots.push(...result.snapshots);
            timings.push(...result.timings);
            blockSummaries.push({
                blockId: block.id,
                instructionCount: candidates.length,
                cycles: result.cycles
            });
        }

        return {
            snapshots,
            timings,
            blocks: blockSummaries,
            totalAnalyzedInstructions: timings.length
        };
    }

    runBlock(blockId, instructions) {
        const stations = createStations();
        const registerStatus = new Map();
        const timings = new Map(
            instructions.map((instruction) => [
                instruction.id,
                {
                    blockId,
                    instructionId: instruction.id,
                    instruction: formatInstruction(instruction),
                    issue: null,
                    executeStart: null,
                    executeEnd: null,
                    write: null,
                    station: null
                }
            ])
        );

        let nextIssueIndex = 0;
        let cycle = 0;
        const snapshots = [];

        // Hard cap protects the UI from a simulator bug causing an infinite
        // loop. A normal block finishes far before this limit.
        const maximumCycles = Math.max(100, instructions.length * 30);

        while (
            !this.isComplete(nextIssueIndex, instructions, stations) &&
            cycle < maximumCycles
        ) {
            cycle += 1;
            const events = [];

            this.writeOneResult(
                cycle,
                stations,
                registerStatus,
                timings,
                events
            );

            this.advanceExecution(
                cycle,
                stations,
                timings,
                events
            );

            if (nextIssueIndex < instructions.length) {
                const instruction = instructions[nextIssueIndex];
                const station = this.findFreeStation(stations, instruction.op);

                if (station) {
                    this.issue(
                        instruction,
                        station,
                        cycle,
                        registerStatus,
                        timings,
                        events
                    );

                    nextIssueIndex += 1;
                }
            }

            snapshots.push(
                this.snapshot(
                    blockId,
                    cycle,
                    stations,
                    registerStatus,
                    events
                )
            );
        }

        if (cycle >= maximumCycles) {
            throw new Error(
                `Tomasulo simulation exceeded ${maximumCycles} cycles in block ${blockId}.`
            );
        }

        return {
            cycles: cycle,
            snapshots,
            timings: [...timings.values()]
        };
    }

    isComplete(nextIssueIndex, instructions, stations) {
        return (
            nextIssueIndex >= instructions.length &&
            stations.every((station) => !station.busy)
        );
    }

    findFreeStation(stations, op) {
        return stations.find(
            (station) =>
                !station.busy &&
                station.acceptedOps.has(op)
        );
    }

    issue(
        instruction,
        station,
        cycle,
        registerStatus,
        timings,
        events
    ) {
        station.busy = true;
        station.instruction = instruction;
        station.op = instruction.op;
        station.destination =
            instruction.dest ? operandKey(instruction.dest) : null;
        station.remaining = schedulingLatency(instruction.op);
        station.issueCycle = cycle;

        const operands = this.logicalSourceOperands(instruction);

        this.captureOperand(
            station,
            "j",
            operands[0] ?? null,
            registerStatus
        );

        this.captureOperand(
            station,
            "k",
            operands[1] ?? null,
            registerStatus
        );

        // Updating registerStatus here is the renaming step: later consumers
        // wait for this reservation-station tag instead of an architectural
        // register name.
        if (station.destination) {
            registerStatus.set(
                station.destination,
                station.name
            );
        }

        const timing = timings.get(instruction.id);

        timing.issue = cycle;
        timing.station = station.name;

        events.push(
            `Issue ${instruction.id} -> ${station.name}`
        );
    }

    logicalSourceOperands(instruction) {
        if (instruction.op === "INC" || instruction.op === "DEC") {
            return [instruction.dest];
        }

        return instruction.args;
    }

    captureOperand(station, slot, operand, registerStatus) {
        const key = operandKey(operand);
        const qField = slot === "j" ? "qj" : "qk";
        const vField = slot === "j" ? "vj" : "vk";

        if (!operand) {
            station[qField] = null;
            station[vField] = null;
            return;
        }

        if (key && registerStatus.has(key)) {
            station[qField] = registerStatus.get(key);
            station[vField] = null;
            return;
        }

        station[qField] = null;
        station[vField] = operandLabel(operand);
    }

    advanceExecution(cycle, stations, timings, events) {
        for (const station of stations) {
            if (
                !station.busy ||
                station.readyToWrite ||
                station.qj ||
                station.qk
            ) {
                continue;
            }

            // Execution begins no earlier than the cycle after issue. This
            // keeps issue and execute visually distinct in the timeline.
            if (cycle <= station.issueCycle) {
                continue;
            }

            if (station.executeStart === null) {
                station.executeStart = cycle;
                timings.get(station.instruction.id).executeStart = cycle;

                events.push(
                    `Start ${station.instruction.id} in ${station.name}`
                );
            }

            station.remaining -= 1;

            if (station.remaining === 0) {
                station.executeEnd = cycle;
                station.readyToWrite = true;

                timings.get(station.instruction.id).executeEnd = cycle;

                events.push(
                    `Finish ${station.instruction.id} in ${station.name}`
                );
            }
        }
    }

    writeOneResult(
        cycle,
        stations,
        registerStatus,
        timings,
        events
    ) {
        // One common data bus means at most one completed result is broadcast
        // per cycle. Oldest completion wins for deterministic visualization.
        const writer = stations
            .filter(
                (station) =>
                    station.busy &&
                    station.readyToWrite &&
                    station.executeEnd < cycle
            )
            .sort(
                (left, right) =>
                    left.executeEnd - right.executeEnd ||
                    left.issueCycle - right.issueCycle
            )[0];

        if (!writer) {
            return;
        }

        const tag = writer.name;
        const destination = writer.destination;

        for (const station of stations) {
            if (!station.busy || station === writer) {
                continue;
            }

            if (station.qj === tag) {
                station.qj = null;
                station.vj = `<${destination ?? tag}>`;
            }

            if (station.qk === tag) {
                station.qk = null;
                station.vk = `<${destination ?? tag}>`;
            }
        }

        // Only clear the architectural rename if this station is still the
        // youngest producer. This is the key WAW-safe behavior of renaming.
        if (
            destination &&
            registerStatus.get(destination) === tag
        ) {
            registerStatus.delete(destination);
        }

        timings.get(writer.instruction.id).write = cycle;

        events.push(
            `Write ${writer.instruction.id} from ${tag}` +
            (destination ? ` -> ${destination}` : "")
        );

        clearStation(writer);
    }

    snapshot(blockId, cycle, stations, registerStatus, events) {
        return {
            blockId,
            cycle,
            events: [...events],
            stations: stations.map((station) => ({
                name: station.name,
                busy: station.busy,
                op: station.op ?? "-",
                instructionId: station.instruction?.id ?? "-",
                vj: station.vj ?? "-",
                vk: station.vk ?? "-",
                qj: station.qj ?? "-",
                qk: station.qk ?? "-",
                destination: station.destination ?? "-",
                remaining: station.busy ? station.remaining : "-"
            })),
            registerStatus: [...registerStatus.entries()].map(
                ([register, producer]) => ({
                    register,
                    producer
                })
            )
        };
    }
}
