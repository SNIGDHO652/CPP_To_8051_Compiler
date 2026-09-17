import test from "node:test";
import assert from "node:assert/strict";

import { compileCpp51 } from "../src/compiler.js";

test("constant folding reduces arithmetic to one literal", () => {
    const result = compileCpp51(`
        int main() {
            uint8_t x = 2 + 3 * 4;
            P1 = x;
            return 0;
        }
    `);

    assert.match(result.assembly, /MOV A,#0EH/);
    assert.equal(result.symbols.length, 1);
});

test("while loops and comparisons generate loop labels", () => {
    const result = compileCpp51(`
        int main() {
            uint8_t x = 0;

            while (x < 5) {
                x++;
            }

            return 0;
        }
    `);

    assert.match(result.assembly, /WHILE_START_/);
    assert.match(result.assembly, /CJNE A,B,/);
});

test("block scopes allow variable shadowing", () => {
    const result = compileCpp51(`
        int main() {
            uint8_t value = 1;

            {
                uint8_t value = 2;
                P1 = value;
            }

            P2 = value;
            return 0;
        }
    `);

    assert.equal(result.symbols.length, 2);
    assert.notEqual(
        result.symbols[0].asmName,
        result.symbols[1].asmName
    );
});

test("undeclared identifiers are rejected", () => {
    assert.throws(
        () =>
            compileCpp51(`
                int main() {
                    x = 5;
                    return 0;
                }
            `),
        /Identifier "x" is not declared/
    );
});

test("break outside a loop is rejected", () => {
    assert.throws(
        () =>
            compileCpp51(`
                int main() {
                    break;
                    return 0;
                }
            `),
        /break can only appear inside a while loop/
    );
});

test("8051 ports do not consume user RAM", () => {
    const result = compileCpp51(`
        int main() {
            P1 = 0x55;
            P2 = P1;
            return 0;
        }
    `);

    assert.equal(result.symbols.length, 0);
    assert.match(result.assembly, /MOV P1,A/);
    assert.match(result.assembly, /MOV A,P1/);
});

test("logical AND and OR use short-circuit branches", () => {
    const result = compileCpp51(`
        int main() {
            uint8_t a = 1;
            uint8_t b = 2;
            uint8_t c = a && b;
            uint8_t d = a || b;
            return 0;
        }
    `);

    assert.match(result.assembly, /AND_FALSE_/);
    assert.match(result.assembly, /OR_TRUE_/);
});

test("division by zero emits a warning and safe zero result path", () => {
    const result = compileCpp51(`
        int main() {
            uint8_t x = 10;
            uint8_t y = x / 0;
            return 0;
        }
    `);

    assert.equal(result.warnings.length, 1);
    assert.match(result.warnings[0], /division by zero/);
    assert.match(result.assembly, /DIV_NONZERO_/);
});

test("unsupported int local variables are rejected", () => {
    assert.throws(
        () =>
            compileCpp51(`
                int main() {
                    int x = 1;
                    return 0;
                }
            `),
        /Unsupported statement/
    );
});
