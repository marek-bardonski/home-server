#pragma once
#include <Arduino.h>

class CO2Sensor {
private:
    const int pwmPin;
    unsigned long lastReadTime;
    int co2Level;
    bool readingStarted;

    // Interrupt measurement variables
    static volatile unsigned long pulseStartTime;
    static volatile unsigned long lastPulseWidth;
    static volatile unsigned long lastPulseTotal;
    static volatile bool pulseComplete;
    static CO2Sensor* instance;  // Singleton instance for ISR

    static void pulseISR();

public:
    CO2Sensor(int pin);
    bool begin();
    bool isTimeToRead() const;
    int readPWM();

    // Constants
    static const unsigned long PWM_CYCLE_MICROS = 1004000; // 1004ms cycle
    static const unsigned long MIN_HIGH_MICROS = 2000;     // 2ms minimum
    static const unsigned long MAX_HIGH_MICROS = 902000;   // 902ms maximum
};
