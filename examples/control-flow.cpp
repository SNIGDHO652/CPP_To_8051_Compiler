#include <stdint.h>

// Demonstrates while, continue, break and comparisons.
int main() {
    uint8_t value = 0;

    while (value < 20) {
        value++;

        if (value == 5) {
            continue;
        }

        P1 = value;

        if (value >= 10) {
            break;
        }
    }

    return 0;
}
