import {
    immediate,
    symbolOperand,
    temporary
} from "./ir.js";

/**
 * Lowers the optimized AST into simple three-address IR.
 *
 * The generated IR is intentionally machine-independent. It is not 8051
 * assembly and it does not know about ACC/B/R6/R7. That separation is what
 * allows the compiler to run dependency analysis and a Tomasulo simulation
 * before the target-specific backend.
 */
export class IRGenerator {
    constructor() {
        this.instructions = [];
        this.nextInstructionId = 0;
        this.nextTemporaryId = 0;
        this.nextLabelId = 0;
        this.loopStack = [];
    }

    generate(program) {
        this.generateStatement(program.body);

        return this.instructions;
    }

    emit(op, { dest = null, args = [], label = null, target = null } = {}) {
        const instruction = {
            id: `I${this.nextInstructionId++}`,
            op,
            dest,
            args,
            label,
            target
        };

        this.instructions.push(instruction);
        return instruction;
    }

    newTemporary() {
        return temporary(`t${this.nextTemporaryId++}`);
    }

    newLabel(prefix) {
        return `${prefix}_${this.nextLabelId++}`;
    }

    generateStatement(statement) {
        switch (statement.type) {
            case "VariableDeclaration": {
                const value = this.generateExpression(statement.initializer);

                this.emit("MOV", {
                    dest: symbolOperand(statement.symbol),
                    args: [value]
                });
                return;
            }

            case "AssignmentStatement": {
                const value = this.generateExpression(statement.value);
                const destination = symbolOperand(statement.symbol);

                if (statement.symbol.kind === "port") {
                    // Ports are observable hardware side effects, so they are
                    // represented by an explicit scheduling barrier.
                    this.emit("PORT_WRITE", {
                        dest: destination,
                        args: [value]
                    });
                } else {
                    this.emit("MOV", {
                        dest: destination,
                        args: [value]
                    });
                }
                return;
            }

            case "UpdateStatement":
                this.emit(
                    statement.operator === "++" ? "INC" : "DEC",
                    {
                        dest: symbolOperand(statement.symbol)
                    }
                );
                return;

            case "IfStatement":
                this.generateIf(statement);
                return;

            case "WhileStatement":
                this.generateWhile(statement);
                return;

            case "BreakStatement": {
                const loop = this.loopStack[this.loopStack.length - 1];

                this.emit("JMP", {
                    target: loop.end
                });
                return;
            }

            case "ContinueStatement": {
                const loop = this.loopStack[this.loopStack.length - 1];

                this.emit("JMP", {
                    target: loop.start
                });
                return;
            }

            case "ReturnStatement": {
                const args = statement.value
                    ? [this.generateExpression(statement.value)]
                    : [];

                this.emit("RETURN", {
                    args
                });
                return;
            }

            case "BlockStatement":
                for (const child of statement.statements) {
                    this.generateStatement(child);
                }
                return;

            default:
                throw new Error(`Cannot lower statement "${statement.type}" to IR.`);
        }
    }

    generateIf(statement) {
        const elseLabel = this.newLabel("IF_ELSE");
        const endLabel = this.newLabel("IF_END");
        const condition = this.generateExpression(statement.condition);

        this.emit("JZ", {
            args: [condition],
            target: statement.alternate ? elseLabel : endLabel
        });

        this.generateStatement(statement.consequent);

        if (statement.alternate) {
            this.emit("JMP", {
                target: endLabel
            });

            this.emit("LABEL", {
                label: elseLabel
            });

            this.generateStatement(statement.alternate);
        }

        this.emit("LABEL", {
            label: endLabel
        });
    }

    generateWhile(statement) {
        const startLabel = this.newLabel("WHILE_START");
        const endLabel = this.newLabel("WHILE_END");

        this.emit("LABEL", {
            label: startLabel
        });

        const condition = this.generateExpression(statement.condition);

        this.emit("JZ", {
            args: [condition],
            target: endLabel
        });

        this.loopStack.push({
            start: startLabel,
            end: endLabel
        });

        this.generateStatement(statement.body);
        this.loopStack.pop();

        this.emit("JMP", {
            target: startLabel
        });

        this.emit("LABEL", {
            label: endLabel
        });
    }

    generateExpression(expression) {
        switch (expression.type) {
            case "Literal":
                return immediate(expression.value);

            case "Identifier":
                return symbolOperand(expression.symbol);

            case "UnaryExpression": {
                const argument = this.generateExpression(expression.argument);
                const destination = this.newTemporary();

                const op = {
                    "!": "LNOT",
                    "~": "BNOT",
                    "-": "NEG"
                }[expression.operator];

                this.emit(op, {
                    dest: destination,
                    args: [argument]
                });

                return destination;
            }

            case "BinaryExpression":
                return this.generateBinaryExpression(expression);

            default:
                throw new Error(`Cannot lower expression "${expression.type}" to IR.`);
        }
    }

    generateBinaryExpression(expression) {
        // && and || are lowered with branches so the IR preserves C++
        // short-circuit semantics instead of evaluating both operands eagerly.
        if (expression.operator === "&&") {
            return this.generateLogicalAnd(expression);
        }

        if (expression.operator === "||") {
            return this.generateLogicalOr(expression);
        }

        const left = this.generateExpression(expression.left);
        const right = this.generateExpression(expression.right);
        const destination = this.newTemporary();

        const op = {
            "+": "ADD",
            "-": "SUB",
            "*": "MUL",
            "/": "DIV",
            "%": "MOD",
            "&": "AND",
            "|": "OR",
            "^": "XOR",
            "<<": "SHL",
            ">>": "SHR",
            "==": "EQ",
            "!=": "NE",
            "<": "LT",
            "<=": "LE",
            ">": "GT",
            ">=": "GE"
        }[expression.operator];

        this.emit(op, {
            dest: destination,
            args: [left, right]
        });

        return destination;
    }

    generateLogicalAnd(expression) {
        const destination = this.newTemporary();
        const falseLabel = this.newLabel("LAND_FALSE");
        const endLabel = this.newLabel("LAND_END");

        const left = this.generateExpression(expression.left);

        this.emit("JZ", {
            args: [left],
            target: falseLabel
        });

        const right = this.generateExpression(expression.right);

        this.emit("JZ", {
            args: [right],
            target: falseLabel
        });

        this.emit("MOV", {
            dest: destination,
            args: [immediate(1)]
        });

        this.emit("JMP", {
            target: endLabel
        });

        this.emit("LABEL", {
            label: falseLabel
        });

        this.emit("MOV", {
            dest: destination,
            args: [immediate(0)]
        });

        this.emit("LABEL", {
            label: endLabel
        });

        return destination;
    }

    generateLogicalOr(expression) {
        const destination = this.newTemporary();
        const trueLabel = this.newLabel("LOR_TRUE");
        const endLabel = this.newLabel("LOR_END");

        const left = this.generateExpression(expression.left);

        this.emit("JNZ", {
            args: [left],
            target: trueLabel
        });

        const right = this.generateExpression(expression.right);

        this.emit("JNZ", {
            args: [right],
            target: trueLabel
        });

        this.emit("MOV", {
            dest: destination,
            args: [immediate(0)]
        });

        this.emit("JMP", {
            target: endLabel
        });

        this.emit("LABEL", {
            label: trueLabel
        });

        this.emit("MOV", {
            dest: destination,
            args: [immediate(1)]
        });

        this.emit("LABEL", {
            label: endLabel
        });

        return destination;
    }
}
