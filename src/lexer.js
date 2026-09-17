import { CompileError } from "./errors.js";

/**
 * Turns C++ source text into a flat sequence of tokens.
 *
 * Example:
 *   uint8_t x = 10;
 *
 * becomes roughly:
 *   uint8_t, IDENTIFIER(x), =, NUMBER(10), ;
 *
 * Keeping lexing separate from parsing makes the compiler easier to debug:
 * the Tokens tab shows exactly what the parser receives.
 */
export class Lexer {
    constructor(source) {
        this.source = source;
        this.index = 0;
        this.line = 1;
        this.column = 1;
        this.tokens = [];
    }

    tokenize() {
        while (!this.isAtEnd()) {
            this.scanToken();
        }

        this.tokens.push({
            type: "EOF",
            lexeme: "",
            value: null,
            line: this.line,
            column: this.column
        });

        return this.tokens;
    }

    scanToken() {
        const character = this.peek();

        if (this.isWhitespace(character)) {
            this.consumeWhitespace();
            return;
        }

        // Preprocessor support is intentionally simple: directives are ignored
        // because this educational compiler does not implement a preprocessor.
        if (character === "#") {
            this.consumePreprocessorDirective();
            return;
        }

        if (character === "/" && this.peekNext() === "/") {
            this.consumeLineComment();
            return;
        }

        if (character === "/" && this.peekNext() === "*") {
            this.consumeBlockComment();
            return;
        }

        if (this.isDigit(character)) {
            this.scanNumber();
            return;
        }

        if (this.isIdentifierStart(character)) {
            this.scanIdentifier();
            return;
        }

        this.scanOperator();
    }

    scanNumber() {
        const startIndex = this.index;
        const line = this.line;
        const column = this.column;

        let value;

        if (
            this.peek() === "0" &&
            (this.peekNext() === "x" || this.peekNext() === "X")
        ) {
            this.advance();
            this.advance();

            const hexStart = this.index;

            while (this.isHexDigit(this.peek())) {
                this.advance();
            }

            if (hexStart === this.index) {
                throw new CompileError(
                    "Expected hexadecimal digits after 0x.",
                    { line, column }
                );
            }

            value = Number.parseInt(
                this.source.slice(hexStart, this.index),
                16
            );
        } else {
            while (this.isDigit(this.peek())) {
                this.advance();
            }

            value = Number.parseInt(
                this.source.slice(startIndex, this.index),
                10
            );
        }

        // The target language model is deliberately 8-bit.
        if (!Number.isInteger(value) || value < 0 || value > 255) {
            throw new CompileError(
                "This C++ subset supports integer literals from 0 to 255.",
                { line, column }
            );
        }

        this.tokens.push({
            type: "NUMBER",
            lexeme: this.source.slice(startIndex, this.index),
            value,
            line,
            column
        });
    }

    scanIdentifier() {
        const startIndex = this.index;
        const line = this.line;
        const column = this.column;

        while (this.isIdentifierPart(this.peek())) {
            this.advance();
        }

        const lexeme = this.source.slice(startIndex, this.index);

        const keywords = new Set([
            "unsigned",
            "char",
            "uint8_t",
            "int",
            "if",
            "else",
            "while",
            "break",
            "continue",
            "return",
            "true",
            "false"
        ]);

        this.tokens.push({
            type: keywords.has(lexeme) ? lexeme : "IDENTIFIER",
            lexeme,
            value: null,
            line,
            column
        });
    }

    scanOperator() {
        const line = this.line;
        const column = this.column;

        const pair = this.peek() + this.peekNext();

        const twoCharacterOperators = new Set([
            "==",
            "!=",
            "<=",
            ">=",
            "&&",
            "||",
            "++",
            "--",
            "<<",
            ">>"
        ]);

        if (twoCharacterOperators.has(pair)) {
            this.advance();
            this.advance();

            this.tokens.push({
                type: pair,
                lexeme: pair,
                value: null,
                line,
                column
            });
            return;
        }

        const character = this.peek();

        const singleCharacterTokens = new Set([
            "+",
            "-",
            "*",
            "/",
            "%",
            "&",
            "|",
            "^",
            "~",
            "!",
            "<",
            ">",
            "=",
            ";",
            "(",
            ")",
            "{",
            "}"
        ]);

        if (singleCharacterTokens.has(character)) {
            this.advance();

            this.tokens.push({
                type: character,
                lexeme: character,
                value: null,
                line,
                column
            });
            return;
        }

        throw new CompileError(
            `Unsupported character "${character}". ` +
                "Only the documented C++ subset is accepted.",
            { line, column }
        );
    }

    consumePreprocessorDirective() {
        while (!this.isAtEnd() && this.peek() !== "\n") {
            this.advance();
        }
    }

    consumeWhitespace() {
        while (this.isWhitespace(this.peek())) {
            this.advance();
        }
    }

    consumeLineComment() {
        while (!this.isAtEnd() && this.peek() !== "\n") {
            this.advance();
        }
    }

    consumeBlockComment() {
        const start = {
            line: this.line,
            column: this.column
        };

        this.advance();
        this.advance();

        while (!this.isAtEnd()) {
            if (this.peek() === "*" && this.peekNext() === "/") {
                this.advance();
                this.advance();
                return;
            }

            this.advance();
        }

        throw new CompileError("Unterminated block comment.", start);
    }

    advance() {
        const character = this.source[this.index++];

        if (character === "\n") {
            this.line += 1;
            this.column = 1;
        } else {
            this.column += 1;
        }

        return character;
    }

    peek() {
        return this.source[this.index] ?? "\0";
    }

    peekNext() {
        return this.source[this.index + 1] ?? "\0";
    }

    isAtEnd() {
        return this.index >= this.source.length;
    }

    isWhitespace(character) {
        return (
            character === " " ||
            character === "\t" ||
            character === "\r" ||
            character === "\n"
        );
    }

    isDigit(character) {
        return character >= "0" && character <= "9";
    }

    isHexDigit(character) {
        return /^[0-9a-fA-F]$/.test(character);
    }

    isIdentifierStart(character) {
        return /^[A-Za-z_]$/.test(character);
    }

    isIdentifierPart(character) {
        return /^[A-Za-z0-9_]$/.test(character);
    }
}
