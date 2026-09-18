import { Lexer } from "./lexer.js";
import { Parser } from "./parser.js";
import { SemanticAnalyzer } from "./semantic.js";
import { ConstantFolder } from "./optimizer.js";
import { IRGenerator } from "./ir/ir-generator.js";
import { DependencyAnalyzer } from "./tomasulo/dependency-analyzer.js";
import { TomasuloSimulator } from "./tomasulo/simulator.js";
import { InstructionScheduler } from "./scheduler/instruction-scheduler.js";
import { CodeGenerator } from "./codegen.js";

/**
 * Orchestrates the complete compiler pipeline.
 *
 * Keeping orchestration separate from implementation is useful when learning
 * compiler construction: this file reads almost exactly like the architecture
 * diagram in README.md.
 *
 * Pipeline:
 *   source
 *     -> tokens
 *     -> AST
 *     -> semantic analysis
 *     -> optimized AST
 *     -> three-address IR
 *     -> dependency graph
 *     -> Tomasulo simulation + static schedule
 *     -> 8051 assembly
 *
 * Important:
 * Tomasulo is simulated as an architecture-analysis stage. A classic 8051 does
 * not have reservation stations or out-of-order execution. The actual 8051
 * backend therefore still emits correct sequential assembly from the optimized
 * AST. The scheduled IR shows a legal compile-time order for independent work
 * inside basic blocks and is exposed in the UI for study.
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

    // Lower source-like tree structure into explicit three-address operations.
    // This representation makes data dependencies easy to inspect.
    const irGenerator = new IRGenerator();
    const ir = irGenerator.generate(optimizedAst);

    const dependencyAnalyzer = new DependencyAnalyzer();
    const dependencyGraph = dependencyAnalyzer.analyze(ir);

    // Static scheduling is conservative: it only reorders safe operations
    // inside basic blocks and preserves RAW/WAR/WAW dependencies.
    const scheduler = new InstructionScheduler();
    const scheduled = scheduler.schedule(ir, dependencyGraph);

    // Tomasulo is a simulation of a hypothetical out-of-order machine running
    // the same logical IR. It is educational analysis, not an 8051 feature.
    const tomasuloSimulator = new TomasuloSimulator();
    const tomasulo = tomasuloSimulator.run(ir);

    // The real target backend remains sequential 8051 assembly generation.
    const generator = new CodeGenerator(semanticResult.symbols);
    const generated = generator.generate(optimizedAst);

    return {
        tokens,
        ast,
        optimizedAst,
        ir,
        dependencyGraph,
        scheduledIr: scheduled.instructions,
        scheduleReport: scheduled.blocks,
        tomasulo,
        symbols: semanticResult.symbols,
        warnings: semanticResult.warnings,
        assembly: generated.assembly,
        instructionCount: generated.instructionCount,
        maximumStackDepth: generated.maximumStackDepth
    };
}
