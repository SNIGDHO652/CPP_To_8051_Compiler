import { compileCpp51 } from "./compiler.js";
import { formatInstruction } from "./ir/ir.js";

const sourceEditor = document.getElementById("sourceEditor");
const assemblyOutput = document.getElementById("assemblyOutput");
const irOutput = document.getElementById("irOutput");
const scheduleOutput = document.getElementById("scheduleOutput");
const dependenciesOutput = document.getElementById("dependenciesOutput");
const tomasuloOutput = document.getElementById("tomasuloOutput");
const astOutput = document.getElementById("astOutput");
const tokensOutput = document.getElementById("tokensOutput");
const symbolsOutput = document.getElementById("symbolsOutput");
const diagnosticsOutput = document.getElementById("diagnosticsOutput");
const statusElement = document.getElementById("status");
const cyclePosition = document.getElementById("cyclePosition");

const lineCount = document.getElementById("lineCount");
const tokenCount = document.getElementById("tokenCount");
const variableCount = document.getElementById("variableCount");
const irCount = document.getElementById("irCount");
const instructionCount = document.getElementById("instructionCount");
const stackDepth = document.getElementById("stackDepth");
const tomasuloCycles = document.getElementById("tomasuloCycles");

let latestResult = null;
let currentSnapshotIndex = 0;

const exampleProgram = `#include <stdint.h>

// The independent ADD and MUL make instruction-level parallelism visible.
int main() {
    uint8_t a = 2;
    uint8_t b = 3;

    uint8_t sum = a + b;
    uint8_t product = a * b;
    uint8_t result = sum + product;

    P1 = result;

    if (result > 5) {
        P2 = 0xAA;
    } else {
        P2 = 0x55;
    }

    return 0;
}
`;

/**
 * Runs every compiler phase and refreshes all inspection views.
 *
 * Exposing intermediate data is intentional. A compiler is easier to learn
 * when you can inspect what changed after each phase instead of seeing only the
 * final assembly.
 */
function compileEditor() {
    const source = sourceEditor.value;
    updateLineCount();

    try {
        latestResult = compileCpp51(source);
        currentSnapshotIndex = 0;

        assemblyOutput.textContent = latestResult.assembly;

        irOutput.textContent = latestResult.ir
            .map(formatInstruction)
            .join("\n");

        scheduleOutput.textContent = formatSchedule(
            latestResult.scheduleReport
        );

        dependenciesOutput.textContent = formatDependencies(
            latestResult.dependencyGraph
        );

        astOutput.textContent = JSON.stringify(
            latestResult.optimizedAst,
            astJsonReplacer,
            2
        );

        tokensOutput.textContent = formatTokens(latestResult.tokens);
        symbolsOutput.textContent = formatSymbols(latestResult.symbols);
        diagnosticsOutput.textContent = formatDiagnostics(
            latestResult.warnings
        );

        tokenCount.textContent = String(
            Math.max(0, latestResult.tokens.length - 1)
        );
        variableCount.textContent = String(latestResult.symbols.length);
        irCount.textContent = String(latestResult.ir.length);
        instructionCount.textContent = String(
            latestResult.instructionCount
        );
        stackDepth.textContent = String(
            latestResult.maximumStackDepth
        );
        tomasuloCycles.textContent = String(
            latestResult.tomasulo.blocks.reduce(
                (sum, block) => sum + block.cycles,
                0
            )
        );

        renderTomasuloSnapshot();

        setStatus(
            "Compilation and Tomasulo analysis completed successfully.",
            "success"
        );

        activateTab("assembly");
    } catch (error) {
        latestResult = null;
        currentSnapshotIndex = 0;

        assemblyOutput.textContent = "; Compilation failed.";
        irOutput.textContent = "";
        scheduleOutput.textContent = "";
        dependenciesOutput.textContent = "";
        tomasuloOutput.textContent = "";
        astOutput.textContent = "";
        tokensOutput.textContent = "";
        symbolsOutput.textContent = "";

        diagnosticsOutput.textContent =
            error instanceof Error
                ? `COMPILATION ERROR\n\n${error.message}`
                : String(error);

        tokenCount.textContent = "0";
        variableCount.textContent = "0";
        irCount.textContent = "0";
        instructionCount.textContent = "0";
        stackDepth.textContent = "0";
        tomasuloCycles.textContent = "0";
        cyclePosition.textContent = "No simulation";

        setStatus(
            error instanceof Error ? error.message : "Compilation failed.",
            "error"
        );

        activateTab("diagnostics");
    }
}

