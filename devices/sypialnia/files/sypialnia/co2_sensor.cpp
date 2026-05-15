#include "co2_sensor.h"

// Static member initialization
volatile unsigned long CO2Sensor::pulseStartTime = 0;
volatile unsigned long CO2Sensor::lastPulseWidth = 0;
volatile unsigned long CO2Sensor::lastPulseTotal = 0;
volatile bool CO2Sensor::pulseComplete = false;
CO2Sensor* CO2Sensor::instance = nullptr;

// Add debug counters
static volatile unsigned long interruptCount = 0;
static volatile unsigned long risingCount = 0;
static volatile unsigned long fallingCount = 0;
static volatile unsigned long lastPPM = 0;

void CO2Sensor::pulseISR() {
    if (!instance) return; // Prevent null pointer dereference

    interruptCount++;
    if (digitalRead(instance->pwmPin) == HIGH) {
        if (pulseComplete == true) {
            // Enter critical section to atomically update shared state
            noInterrupts();

            //Finishing the pulse
            pulseComplete = false;
            lastPulseTotal = micros() - pulseStartTime;
            if (lastPulseTotal > 900000 && lastPulseTotal < 1100000) {
                lastPPM = 5000 * (lastPulseWidth - 2000) / (lastPulseTotal - 4000);
            } // else ignore the pulse as it's not valid

            interrupts();
        }
        // Rising edge - starting the pulse
        risingCount++;
        pulseStartTime = micros();
    } else {
        // Falling edge - entering the low state
        fallingCount++;
        if (pulseStartTime > 0) {  // Ensure we had a valid start time
            noInterrupts();
            lastPulseWidth = micros() - pulseStartTime;
            pulseComplete = true;
            interrupts();
        }
    }
}

CO2Sensor::CO2Sensor(int pin) : pwmPin(pin), lastReadTime(0), co2Level(0),
    readingStarted(false){
    instance = this;  // Store instance for ISR
}

bool CO2Sensor::begin() {
    pinMode(pwmPin, INPUT);

    // Reset debug counters
    interruptCount = 0;
    risingCount = 0;
    fallingCount = 0;

    // Attach interrupt to both rising and falling edges
    attachInterrupt(digitalPinToInterrupt(pwmPin), pulseISR, CHANGE);

    /* DEBUG
    Serial.print("CO2 sensor initialized on pin ");
    Serial.print(pwmPin);
    Serial.print(" (interrupt ");
    Serial.print(digitalPinToInterrupt(pwmPin));
    Serial.println(")");
    */
    return true;
}

bool CO2Sensor::isTimeToRead() const {
    return (millis() - lastReadTime) >= 5000;
}

int CO2Sensor::readPWM() {
    lastReadTime = millis();

    // Print interrupt statistics
    /* DEBUG
    Serial.print("Entering CO2 Sensor reading procedure\n");
    Serial.print("Interrupt stats - Total: ");
    Serial.print(interruptCount);
    Serial.print(", Rising: ");
    Serial.print(risingCount);
    Serial.print(", Falling: ");
    Serial.print(fallingCount);
    Serial.print(", Last PPM: ");
    Serial.print(lastPPM);
    Serial.print(", Last Pulse Width: ");
    Serial.print(lastPulseWidth);
    Serial.print(", Last Pulse Total: ");
    Serial.println(lastPulseTotal);
    */

    if (lastPPM > 0)
        return lastPPM;
    else
        return -1;
}
