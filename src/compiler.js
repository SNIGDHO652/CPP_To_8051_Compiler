import { Lexer } from "./lexer.js";
import { Parser } from "./parser.js";
import { SemanticAnalyzer } from "./semantic.js";
import { ConstantFolder } from "./optimizer.js";
import { CodeGenerator } from "./codegen.js";

/**
 * Orchestrates the complete compiler pipeline.
 *
 * Keeping this file small is useful: it shows the order of compiler phases
 * without mixing their implementation details together.
 */
export function compileCpp51(source) {
    const lexer = new Lexer(source);
    const tokens = lexer.tokenize();

    const parser = new Parser(tokens);
    const ast = parser.parseProgram();

    const semanticAnalyzer = new SemanticAnalyzer();
    const semanticResult = semanticAnalyzer.analyze(ast);

    const optimizer = new ConstantFolder();
    const optimizedAst = optimizer.foldProgram(ast);

    const generator = new CodeGenerator(semanticResult.symbols);
    const generated = generator.generate(optimizedAst);

    return {
        tokens,
        ast,
        optimizedAst,
        symbols: semanticResult.symbols,
        warnings: semanticResult.warnings,
        assembly: generated.assembly,
        instructionCount: generated.instructionCount,
        maximumStackDepth: generated.maximumStackDepth
    };
}