/**
 * The AST contains source-location tokens and resolved symbol objects. The UI
 * hides repetitive token metadata while keeping symbol information that helps
 * explain semantic analysis.
 */
function astJsonReplacer(key, value) {
    if (key === "token") {
        return undefined;
    }

    if (key === "symbol" && value) {
        return {
            kind: value.kind,
            sourceName: value.name,
            dataType: value.dataType ?? null,
            assemblyName: value.asmName,
            address:
                value.address === null
                    ? null
                    : `0x${value.address
                        .toString(16)
                        .toUpperCase()
                        .padStart(2, "0")}`,
            scopeDepth: value.scopeDepth
        };
    }

    return value;
}

function formatSchedule(reports) {
    if (reports.length === 0) {
        return "No basic blocks to schedule.";
    }

    const sections = [
        "STATIC BASIC-BLOCK SCHEDULE",
        "",
        "This is compile-time scheduling, not hardware Tomasulo.",
        "Branches, labels, returns and port writes are scheduling barriers.",
        ""
    ];

    for (const report of reports) {
        sections.push(
            `BLOCK ${report.blockId} — ${
                report.changed ? "REORDERED" : "UNCHANGED"
            }`,
            "-".repeat(72),
            "Original:",
            ...report.original.map((line) => `  ${line}`),
            "",
            "Scheduled:",
            ...report.scheduled.map((line) => `  ${line}`),
            ""
        );
    }

    return sections.join("\n");
}

function formatDependencies(graph) {
    if (graph.edges.length === 0) {
        return [
            "DEPENDENCY GRAPH",
            "",
            "No RAW/WAR/WAW hazards were found.",
            "",
            "RAW = Read After Write  (true data dependency)",
            "WAR = Write After Read  (name dependency)",
            "WAW = Write After Write (name dependency)"
        ].join("\n");
    }

    const lines = [
        "DEPENDENCY GRAPH",
        "",
        "RAW = Read After Write  (true dependency)",
        "WAR = Write After Read  (name dependency)",
        "WAW = Write After Write (name dependency)",
        "",
        "BLOCK  TYPE  FROM -> TO   LOGICAL VALUE",
        "-".repeat(72)
    ];

    for (const edge of graph.edges) {
        lines.push(
            [
                String(edge.blockId).padEnd(7),
                edge.type.padEnd(6),
                `${edge.from} -> ${edge.to}`.padEnd(13),
                edge.register
            ].join("")
        );
    }

    return lines.join("\n");
}

function renderTomasuloSnapshot() {
    if (!latestResult) {
        tomasuloOutput.textContent = "";
        cyclePosition.textContent = "No simulation";
        return;
    }

    const simulation = latestResult.tomasulo;
    const snapshots = simulation.snapshots;

    if (snapshots.length === 0) {
        tomasuloOutput.textContent =
            "No schedulable instructions were available for Tomasulo analysis.";
        cyclePosition.textContent = "No cycles";
        return;
    }

    currentSnapshotIndex = Math.max(
        0,
        Math.min(currentSnapshotIndex, snapshots.length - 1)
    );

    const snapshot = snapshots[currentSnapshotIndex];

    cyclePosition.textContent =
        `Snapshot ${currentSnapshotIndex + 1}/${snapshots.length} · ` +
        `Block ${snapshot.blockId} · Cycle ${snapshot.cycle}`;

    tomasuloOutput.textContent = formatTomasulo(
        simulation,
        snapshot
    );
}

