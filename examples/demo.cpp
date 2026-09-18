#include <stdint.h>

// Demonstrates variables, loops, bitwise operations, ports and conditionals.
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
