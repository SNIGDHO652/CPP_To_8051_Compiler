# Understanding the Tomasulo Integration

This document explains the new architecture layer in C++51 from first principles.

## 1. Why Tomasulo is not directly "added to the 8051"

Tomasulo's algorithm is normally implemented in CPU hardware. It needs concepts such as:

- multiple functional units
- reservation stations
- producer tags
- register renaming
- out-of-order execution
- result broadcasting

A classic 8051 does not contain this hardware.

Therefore C++51 uses Tomasulo as a **simulation and analysis layer over compiler IR**. The compiler still emits ordinary sequential 8051 assembly.

That distinction is the most important thing to say in a viva or interview.

## 2. Why the AST is not enough

An AST keeps source structure:

```text
       +
      / \
     a   *
        / \
       b   c
```

For scheduling we want explicit operations:

```text
I0: MUL t0, b, c
I1: ADD t1, a, t0
```

Now the compiler can immediately see:

```text
I0 -> I1
```

because `I1` reads `t0`, which `I0` writes.

That is why `src/ir/ir-generator.js` exists.

## 3. Hazard types

### RAW — Read After Write

```text
I0: ADD t0, a, b
I1: MUL t1, t0, c
```

`I1` must wait for `I0`.

This is a true dependency.

### WAR — Write After Read

```text
I0: MOV t0, a
I1: MOV a, 5
```

If `I1` moved before `I0`, `I0` could read the wrong `a`.

This is a name dependency.

### WAW — Write After Write

```text
I0: MOV a, 1
I1: MOV a, 2
```

The writes must appear in the correct architectural order unless renaming separates them.

This is also a name dependency.

## 4. Basic blocks

A basic block is straight-line code with one entry and no internal branch target.

Example:

```text
LABEL LOOP
ADD ...
MUL ...
JZ EXIT
```

The `ADD` and `MUL` can be analyzed together.

The compiler never schedules across `JZ`, `JMP`, `RETURN`, labels, or hardware-port writes.

## 5. Static scheduler vs Tomasulo

They are related but not identical.

### Static scheduler

Runs at compile time:

```text
IR -> dependency graph -> legal reordered IR
```

The compiler makes the decision before execution.

### Tomasulo simulator

Models runtime hardware:

```text
issue -> reservation station -> wait for tags -> execute -> broadcast
```

The simulated processor makes progress dynamically as operands and stations become available.

The project includes both specifically so you can explain the difference.

## 6. Reservation stations

A station might contain:

```text
Name = Add1
Op   = ADD
Vj   = a
Vk   = -
Qj   = -
Qk   = Load2
Dest = t0
```

Meaning:

- operand J is ready
- operand K is not ready
- `Load2` will produce operand K
- the ADD will produce `t0`

When `Load2` broadcasts, `Qk` is cleared and the value becomes ready.

## 7. Register renaming

Suppose an instruction will produce `t3`.

At issue:

```text
registerStatus[t3] = Mul1
```

Any later consumer of `t3` records:

```text
Qj = Mul1
```

instead of waiting on the name `t3` directly.

If a newer instruction later writes the same architectural name, the rename table is replaced by the newer producer.

When an older station writes back, it only clears the table if it is still the latest producer.

That behavior prevents an older WAW result from incorrectly replacing a newer rename.

## 8. Simulator cycle order

Each simulated cycle performs:

```text
1. Write back one previously completed result.
2. Advance all ready executing stations.
3. Issue at most one new instruction.
4. Save a snapshot for the UI.
```

Execution begins no earlier than the cycle after issue.

Only one result writes on the simulated Common Data Bus per cycle.

## 9. Why the simulation is per block

A compiler generally cannot know this at compile time:

```cpp
while (P1 != 0) {
    ...
}
```

The value of `P1` is a hardware input.

The compiler therefore cannot claim a fixed dynamic execution trace.

Instead, C++51 asks:

> “If this straight-line basic block executes, how could a Tomasulo-style machine schedule its instructions?”

That is a useful and technically defensible question.

## 10. Files to read in order

For learning, read these files in this sequence:

```text
src/compiler.js
src/ir/ir.js
src/ir/ir-generator.js
src/tomasulo/dependency-analyzer.js
src/scheduler/instruction-scheduler.js
src/tomasulo/simulator.js
src/ui.js
```

Then compare them with:

```text
src/codegen.js
```

The contrast between the hypothetical out-of-order IR machine and the real sequential 8051 backend is the central architectural idea of the project.
