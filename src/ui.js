import { compileCpp51 } from "./compiler.js";

const sourceEditor = document.getElementById("sourceEditor");
const assemblyOutput = document.getElementById("assemblyOutput");
const astOutput = document.getElementById("astOutput");
const tokensOutput = document.getElementById("tokensOutput");
const symbolsOutput = document.getElementById("symbolsOutput");
const diagnosticsOutput = document.getElementById("diagnosticsOutput");
const statusElement = document.getElementById("status");

const lineCount = document.getElementById("lineCount");
const tokenCount = document.getElementById("tokenCount");
const variableCount = document.getElementById("variableCount");
const instructionCount = document.getElementById("instructionCount");
const stackDepth = document.getElementById("stackDepth");

const exampleProgram = `#include <stdint.h>

// C++51 supports an intentionally small, documented subset of C++.
int main() {
    uint8_t counter = 0;
    uint8_t limit = 10;
    unsigned char mask = 0x55;

    while (counter < limit) {
        P1 = counter ^ mask;
        counter++;
    }

    if (P1 != 0) {
        P2 = 255;
    } else {
        P2 = 0;
    }

    return 0;
}
`;

/**
 * Runs the entire compiler and updates every inspection panel.
 *
 * The UI deliberately exposes intermediate compiler data instead of only the
 * final assembly so this app can also be used as a learning/debugging tool.
 */
function compileEditor() {
    const source = sourceEditor.value;
    updateLineCount();

    try {
        const result = compileCpp51(source);

        assemblyOutput.textContent = result.assembly;

        astOutput.textContent = JSON.stringify(
            result.optimizedAst,
            astJsonReplacer,
            2
        );

        tokensOutput.textContent = formatTokens(result.tokens);
        symbolsOutput.textContent = formatSymbols(result.symbols);
        diagnosticsOutput.textContent = formatDiagnostics(result.warnings);

        tokenCount.textContent = String(
            Math.max(0, result.tokens.length - 1)
        );
        variableCount.textContent = String(result.symbols.length);
        instructionCount.textContent = String(result.instructionCount);
        stackDepth.textContent = String(result.maximumStackDepth);

        statusElement.textContent = "Compilation successful.";
        statusElement.className = "status success";

        activateTab("assembly");
    } catch (error) {
        assemblyOutput.textContent = "; Compilation failed.";
        astOutput.textContent = "";
        tokensOutput.textContent = "";
        symbolsOutput.textContent = "";

        diagnosticsOutput.textContent =
            error instanceof Error
                ? `COMPILATION ERROR\n\n${error.message}`
                : String(error);

        tokenCount.textContent = "0";
        variableCount.textContent = "0";
        instructionCount.textContent = "0";
        stackDepth.textContent = "0";

        statusElement.textContent =
            error instanceof Error ? error.message : "Compilation failed.";
        statusElement.className = "status error";

        activateTab("diagnostics");
    }
}

/**
 * Removes bulky token metadata from the AST display while preserving resolved
 * symbol information that is useful for understanding semantic analysis.
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
    if (warnings.length === 0) {
        return [
            "SUCCESS",
            "",
            "No compiler errors or warnings.",
            "",
            "Target: Intel 8051",
            "Integer model: unsigned 8-bit",
            "Variable RAM: 30H-6FH",
            "Expression stack: 70H-7FH"
        ].join("\n");
    }

    return [
        "SUCCESS WITH WARNINGS",
        "",
        ...warnings.map(
            (warning, index) => `${index + 1}. ${warning}`
        )
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
        sourceEditor.value = "";
        assemblyOutput.textContent = "";
        astOutput.textContent = "";
        tokensOutput.textContent = "";
        symbolsOutput.textContent = "";
        diagnosticsOutput.textContent = "";

        tokenCount.textContent = "0";
        variableCount.textContent = "0";
        instructionCount.textContent = "0";
        stackDepth.textContent = "0";

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

    // Make the textarea feel more like a code editor.
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
