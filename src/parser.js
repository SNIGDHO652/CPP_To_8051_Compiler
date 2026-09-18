import { CompileError } from "./errors.js";

/**
 * Recursive-descent parser for the supported C++ subset.
 *
 * The parser consumes tokens from the Lexer and builds an Abstract Syntax Tree
 * (AST). Each parsing function corresponds to one grammar level.
 *
 * Expression precedence is implemented by calling the next-tighter parser:
 *
 *   || -> && -> | -> ^ -> & -> equality -> comparison
 *      -> shifts -> + - -> * / % -> unary -> primary
 *
 * This is why `2 + 3 * 4` becomes `2 + (3 * 4)` in the AST.
 */
export class Parser {
    constructor(tokens) {
        this.tokens = tokens;
        this.current = 0;
    }

    parseProgram() {
        this.consume("int", 'Expected "int main()".');

        const mainToken = this.consume(
            "IDENTIFIER",
            'Expected "main" after "int".'
        );

        if (mainToken.lexeme !== "main") {
            throw this.error(
                mainToken,
                "Only the main function is supported."
            );
        }

        this.consume("(", 'Expected "(" after main.');
        this.consume(")", 'Expected ")" after main(.');
        this.consume("{", 'Expected "{" before the main body.');

        const body = this.parseBlockAfterOpeningBrace();

        this.consume(
            "EOF",
            "Only one main function is supported by this compiler."
        );

        return {
            type: "Program",
            returnType: "int",
            body,
            token: mainToken
        };
    }

    parseStatement() {
        if (this.check("uint8_t") || this.check("unsigned")) {
            return this.parseVariableDeclaration();
        }

        if (this.match("if")) {
            return this.parseIfStatement();
        }

        if (this.match("while")) {
            return this.parseWhileStatement();
        }

        if (this.match("break")) {
            const token = this.previous();
            this.consume(";", 'Expected ";" after break.');

            return {
                type: "BreakStatement",
                token
            };
        }

        if (this.match("continue")) {
            const token = this.previous();
            this.consume(";", 'Expected ";" after continue.');

            return {
                type: "ContinueStatement",
                token
            };
        }

        if (this.match("return")) {
            return this.parseReturnStatement();
        }

        if (this.match("{")) {
            return this.parseBlockAfterOpeningBrace();
        }

        if (this.check("IDENTIFIER")) {
            return this.parseIdentifierStatement();
        }

        throw this.error(
            this.peek(),
            `Unsupported statement beginning with "${this.peek().lexeme}".`
        );
    }

    parseVariableDeclaration() {
        let dataType;

        if (this.match("uint8_t")) {
            dataType = "uint8_t";
        } else {
            this.consume("unsigned", 'Expected "unsigned char".');
            this.consume("char", 'Only "unsigned char" is supported.');
            dataType = "unsigned char";
        }

        const nameToken = this.consume(
            "IDENTIFIER",
            "Expected a variable name."
        );

        // Requiring an initializer keeps the small language unambiguous and
        // avoids pretending to model C++'s uninitialized-value behavior.
        this.consume(
            "=",
            "Variables must have an initializer in this compiler subset."
        );

        const initializer = this.parseExpression();

        this.consume(
            ";",
            'Expected ";" after the variable declaration.'
        );

        return {
            type: "VariableDeclaration",
            dataType,
            name: nameToken.lexeme,
            initializer,
            token: nameToken,
            symbol: null
        };
    }

    parseIdentifierStatement() {
        const nameToken = this.advance();

        if (this.match("=")) {
            const value = this.parseExpression();

            this.consume(";", 'Expected ";" after assignment.');

            return {
                type: "AssignmentStatement",
                name: nameToken.lexeme,
                value,
                token: nameToken,
                symbol: null
            };
        }

        if (this.match("++", "--")) {
            const operator = this.previous().type;

            this.consume(
                ";",
                `Expected ";" after ${operator}.`
            );

            return {
                type: "UpdateStatement",
                name: nameToken.lexeme,
                operator,
                token: nameToken,
                symbol: null
            };
        }

        throw this.error(
            this.peek(),
            'Expected "=", "++", or "--" after the identifier.'
        );
    }

    parseIfStatement() {
        const token = this.previous();

        this.consume("(", 'Expected "(" after if.');
        const condition = this.parseExpression();
        this.consume(")", 'Expected ")" after the if condition.');

        const consequent = this.parseRequiredBlock(
            "Expected a braced block after the if condition."
        );

        let alternate = null;

        if (this.match("else")) {
            alternate = this.parseRequiredBlock(
                "Expected a braced block after else."
            );
        }

        return {
            type: "IfStatement",
            condition,
            consequent,
            alternate,
            token
        };
    }

