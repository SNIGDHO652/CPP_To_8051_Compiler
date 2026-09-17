import { CompileError } from "./errors.js";

/**
 * Converts the optimized AST into Intel 8051 assembly.
 *
 * Expression convention:
 * - Every expression leaves its final 8-bit result in ACC (register A).
 * - For binary operators, the left side is temporarily pushed on the 8051
 *   hardware stack, the right side is evaluated, then the left side is popped
 *   into B. At that point:
 *
 *       A = right operand
 *       B = left operand
 *
 * - R6 and R7 are scratch registers used by division and shifts.
 *
 * Memory convention:
 * - 30H-6FH: user variables.
 * - SP starts at 6FH, so pushes use 70H-7FH.
 */
export class CodeGenerator {
    constructor(symbols) {
        this.symbols = symbols;
        this.lines = [];
        this.labelCounter = 0;
        this.instructionCount = 0;
        this.currentStackDepth = 0;
        this.maximumStackDepth = 0;
        this.loopStack = [];
    }

    generate(program) {
        this.emit("; ==================================================");
        this.emit("; C++51 Compiler");
        this.emit("; C++ subset -> Intel 8051 assembly");
        this.emit("; Unsigned 8-bit arithmetic");
        this.emit("; ==================================================");
        this.emit("");

        this.emit("; ---------------- Variable Allocation ----------------");

        if (this.symbols.length === 0) {
            this.emit("; No local variables");
        } else {
            for (const symbol of this.symbols) {
                this.emit(
                    `${symbol.asmName} EQU ${this.hex(symbol.address)}`
                );
            }
        }

        this.emit("");
        this.emit("ORG 0000H");
        this.emitInstruction("LJMP START");
        this.emit("");
        this.emit("ORG 0030H");
        this.emit("");
        this.emit("START:");

        // By placing SP at 6FH, the first PUSH writes to 70H.
        this.emitInstruction("MOV SP,#06FH");

        this.generateStatement(program.body);

        // If execution reaches the end of main without return, halt anyway.
        this.emitInstruction("LJMP PROGRAM_END");
        this.emit("");
        this.emit("PROGRAM_END:");
        this.emitInstruction("SJMP PROGRAM_END");
        this.emit("");
        this.emit("END");

        if (this.maximumStackDepth > 16) {
            throw new CompileError(
                `Expression needs ${this.maximumStackDepth} stack bytes, ` +
                    "but only 16 bytes are reserved."
            );
        }

        return {
            assembly: this.lines.join("\n"),
            instructionCount: this.instructionCount,
            maximumStackDepth: this.maximumStackDepth
        };
    }

    generateStatement(statement) {
        switch (statement.type) {
            case "VariableDeclaration":
                this.generateExpression(statement.initializer);
                this.emitInstruction(
                    `MOV ${statement.symbol.asmName},A`
                );
                return;

            case "AssignmentStatement":
                this.generateExpression(statement.value);
                this.emitInstruction(
                    `MOV ${statement.symbol.asmName},A`
                );
                return;

            case "UpdateStatement":
                this.emitInstruction(
                    `${statement.operator === "++" ? "INC" : "DEC"} ` +
                        `${statement.symbol.asmName}`
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
                this.emitInstruction(`LJMP ${loop.end}`);
                return;
            }

            case "ContinueStatement": {
                const loop = this.loopStack[this.loopStack.length - 1];
                this.emitInstruction(`LJMP ${loop.start}`);
                return;
            }

            case "ReturnStatement":
                // The 8051 bare-metal target has no OS caller waiting for an
                // exit code. We still evaluate the C++ return expression so
                // compiler behavior stays deterministic, then halt.
                this.generateExpression(statement.value);
                this.emitInstruction("LJMP PROGRAM_END");
                return;

            case "BlockStatement":
                for (const child of statement.statements) {
                    this.generateStatement(child);
                }
                return;

            default:
                throw new CompileError(
                    `Cannot generate statement "${statement.type}".`
                );
        }
    }

