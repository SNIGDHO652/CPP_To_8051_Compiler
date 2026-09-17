/**
 * Compiler-specific error type.
 *
 * Every compiler phase throws CompileError when it finds invalid source code.
 * The optional token lets us show the exact line and column to the user.
 */
export class CompileError extends Error {
    constructor(message, token = null) {
        const location = token
            ? `Line ${token.line}, column ${token.column}: `
            : "";

        super(`${location}${message}`);
        this.name = "CompileError";
        this.token = token;
    }
}
