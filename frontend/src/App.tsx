import React, { useEffect, useState } from 'react';
import { Container, Paper, Typography, TextField, Button, Box } from '@mui/material';
import axios from 'axios';

interface DeviceStatus {
  id: number;
  last_seen: string;
  error_code?: string;
}

interface AlarmTime {
  time: string;
}

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8080';

function App() {
  const [deviceStatus, setDeviceStatus] = useState<DeviceStatus | null>(null);
  const [alarmTime, setAlarmTime] = useState<string>('');
  const [newAlarmTime, setNewAlarmTime] = useState<string>('');

  const fetchDeviceStatus = async () => {
    try {
      const response = await axios.get(`${API_URL}/api/device/status`);
      setDeviceStatus(response.data);
    } catch (error) {
      console.error('Error fetching device status:', error);
    }
  };

  const fetchAlarmTime = async () => {
    try {
      const response = await axios.get(`${API_URL}/api/alarm`);
      setAlarmTime(response.data.time || '');
    } catch (error) {
      console.error('Error fetching alarm time:', error);
    }
  };

  const updateAlarmTime = async () => {
    try {
      await axios.post(`${API_URL}/api/alarm`, { time: newAlarmTime });
      setAlarmTime(newAlarmTime);
      setNewAlarmTime('');
    } catch (error) {
      console.error('Error updating alarm time:', error);
    }
  };

  useEffect(() => {
    fetchDeviceStatus();
    fetchAlarmTime();
    const interval = setInterval(() => {
      fetchDeviceStatus();
    }, 30000); // Refresh every 30 seconds

    return () => clearInterval(interval);
  }, []);

  return (
    <Container maxWidth="sm" sx={{ mt: 4 }}>
      <Paper elevation={3} sx={{ p: 3 }}>
        <Typography variant="h4" gutterBottom>
          Home Server Dashboard
        </Typography>

        <Box sx={{ mb: 4 }}>
          <Typography variant="h6" gutterBottom>
            Device Status
          </Typography>
          {deviceStatus ? (
            <>
              <Typography>
                Last Seen: {new Date(deviceStatus.last_seen).toLocaleString()}
              </Typography>
              {deviceStatus.error_code && (
                <Typography color="error">
                  Error Code: {deviceStatus.error_code}
                </Typography>
              )}
            </>
          ) : (
            <Typography>No device status available</Typography>
          )}
        </Box>

        <Box sx={{ mb: 4 }}>
          <Typography variant="h6" gutterBottom>
            Current Alarm Time
          </Typography>
          <Typography>{alarmTime || 'No alarm set'}</Typography>
        </Box>

        <Box>
          <Typography variant="h6" gutterBottom>
            Set New Alarm Time
          </Typography>
          <TextField
            type="time"
            value={newAlarmTime}
            onChange={(e) => setNewAlarmTime(e.target.value)}
            sx={{ mr: 2 }}
          />
          <Button
            variant="contained"
            onClick={updateAlarmTime}
            disabled={!newAlarmTime}
          >
            Set Alarm
          </Button>
        </Box>
      </Paper>
    </Container>
  );
}

export default App;