    generateIf(statement) {
        const elseLabel = this.newLabel("IF_ELSE");
        const endLabel = this.newLabel("IF_END");

        this.generateExpression(statement.condition);

        this.jumpIfZeroFar(
            statement.alternate ? elseLabel : endLabel
        );

        this.generateStatement(statement.consequent);

        if (statement.alternate) {
            this.emitInstruction(`LJMP ${endLabel}`);
            this.emit(`${elseLabel}:`);
            this.generateStatement(statement.alternate);
        }

        this.emit(`${endLabel}:`);
    }

    generateWhile(statement) {
        const startLabel = this.newLabel("WHILE_START");
        const endLabel = this.newLabel("WHILE_END");

        this.emit(`${startLabel}:`);
        this.generateExpression(statement.condition);
        this.jumpIfZeroFar(endLabel);

        // Nested loops work because each loop pushes its own labels.
        this.loopStack.push({
            start: startLabel,
            end: endLabel
        });

        this.generateStatement(statement.body);

        this.loopStack.pop();

        this.emitInstruction(`LJMP ${startLabel}`);
        this.emit(`${endLabel}:`);
    }

    generateExpression(expression) {
        switch (expression.type) {
            case "Literal":
                this.emitInstruction(
                    `MOV A,#${this.hex(expression.value)}`
                );
                return;

            case "Identifier":
                this.emitInstruction(
                    `MOV A,${expression.symbol.asmName}`
                );
                return;

            case "UnaryExpression":
                this.generateUnary(expression);
                return;

            case "BinaryExpression":
                this.generateBinary(expression);
                return;

            default:
                throw new CompileError(
                    `Cannot generate expression "${expression.type}".`
                );
        }
    }

    generateUnary(expression) {
        this.generateExpression(expression.argument);

        switch (expression.operator) {
            case "!":
                this.generateLogicalNot();
                return;

            case "~":
                this.emitInstruction("CPL A");
                return;

            case "-":
                // Two's-complement negation: -x == (~x) + 1 for 8-bit values.
                this.emitInstruction("CPL A");
                this.emitInstruction("INC A");
                return;

            default:
                throw new CompileError(
                    `Unsupported unary operator "${expression.operator}".`
                );
        }
    }

    generateBinary(expression) {
        // Logical operators are emitted separately because C++ requires
        // short-circuit evaluation.
        if (expression.operator === "&&") {
            this.generateLogicalAnd(expression);
            return;
        }

        if (expression.operator === "||") {
            this.generateLogicalOr(expression);
            return;
        }

        this.generateExpression(expression.left);
        this.pushAccumulator();

        this.generateExpression(expression.right);
        this.popIntoB();

        switch (expression.operator) {
            case "+":
                this.emitInstruction("ADD A,B");
                return;

            case "-":
                // Current state is A=right, B=left. Swap first so SUBB computes
                // left - right. CLR C prevents an old carry from affecting it.
                this.emitInstruction("XCH A,B");
                this.emitInstruction("CLR C");
                this.emitInstruction("SUBB A,B");
                return;

            case "*":
                // MUL AB computes A*B. Low 8 bits remain in A.
                this.emitInstruction("MUL AB");
                return;

            case "/":
                this.generateDivision(false);
                return;

            case "%":
                this.generateDivision(true);
                return;

            case "&":
                this.emitInstruction("ANL A,B");
                return;

            case "|":
                this.emitInstruction("ORL A,B");
                return;

            case "^":
                this.emitInstruction("XRL A,B");
                return;

            case "<<":
                this.generateShift(true);
                return;

            case ">>":
                this.generateShift(false);
                return;

            case "==":
            case "!=":
            case "<":
            case "<=":
            case ">":
            case ">=":
                this.generateComparison(expression.operator);
                return;

            default:
                throw new CompileError(
                    `Unsupported operator "${expression.operator}".`
                );
        }
    }

