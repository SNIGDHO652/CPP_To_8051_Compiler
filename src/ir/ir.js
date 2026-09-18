/**
 * Shared helpers for C++51's three-address intermediate representation (IR).
 *
 * Why an IR exists:
 * The AST mirrors source syntax, which is excellent for parsing but awkward for
 * scheduling. Tomasulo's algorithm is easier to explain when each instruction
 * has one explicit destination and a small list of explicit inputs.
 *
 * Example:
 *     c = a + b;
 *
 * becomes:
 *     I0: ADD t0, a, b
 *     I1: MOV c, t0
 */

export const CONTROL_FLOW_OPS = new Set([
    "LABEL",
    "JMP",
    "JZ",
    "JNZ",
    "RETURN"
]);

export const SIDE_EFFECT_OPS = new Set([
    "PORT_WRITE"
]);

/**
 * Returns true when an instruction can be considered for reordering inside a
 * basic block. Branches and port writes are barriers because moving code across
 * them could change visible program behavior.
 */
export function isSchedulableInstruction(instruction) {
    return (
        !CONTROL_FLOW_OPS.has(instruction.op) &&
        !SIDE_EFFECT_OPS.has(instruction.op)
    );
}

/**
 * Operands are deliberately tiny tagged objects. Keeping them structured avoids
 * fragile string parsing later in dependency analysis and the Tomasulo model.
 */
export function immediate(value) {
    return {
        kind: "immediate",
        value
    };
}

export function temporary(name) {
    return {
        kind: "temporary",
        name
    };
}

export function symbolOperand(symbol) {
    return {
        kind: "symbol",
        name: symbol.name,
        asmName: symbol.asmName,
        symbolKind: symbol.kind
    };
}

/**
 * Every temporary and source-level variable is treated as a logical register
 * for dependency analysis. Immediate constants have no register identity.
 */
export function operandKey(operand) {
    if (!operand) {
        return null;
    }

    if (operand.kind === "temporary") {
        return operand.name;
    }

    if (operand.kind === "symbol") {
        return operand.asmName;
    }

    return null;
}

export function formatOperand(operand) {
    if (!operand) {
        return "";
    }

    if (operand.kind === "immediate") {
        return String(operand.value);
    }

    if (operand.kind === "temporary") {
        return operand.name;
    }

    if (operand.kind === "symbol") {
        return operand.name;
    }

    return "?";
}

export function formatInstruction(instruction) {
    const id = `${instruction.id}:`.padEnd(6);

    switch (instruction.op) {
        case "LABEL":
            return `${id}${instruction.label}:`;

        case "JMP":
            return `${id}JMP ${instruction.target}`;

        case "JZ":
        case "JNZ":
            return (
                `${id}${instruction.op} ` +
                `${formatOperand(instruction.args[0])}, ${instruction.target}`
            );

        case "RETURN":
            return instruction.args.length > 0
                ? `${id}RETURN ${formatOperand(instruction.args[0])}`
                : `${id}RETURN`;

        case "PORT_WRITE":
            return (
                `${id}PORT_WRITE ${formatOperand(instruction.dest)}, ` +
                `${formatOperand(instruction.args[0])}`
            );

        case "MOV":
            return (
                `${id}MOV ${formatOperand(instruction.dest)}, ` +
                `${formatOperand(instruction.args[0])}`
            );

        case "INC":
        case "DEC":
            return `${id}${instruction.op} ${formatOperand(instruction.dest)}`;

        default:
            return (
                `${id}${instruction.op} ${formatOperand(instruction.dest)}, ` +
                instruction.args.map(formatOperand).join(", ")
            ).replace(/,\s*$/, "");
    }
}

/**
 * Compute logical read/write sets for dependency analysis.
 *
 * These sets are about program values, not physical 8051 registers. The
 * Tomasulo model uses the same logical names so it can demonstrate renaming.
 */
export function getInstructionAccess(instruction) {
    const reads = new Set();
    const writes = new Set();

    const addRead = (operand) => {
        const key = operandKey(operand);

        if (key) {
            reads.add(key);
        }
    };

    const addWrite = (operand) => {
        const key = operandKey(operand);

        if (key) {
            writes.add(key);
        }
    };

    switch (instruction.op) {
        case "LABEL":
        case "JMP":
            break;

        case "JZ":
        case "JNZ":
        case "RETURN":
            instruction.args.forEach(addRead);
            break;

        case "PORT_WRITE":
            instruction.args.forEach(addRead);
            break;

        case "INC":
        case "DEC":
            addRead(instruction.dest);
            addWrite(instruction.dest);
            break;

        default:
            instruction.args.forEach(addRead);
            addWrite(instruction.dest);
            break;
    }

    return {
        reads,
        writes
    };
}

/**
 * Split IR into basic blocks.
 *
 * A basic block has one entry and no internal branch target. This is the safe
 * unit for local static instruction scheduling and our Tomasulo visualization.
 */
export function partitionBasicBlocks(instructions) {
    const blocks = [];
    let current = [];

    const flush = () => {
        if (current.length === 0) {
            return;
        }

        blocks.push({
            id: blocks.length,
            instructions: current
        });

        current = [];
    };

    for (const instruction of instructions) {
        if (instruction.op === "LABEL") {
            flush();
            current.push(instruction);
            continue;
        }

        current.push(instruction);

        if (
            CONTROL_FLOW_OPS.has(instruction.op) ||
            SIDE_EFFECT_OPS.has(instruction.op)
        ) {
            flush();
        }
    }

    flush();

    return blocks;
}
