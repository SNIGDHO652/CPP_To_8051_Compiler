import { CompileError } from "./errors.js";

/**
 * Small optimization pass: constant folding.
 *
 * If both operands are compile-time literals, the compiler computes the result
 * now instead of emitting runtime instructions.
 *
 * Example:
 *   uint8_t x = 2 + 3 * 4;
 *
 * becomes an AST equivalent to:
 *   uint8_t x = 14;
 *
 * This pass intentionally does not perform aggressive optimizations. Keeping it
 * small makes the transformation easy to explain in interviews and tests.
 */
export class ConstantFolder {
    foldProgram(program) {
        return {
            ...program,
            body: this.foldStatement(program.body)
        };
    }

    foldStatement(statement) {
        switch (statement.type) {
            case "VariableDeclaration":
                return {
                    ...statement,
                    initializer: this.foldExpression(statement.initializer)
                };

            case "AssignmentStatement":
                return {
                    ...statement,
                    value: this.foldExpression(statement.value)
                };

            case "IfStatement":
                return {
                    ...statement,
                    condition: this.foldExpression(statement.condition),
                    consequent: this.foldStatement(statement.consequent),
                    alternate: statement.alternate
                        ? this.foldStatement(statement.alternate)
                        : null
                };

            case "WhileStatement":
                return {
                    ...statement,
                    condition: this.foldExpression(statement.condition),
                    body: this.foldStatement(statement.body)
                };

            case "ReturnStatement":
                return {
                    ...statement,
                    value: this.foldExpression(statement.value)
                };

            case "BlockStatement":
                return {
                    ...statement,
                    statements: statement.statements.map((child) =>
                        this.foldStatement(child)
                    )
                };

            default:
                return { ...statement };
        }
    }

    foldExpression(expression) {
        if (
            expression.type === "Literal" ||
            expression.type === "Identifier"
        ) {
            return { ...expression };
        }

        if (expression.type === "UnaryExpression") {
            const argument = this.foldExpression(expression.argument);

            if (argument.type === "Literal") {
                return {
                    type: "Literal",
                    value: this.evaluateUnary(
                        expression.operator,
                        argument.value
                    ),
                    token: expression.token
                };
            }

            return {
                ...expression,
                argument
            };
        }

        if (expression.type === "BinaryExpression") {
            const left = this.foldExpression(expression.left);
            const right = this.foldExpression(expression.right);

            if (left.type === "Literal" && right.type === "Literal") {
                return {
                    type: "Literal",
                    value: this.evaluateBinary(
                        expression.operator,
                        left.value,
                        right.value
                    ),
                    token: expression.token
                };
            }

            return {
                ...expression,
                left,
                right
            };
        }

        return expression;
    }

    evaluateUnary(operator, value) {
        switch (operator) {
            case "!":
                return value === 0 ? 1 : 0;

            case "~":
                return (~value) & 0xff;

            case "-":
                return (-value) & 0xff;

            default:
                throw new CompileError(
                    `Unsupported unary operator "${operator}".`
                );
        }
    }

    evaluateBinary(operator, left, right) {
        switch (operator) {
            case "+":
                return (left + right) & 0xff;

            case "-":
                return (left - right) & 0xff;

            case "*":
                return (left * right) & 0xff;

            case "/":
                return right === 0
                    ? 0
                    : Math.floor(left / right) & 0xff;

            case "%":
                return right === 0 ? 0 : left % right;

            case "&":
                return left & right;

            case "|":
                return left | right;

            case "^":
                return left ^ right;

            case "<<":
                return right >= 8
                    ? 0
                    : (left << right) & 0xff;

            case ">>":
                return right >= 8
                    ? 0
                    : left >> right;

            case "==":
                return left === right ? 1 : 0;

            case "!=":
                return left !== right ? 1 : 0;

            case "<":
                return left < right ? 1 : 0;

            case "<=":
                return left <= right ? 1 : 0;

            case ">":
                return left > right ? 1 : 0;

            case ">=":
                return left >= right ? 1 : 0;

            case "&&":
                return left !== 0 && right !== 0 ? 1 : 0;

            case "||":
                return left !== 0 || right !== 0 ? 1 : 0;

            default:
                throw new CompileError(
                    `Unsupported binary operator "${operator}".`
                );
        }
    }
}
