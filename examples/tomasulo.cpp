#include <stdint.h>

// This example contains two independent operations.
// In the Tomasulo tab, ADD and MUL can occupy separate reservation stations.
int main() {
    uint8_t a = 2;
    uint8_t b = 3;

    uint8_t sum = a + b;
    uint8_t product = a * b;

    // This operation depends on both parallel paths.
    uint8_t result = sum + product;

    P1 = result;
    return 0;
}