    parseWhileStatement() {
        const token = this.previous();

        this.consume("(", 'Expected "(" after while.');
        const condition = this.parseExpression();
        this.consume(")", 'Expected ")" after the while condition.');

        const body = this.parseRequiredBlock(
            "Expected a braced block after the while condition."
        );

        return {
            type: "WhileStatement",
            condition,
            body,
            token
        };
    }

    parseReturnStatement() {
        const token = this.previous();
        const value = this.parseExpression();

        this.consume(";", 'Expected ";" after return.');

        return {
            type: "ReturnStatement",
            value,
            token
        };
    }

    parseRequiredBlock(message) {
        this.consume("{", message);
        return this.parseBlockAfterOpeningBrace();
    }

    parseBlockAfterOpeningBrace() {
        const statements = [];

        while (!this.check("}") && !this.check("EOF")) {
            statements.push(this.parseStatement());
        }

        this.consume("}", 'Expected "}" after the block.');

        return {
            type: "BlockStatement",
            statements
        };
    }

    parseExpression() {
        return this.parseLogicalOr();
    }

    parseLogicalOr() {
        return this.parseBinary(
            () => this.parseLogicalAnd(),
            ["||"]
        );
    }

    parseLogicalAnd() {
        return this.parseBinary(
            () => this.parseBitwiseOr(),
            ["&&"]
        );
    }

    parseBitwiseOr() {
        return this.parseBinary(
            () => this.parseBitwiseXor(),
            ["|"]
        );
    }

    parseBitwiseXor() {
        return this.parseBinary(
            () => this.parseBitwiseAnd(),
            ["^"]
        );
    }

    parseBitwiseAnd() {
        return this.parseBinary(
            () => this.parseEquality(),
            ["&"]
        );
    }

    parseEquality() {
        return this.parseBinary(
            () => this.parseComparison(),
            ["==", "!="]
        );
    }

    parseComparison() {
        return this.parseBinary(
            () => this.parseShift(),
            ["<", "<=", ">", ">="]
        );
    }

    parseShift() {
        return this.parseBinary(
            () => this.parseTerm(),
            ["<<", ">>"]
        );
    }

    parseTerm() {
        return this.parseBinary(
            () => this.parseFactor(),
            ["+", "-"]
        );
    }

    parseFactor() {
        return this.parseBinary(
            () => this.parseUnary(),
            ["*", "/", "%"]
        );
    }

    parseUnary() {
        if (this.match("!", "~", "-")) {
            const operatorToken = this.previous();

            return {
                type: "UnaryExpression",
                operator: operatorToken.type,
                argument: this.parseUnary(),
                token: operatorToken
            };
        }

        return this.parsePrimary();
    }

    parsePrimary() {
        if (this.match("NUMBER")) {
            return {
                type: "Literal",
                value: this.previous().value,
                token: this.previous()
            };
        }

        if (this.match("true")) {
            return {
                type: "Literal",
                value: 1,
                token: this.previous()
            };
        }

        if (this.match("false")) {
            return {
                type: "Literal",
                value: 0,
                token: this.previous()
            };
        }

        if (this.match("IDENTIFIER")) {
            return {
                type: "Identifier",
                name: this.previous().lexeme,
                token: this.previous(),
                symbol: null
            };
        }

        if (this.match("(")) {
            const expression = this.parseExpression();
            this.consume(")", 'Expected ")" after the expression.');
            return expression;
        }

        throw this.error(this.peek(), "Expected an expression.");
    }

    /**
     * Builds a left-associative binary-expression chain.
     *
     * For example `a - b - c` becomes `(a - b) - c`.
     */
    parseBinary(nextParser, operators) {
        let expression = nextParser();

        while (this.match(...operators)) {
            const operatorToken = this.previous();
            const right = nextParser();

            expression = {
                type: "BinaryExpression",
                operator: operatorToken.type,
                left: expression,
                right,
                token: operatorToken
            };
        }

        return expression;
    }

    match(...types) {
        for (const type of types) {
            if (this.check(type)) {
                this.advance();
                return true;
            }
        }

        return false;
    }

    check(type) {
        return this.peek().type === type;
    }

    advance() {
        if (!this.check("EOF")) {
            this.current += 1;
        }

        return this.previous();
    }

    previous() {
        return this.tokens[this.current - 1];
    }

    peek() {
        return this.tokens[this.current];
    }

    consume(type, message) {
        if (this.check(type)) {
            return this.advance();
        }

        throw this.error(this.peek(), message);
    }

    error(token, message) {
        return new CompileError(message, token);
    }
}
