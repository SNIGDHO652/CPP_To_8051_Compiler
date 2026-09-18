import test from "node:test";
import assert from "node:assert/strict";

import { compileCpp51 } from "../src/compiler.js";

function compileSchedulingExample() {
    return compileCpp51(`
        int main() {
            uint8_t a = 2;
            uint8_t b = 3;
            uint8_t sum = a + b;
            uint8_t product = a * b;
            uint8_t result = sum + product;
            P1 = result;
            return 0;
        }
    `);
}

test("IR lowering creates explicit three-address operations", () => {
    const result = compileSchedulingExample();

    assert.ok(result.ir.some((instruction) => instruction.op === "ADD"));
    assert.ok(result.ir.some((instruction) => instruction.op === "MUL"));
    assert.ok(
        result.ir.some((instruction) => instruction.op === "PORT_WRITE")
    );

    const add = result.ir.find((instruction) => instruction.op === "ADD");

    assert.equal(add.args.length, 2);
    assert.equal(add.dest.kind, "temporary");
});

test("dependency analysis detects RAW hazards", () => {
    const result = compileSchedulingExample();

    const rawEdges = result.dependencyGraph.edges.filter(
        (edge) => edge.type === "RAW"
    );

    assert.ok(rawEdges.length > 0);

    const add = result.ir.find((instruction) => instruction.op === "ADD");
    const addDependencies = rawEdges.filter((edge) => edge.to === add.id);

    assert.equal(addDependencies.length, 2);
});

test("dependency analysis also exposes WAR and WAW name hazards", () => {
    const result = compileCpp51(`
        int main() {
            uint8_t a = 1;
            uint8_t b = a;
            a = 2;
            P1 = b;
            return 0;
        }
    `);

    assert.ok(
        result.dependencyGraph.edges.some((edge) => edge.type === "WAR")
    );

    assert.ok(
        result.dependencyGraph.edges.some((edge) => edge.type === "WAW")
    );
});

test("static scheduler can prioritize an independent multiply", () => {
    const result = compileSchedulingExample();

    const originalAddIndex = result.ir.findIndex(
        (instruction) => instruction.op === "ADD"
    );
    const originalMulIndex = result.ir.findIndex(
        (instruction) => instruction.op === "MUL"
    );

    const scheduledAddIndex = result.scheduledIr.findIndex(
        (instruction) => instruction.op === "ADD"
    );
    const scheduledMulIndex = result.scheduledIr.findIndex(
        (instruction) => instruction.op === "MUL"
    );

    assert.ok(originalAddIndex < originalMulIndex);
    assert.ok(scheduledMulIndex < scheduledAddIndex);
});

test("port writes remain explicit scheduling barriers", () => {
    const result = compileSchedulingExample();
    const portIndex = result.scheduledIr.findIndex(
        (instruction) => instruction.op === "PORT_WRITE"
    );
    const returnIndex = result.scheduledIr.findIndex(
        (instruction) => instruction.op === "RETURN"
    );

    assert.ok(portIndex >= 0);
    assert.ok(returnIndex > portIndex);
});

test("Tomasulo simulation records issue execute and writeback cycles", () => {
    const result = compileSchedulingExample();
    const multiplyTiming = result.tomasulo.timings.find(
        (timing) => timing.instruction.includes("MUL")
    );

    assert.ok(multiplyTiming);
    assert.ok(multiplyTiming.issue >= 1);
    assert.ok(multiplyTiming.executeStart > multiplyTiming.issue);
    assert.equal(
        multiplyTiming.executeEnd - multiplyTiming.executeStart + 1,
        4
    );
    assert.ok(multiplyTiming.write > multiplyTiming.executeEnd);
});

test("Tomasulo snapshots expose reservation stations and rename state", () => {
    const result = compileSchedulingExample();

    assert.ok(result.tomasulo.snapshots.length > 0);

    const snapshotWithBusyStation = result.tomasulo.snapshots.find(
        (snapshot) => snapshot.stations.some((station) => station.busy)
    );

    assert.ok(snapshotWithBusyStation);
    assert.ok(snapshotWithBusyStation.registerStatus.length > 0);
});

test("logical AND lowers to branch-based short-circuit IR", () => {
    const result = compileCpp51(`
        int main() {
            uint8_t a = 1;
            uint8_t b = 2;
            uint8_t c = a && b;
            P1 = c;
            return 0;
        }
    `);

    const ops = result.ir.map((instruction) => instruction.op);

    assert.ok(ops.includes("JZ"));
    assert.ok(ops.includes("LABEL"));
    assert.ok(ops.includes("JMP"));
});