    generateLogicalAnd(expression) {
        const falseLabel = this.newLabel("AND_FALSE");
        const endLabel = this.newLabel("AND_END");

        this.generateExpression(expression.left);

        // If the left operand is zero, C++ must not evaluate the right operand.
        this.emitInstruction(`JZ ${falseLabel}`);

        this.generateExpression(expression.right);
        this.normalizeBoolean();
        this.emitInstruction(`LJMP ${endLabel}`);

        this.emit(`${falseLabel}:`);
        this.emitInstruction("MOV A,#00H");
        this.emit(`${endLabel}:`);
    }

    generateLogicalOr(expression) {
        const trueLabel = this.newLabel("OR_TRUE");
        const endLabel = this.newLabel("OR_END");

        this.generateExpression(expression.left);

        // If the left operand is non-zero, C++ must not evaluate the right side.
        this.emitInstruction(`JNZ ${trueLabel}`);

        this.generateExpression(expression.right);
        this.normalizeBoolean();
        this.emitInstruction(`LJMP ${endLabel}`);

        this.emit(`${trueLabel}:`);
        this.emitInstruction("MOV A,#01H");
        this.emit(`${endLabel}:`);
    }

    generateLogicalNot() {
        const trueLabel = this.newLabel("NOT_TRUE");
        const endLabel = this.newLabel("NOT_END");

        this.emitInstruction(`JZ ${trueLabel}`);
        this.emitInstruction("MOV A,#00H");
        this.emitInstruction(`LJMP ${endLabel}`);

        this.emit(`${trueLabel}:`);
        this.emitInstruction("MOV A,#01H");

        this.emit(`${endLabel}:`);
    }

    normalizeBoolean() {
        const trueLabel = this.newLabel("BOOL_TRUE");
        const endLabel = this.newLabel("BOOL_END");

        this.emitInstruction(`JNZ ${trueLabel}`);
        this.emitInstruction("MOV A,#00H");
        this.emitInstruction(`LJMP ${endLabel}`);

        this.emit(`${trueLabel}:`);
        this.emitInstruction("MOV A,#01H");

        this.emit(`${endLabel}:`);
    }

    generateDivision(returnRemainder) {
        const divideLabel = this.newLabel("DIV_NONZERO");
        const endLabel = this.newLabel("DIV_END");

        // Entry: A=right/divisor, B=left/dividend.
        // DIV AB expects A=dividend and B=divisor.
        this.emitInstruction("XCH A,B");

        // Preserve the dividend in R7 while testing whether the divisor is zero.
        this.emitInstruction("MOV R7,A");
        this.emitInstruction("MOV A,B");
        this.emitInstruction(`JNZ ${divideLabel}`);

        // This project defines division/modulo by zero as 0 plus a warning.
        this.emitInstruction("MOV A,#00H");
        this.emitInstruction(`LJMP ${endLabel}`);

        this.emit(`${divideLabel}:`);
        this.emitInstruction("MOV A,R7");
        this.emitInstruction("DIV AB");

        if (returnRemainder) {
            // After DIV AB: quotient=A, remainder=B.
            this.emitInstruction("MOV A,B");
        }

        this.emit(`${endLabel}:`);
    }

    generateShift(leftShift) {
        const zeroLabel = this.newLabel("SHIFT_ZERO");
        const loopLabel = this.newLabel("SHIFT_LOOP");
        const endLabel = this.newLabel("SHIFT_END");

        // Entry: A=shift count, B=value.
        this.emitInstruction("MOV R7,A");
        this.emitInstruction("MOV A,B");
        this.emitInstruction("MOV R6,A");

        // A zero shift must return the original value unchanged.
        this.emitInstruction("MOV A,R7");
        this.emitInstruction(`JZ ${zeroLabel}`);
        this.emitInstruction("MOV A,R6");

        this.emit(`${loopLabel}:`);

        // Clearing carry makes RLC/RRC behave like logical 8-bit shifts rather
        // than circular rotations through carry.
        this.emitInstruction("CLR C");
        this.emitInstruction(leftShift ? "RLC A" : "RRC A");
        this.emitInstruction(`DJNZ R7,${loopLabel}`);
        this.emitInstruction(`LJMP ${endLabel}`);

        this.emit(`${zeroLabel}:`);
        this.emitInstruction("MOV A,R6");

        this.emit(`${endLabel}:`);
    }

