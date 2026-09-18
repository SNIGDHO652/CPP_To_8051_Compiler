import { CompileError } from "./errors.js";

/**
 * Performs semantic analysis after parsing.
 *
 * The parser only knows grammar. This phase answers questions such as:
 * - Was a variable declared before it was used?
 * - Is a name declared twice in the same block?
 * - Is break/continue inside a loop?
 * - Which 8051 RAM address belongs to each variable?
 *
 * It also attaches a resolved `symbol` object to identifier AST nodes.
 * That means the code generator does not need to repeat name lookup.
 */
export class SemanticAnalyzer {
    constructor() {
        this.scopes = [];
        this.allSymbols = [];
        this.nextAddress = 0x30;
        this.loopDepth = 0;
        this.warnings = [];

        // P0-P3 are 8051 Special Function Registers, not user RAM variables.
        this.ports = new Map([
            ["P0", this.createPortSymbol("P0")],
            ["P1", this.createPortSymbol("P1")],
            ["P2", this.createPortSymbol("P2")],
            ["P3", this.createPortSymbol("P3")]
        ]);
    }

    analyze(program) {
        this.visitBlock(program.body);

        return {
            symbols: this.allSymbols,
            warnings: this.warnings
        };
    }

    createPortSymbol(name) {
        return {
            kind: "port",
            name,
            asmName: name,
            address: null,
            scopeDepth: -1
        };
    }

    enterScope() {
        this.scopes.push(new Map());
    }

    leaveScope() {
        this.scopes.pop();
    }

    currentScope() {
        return this.scopes[this.scopes.length - 1];
    }

    visitBlock(block) {
        this.enterScope();

        for (const statement of block.statements) {
            this.visitStatement(statement);
        }

        this.leaveScope();
    }

    visitStatement(statement) {
        switch (statement.type) {
            case "VariableDeclaration":
                this.visitVariableDeclaration(statement);
                return;

            case "AssignmentStatement":
                statement.symbol = this.resolve(
                    statement.name,
                    statement.token
                );
                this.visitExpression(statement.value);
                return;

            case "UpdateStatement":
                statement.symbol = this.resolve(
                    statement.name,
                    statement.token
                );
                return;

            case "IfStatement":
                this.visitExpression(statement.condition);
                this.visitBlock(statement.consequent);

                if (statement.alternate) {
                    this.visitBlock(statement.alternate);
                }
                return;

            case "WhileStatement":
                this.visitExpression(statement.condition);

                this.loopDepth += 1;
                this.visitBlock(statement.body);
                this.loopDepth -= 1;
                return;

            case "BreakStatement":
                if (this.loopDepth === 0) {
                    throw new CompileError(
                        "break can only appear inside a while loop.",
                        statement.token
                    );
                }
                return;

            case "ContinueStatement":
                if (this.loopDepth === 0) {
                    throw new CompileError(
                        "continue can only appear inside a while loop.",
                        statement.token
                    );
                }
                return;

            case "ReturnStatement":
                this.visitExpression(statement.value);
                return;

            case "BlockStatement":
                this.visitBlock(statement);
                return;

            default:
                throw new CompileError(
                    `Unknown AST statement "${statement.type}".`
                );
        }
    }

    visitVariableDeclaration(statement) {
        if (this.ports.has(statement.name)) {
            throw new CompileError(
                `${statement.name} is an 8051 hardware port and cannot be redeclared.`,
                statement.token
            );
        }

        const scope = this.currentScope();

        if (scope.has(statement.name)) {
            throw new CompileError(
                `Variable "${statement.name}" is already declared in this scope.`,
                statement.token
            );
        }

        // 30H-6FH is 64 bytes of directly addressable internal RAM.
        // 70H-7FH is intentionally left free for the hardware stack.
        if (this.nextAddress > 0x6f) {
            throw new CompileError(
                "Internal RAM allocation exceeded 30H-6FH.",
                statement.token
            );
        }

        const address = this.nextAddress++;
        const uniqueIndex = this.allSymbols.length;

        // The generated assembly name is unique even when C++ block scopes
        // contain shadowed variables with the same source name.
        const asmName =
            `V_${this.sanitizeName(statement.name)}_${uniqueIndex}`;

        const symbol = {
            kind: "variable",
            name: statement.name,
            dataType: statement.dataType,
            asmName,
            address,
            scopeDepth: this.scopes.length - 1
        };

        scope.set(statement.name, symbol);
        this.allSymbols.push(symbol);
        statement.symbol = symbol;

        this.visitExpression(statement.initializer);
    }

    visitExpression(expression) {
        switch (expression.type) {
            case "Literal":
                return;

            case "Identifier":
                expression.symbol = this.resolve(
                    expression.name,
                    expression.token
                );
                return;

            case "UnaryExpression":
                this.visitExpression(expression.argument);
                return;

            case "BinaryExpression":
                this.visitExpression(expression.left);
                this.visitExpression(expression.right);
                this.checkWarnings(expression);
                return;

            default:
                throw new CompileError(
                    `Unknown AST expression "${expression.type}".`
                );
        }
    }

    checkWarnings(expression) {
        if (
            (expression.operator === "/" || expression.operator === "%") &&
            expression.right.type === "Literal" &&
            expression.right.value === 0
        ) {
            this.warnings.push(
                `Line ${expression.token.line}: division by zero is compiled as zero by C++51.`
            );
        }

        if (
            (expression.operator === "<<" || expression.operator === ">>") &&
            expression.right.type === "Literal" &&
            expression.right.value >= 8
        ) {
            this.warnings.push(
                `Line ${expression.token.line}: an 8-bit shift count >= 8 produces zero in C++51.`
            );
        }
    }

    resolve(name, token) {
        if (this.ports.has(name)) {
            return this.ports.get(name);
        }

        // Search from innermost block outward. This is ordinary lexical scope
        // resolution and naturally implements local-variable shadowing.
        for (let index = this.scopes.length - 1; index >= 0; index -= 1) {
            const symbol = this.scopes[index].get(name);

            if (symbol) {
                return symbol;
            }
        }

        throw new CompileError(
            `Identifier "${name}" is not declared.`,
            token
        );
    }

    sanitizeName(name) {
        return name
            .replace(/[^A-Za-z0-9_]/g, "_")
            .toUpperCase();
    }
}