function formatTomasulo(simulation, snapshot) {
    const lines = [
        "TOMASULO ANALYSIS",
        "",
        "Model: hypothetical out-of-order machine over compiler IR.",
        "The real Intel 8051 remains an in-order sequential target.",
        "",
        "TIMING TABLE",
        "-".repeat(108),
        [
            "BLOCK".padEnd(7),
            "IR".padEnd(7),
            "STATION".padEnd(10),
            "ISSUE".padEnd(8),
            "EXEC START".padEnd(12),
            "EXEC END".padEnd(10),
            "WRITE".padEnd(8),
            "INSTRUCTION"
        ].join("")
    ];

    for (const timing of simulation.timings) {
        lines.push(
            [
                String(timing.blockId).padEnd(7),
                timing.instructionId.padEnd(7),
                String(timing.station ?? "-").padEnd(10),
                String(timing.issue ?? "-").padEnd(8),
                String(timing.executeStart ?? "-").padEnd(12),
                String(timing.executeEnd ?? "-").padEnd(10),
                String(timing.write ?? "-").padEnd(8),
                timing.instruction
            ].join("")
        );
    }

    lines.push(
        "",
        `CURRENT SNAPSHOT — BLOCK ${snapshot.blockId}, CYCLE ${snapshot.cycle}`,
        "-".repeat(108),
        "Events:",
        ...(snapshot.events.length > 0
            ? snapshot.events.map((event) => `  • ${event}`)
            : ["  • No issue/execute/writeback event this cycle."]),
        "",
        "Reservation stations:",
        [
            "NAME".padEnd(8),
            "BUSY".padEnd(7),
            "OP".padEnd(7),
            "IR".padEnd(7),
            "Vj".padEnd(16),
            "Vk".padEnd(16),
            "Qj".padEnd(10),
            "Qk".padEnd(10),
            "DEST".padEnd(18),
            "LEFT"
        ].join(""),
        "-".repeat(108)
    );

    for (const station of snapshot.stations) {
        lines.push(
            [
                station.name.padEnd(8),
                String(station.busy ? "yes" : "no").padEnd(7),
                String(station.op).padEnd(7),
                String(station.instructionId).padEnd(7),
                String(station.vj).padEnd(16),
                String(station.vk).padEnd(16),
                String(station.qj).padEnd(10),
                String(station.qk).padEnd(10),
                String(station.destination).padEnd(18),
                String(station.remaining)
            ].join("")
        );
    }

    lines.push(
        "",
        "Register-status / rename table:",
        "LOGICAL VALUE".padEnd(28) + "PRODUCER",
        "-".repeat(48)
    );

    if (snapshot.registerStatus.length === 0) {
        lines.push("(empty)");
    } else {
        for (const entry of snapshot.registerStatus) {
            lines.push(
                entry.register.padEnd(28) +
                entry.producer
            );
        }
    }

    return lines.join("\n");
}

function formatTokens(tokens) {
    return tokens
        .map((token) => {
            const location = `${token.line}:${token.column}`.padEnd(10);
            const type = token.type.padEnd(16);
            const lexeme = JSON.stringify(token.lexeme);
            const value =
                token.value === null ? "" : ` value=${token.value}`;

            return location + type + lexeme + value;
        })
        .join("\n");
}

function formatSymbols(symbols) {
    if (symbols.length === 0) {
        return "No user variables were allocated.";
    }

    const header = [
        "SOURCE NAME".padEnd(18),
        "TYPE".padEnd(18),
        "ASM SYMBOL".padEnd(24),
        "RAM".padEnd(8),
        "SCOPE"
    ].join("");

    const separator = "-".repeat(76);

    const rows = symbols.map((symbol) => {
        const address =
            `${symbol.address
                .toString(16)
                .toUpperCase()
                .padStart(2, "0")}H`;

        return [
            symbol.name.padEnd(18),
            symbol.dataType.padEnd(18),
            symbol.asmName.padEnd(24),
            address.padEnd(8),
            String(symbol.scopeDepth)
        ].join("");
    });

    return [header, separator, ...rows].join("\n");
}

function formatDiagnostics(warnings) {
    const tomasuloNote = [
        "",
        "Tomasulo note:",
        "The reservation-station simulator is an analysis model.",
        "It is not a claim that an Intel 8051 executes out of order."
    ];

    if (warnings.length === 0) {
        return [
            "SUCCESS",
            "",
            "No compiler errors or warnings.",
            "",
            "Target: Intel 8051",
            "Integer model: unsigned 8-bit",
            "Variable RAM: 30H-6FH",
            "Expression stack: 70H-7FH",
            ...tomasuloNote
        ].join("\n");
    }

    return [
        "SUCCESS WITH WARNINGS",
        "",
        ...warnings.map(
            (warning, index) => `${index + 1}. ${warning}`
        ),
        ...tomasuloNote
    ].join("\n");
}