    generateComparison(operator) {
        const trueLabel = this.newLabel("CMP_TRUE");
        const falseLabel = this.newLabel("CMP_FALSE");
        const unequalLabel = this.newLabel("CMP_UNEQUAL");
        const endLabel = this.newLabel("CMP_END");

        // Entry is A=right, B=left. CJNE A,B compares the first operand in A,
        // so swap them to obtain A=left, B=right.
        this.emitInstruction("XCH A,B");

        switch (operator) {
            case "==":
                this.emitInstruction(`CJNE A,B,${falseLabel}`);
                this.emitInstruction(`LJMP ${trueLabel}`);
                break;

            case "!=":
                this.emitInstruction(`CJNE A,B,${trueLabel}`);
                this.emitInstruction(`LJMP ${falseLabel}`);
                break;

            case "<":
                this.emitInstruction(`CJNE A,B,${unequalLabel}`);
                this.emitInstruction(`LJMP ${falseLabel}`);
                this.emit(`${unequalLabel}:`);
                this.emitInstruction(`JC ${trueLabel}`);
                this.emitInstruction(`LJMP ${falseLabel}`);
                break;

            case "<=":
                this.emitInstruction(`CJNE A,B,${unequalLabel}`);
                this.emitInstruction(`LJMP ${trueLabel}`);
                this.emit(`${unequalLabel}:`);
                this.emitInstruction(`JC ${trueLabel}`);
                this.emitInstruction(`LJMP ${falseLabel}`);
                break;

            case ">":
                this.emitInstruction(`CJNE A,B,${unequalLabel}`);
                this.emitInstruction(`LJMP ${falseLabel}`);
                this.emit(`${unequalLabel}:`);
                this.emitInstruction(`JNC ${trueLabel}`);
                this.emitInstruction(`LJMP ${falseLabel}`);
                break;

            case ">=":
                this.emitInstruction(`CJNE A,B,${unequalLabel}`);
                this.emitInstruction(`LJMP ${trueLabel}`);
                this.emit(`${unequalLabel}:`);
                this.emitInstruction(`JNC ${trueLabel}`);
                this.emitInstruction(`LJMP ${falseLabel}`);
                break;

            default:
                throw new CompileError(
                    `Unsupported comparison "${operator}".`
                );
        }

        this.emit(`${trueLabel}:`);
        this.emitInstruction("MOV A,#01H");
        this.emitInstruction(`LJMP ${endLabel}`);

        this.emit(`${falseLabel}:`);
        this.emitInstruction("MOV A,#00H");

        this.emit(`${endLabel}:`);
    }

    jumpIfZeroFar(targetLabel) {
        const nonZeroLabel = this.newLabel("CONDITION_TRUE");

        // JZ/JNZ are short relative branches on the 8051. Jump to a nearby
        // helper label first, then use LJMP for the potentially distant target.
        this.emitInstruction(`JNZ ${nonZeroLabel}`);
        this.emitInstruction(`LJMP ${targetLabel}`);
        this.emit(`${nonZeroLabel}:`);
    }

    pushAccumulator() {
        this.emitInstruction("PUSH ACC");
        this.currentStackDepth += 1;

        this.maximumStackDepth = Math.max(
            this.maximumStackDepth,
            this.currentStackDepth
        );
    }

    popIntoB() {
        this.emitInstruction("POP B");
        this.currentStackDepth -= 1;

        if (this.currentStackDepth < 0) {
            throw new CompileError(
                "Internal compiler stack accounting error."
            );
        }
    }

    emit(line) {
        this.lines.push(line);
    }

    emitInstruction(instruction) {
        this.lines.push(`    ${instruction}`);
        this.instructionCount += 1;
    }

    newLabel(prefix) {
        const label = `${prefix}_${this.labelCounter}`;
        this.labelCounter += 1;
        return label;
    }

    hex(value) {
        return (
            value
                .toString(16)
                .toUpperCase()
                .padStart(2, "0") + "H"
        );
    }
}
