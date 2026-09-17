#include <stdint.h>

// Constant folding turns 2 + 3 * 4 into the literal 14 at compile time.
int main() {
    uint8_t folded = 2 + 3 * 4;
    uint8_t runtime = folded * 2;

    P1 = runtime;
    return 0;
}