function updateLineCount() {
    const source = sourceEditor.value;

    lineCount.textContent =
        source.length === 0
            ? "0"
            : String(source.split("\n").length);
}

function activateTab(tabName) {
    document.querySelectorAll(".tab-button").forEach((button) => {
        button.classList.toggle(
            "active",
            button.dataset.tab === tabName
        );
    });

    document.querySelectorAll(".tab-content").forEach((content) => {
        content.classList.remove("active");
    });

    document.getElementById(`${tabName}Tab`)?.classList.add("active");
}

async function copyAssembly() {
    const assembly = assemblyOutput.textContent;

    if (!assembly || assembly === "; Compilation failed.") {
        setStatus("Compile the C++ program first.", "error");
        return;
    }

    try {
        await navigator.clipboard.writeText(assembly);
        setStatus("Assembly copied to clipboard.", "success");
    } catch {
        setStatus("Clipboard access is unavailable.", "error");
    }
}

function downloadAssembly() {
    const assembly = assemblyOutput.textContent;

    if (!assembly || assembly === "; Compilation failed.") {
        setStatus("Compile the C++ program first.", "error");
        return;
    }

    const blob = new Blob([assembly], {
        type: "text/plain;charset=utf-8"
    });

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = "cpp51-output.asm";

    document.body.appendChild(link);
    link.click();
    link.remove();

    URL.revokeObjectURL(url);
}

function setStatus(message, kind) {
    statusElement.textContent = message;
    statusElement.className = `status ${kind}`;
}

document.getElementById("compileButton").addEventListener(
    "click",
    compileEditor
);

document.getElementById("exampleButton").addEventListener(
    "click",
    () => {
        sourceEditor.value = exampleProgram;
        compileEditor();
    }
);

document.getElementById("clearButton").addEventListener(
    "click",
    () => {
        latestResult = null;
        currentSnapshotIndex = 0;

        sourceEditor.value = "";
        assemblyOutput.textContent = "";
        irOutput.textContent = "";
        scheduleOutput.textContent = "";
        dependenciesOutput.textContent = "";
        tomasuloOutput.textContent = "";
        astOutput.textContent = "";
        tokensOutput.textContent = "";
        symbolsOutput.textContent = "";
        diagnosticsOutput.textContent = "";

        tokenCount.textContent = "0";
        variableCount.textContent = "0";
        irCount.textContent = "0";
        instructionCount.textContent = "0";
        stackDepth.textContent = "0";
        tomasuloCycles.textContent = "0";
        cyclePosition.textContent = "No simulation";

        setStatus("", "");
        updateLineCount();
    }
);

document.getElementById("copyButton").addEventListener(
    "click",
    copyAssembly
);

document.getElementById("downloadButton").addEventListener(
    "click",
    downloadAssembly
);

document.getElementById("previousCycleButton").addEventListener(
    "click",
    () => {
        if (!latestResult) {
            return;
        }

        currentSnapshotIndex -= 1;
        renderTomasuloSnapshot();
    }
);

document.getElementById("nextCycleButton").addEventListener(
    "click",
    () => {
        if (!latestResult) {
            return;
        }

        currentSnapshotIndex += 1;
        renderTomasuloSnapshot();
    }
);

sourceEditor.addEventListener("input", updateLineCount);

sourceEditor.addEventListener("keydown", (event) => {
    if (
        event.key === "Enter" &&
        (event.ctrlKey || event.metaKey)
    ) {
        event.preventDefault();
        compileEditor();
        return;
    }

    // A small quality-of-life feature so the textarea behaves like an editor.
    if (event.key === "Tab") {
        event.preventDefault();

        const start = sourceEditor.selectionStart;
        const end = sourceEditor.selectionEnd;

        sourceEditor.value =
            sourceEditor.value.substring(0, start) +
            "    " +
            sourceEditor.value.substring(end);

        sourceEditor.selectionStart = start + 4;
        sourceEditor.selectionEnd = start + 4;
    }
});

document.querySelectorAll(".tab-button").forEach((button) => {
    button.addEventListener("click", () => {
        activateTab(button.dataset.tab);
    });
});

sourceEditor.value = exampleProgram;
compileEditor();
