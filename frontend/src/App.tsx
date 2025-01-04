import React, { useEffect, useState } from 'react';
import {
  Layout,
  Card,
  Typography,
  TimePicker,
  Button,
  Space,
  Progress,
  Alert,
  Switch,
  Grid,
  Message
} from '@arco-design/web-react';
import { IconSync, IconExclamationCircle } from '@arco-design/web-react/icon';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import axios from 'axios';
import dayjs, { Dayjs } from 'dayjs';

const { Content } = Layout;
const { Title, Text } = Typography;
const { Row, Col } = Grid;

interface DeviceStatus {
  id: number;
  last_seen: string;
  error_code?: string;
  co2_level: number;
  temperature: number;
  alarm_active: boolean;
  alarm_active_time: number;
}

interface AlarmTime {
  time: string;
  armed: boolean;
}

interface SensorData {
  timestamp: string;
  co2_level: number;
  temperature: number;
}

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8080';
const UPDATE_INTERVAL = 300; // 5 minutes in seconds

function App() {
  const [deviceStatus, setDeviceStatus] = useState<DeviceStatus | null>(null);
  const [alarmTime, setAlarmTime] = useState<AlarmTime | null>(null);
  const [newAlarmTime, setNewAlarmTime] = useState<string>('');
  const [sensorData, setSensorData] = useState<SensorData[]>([]);
  const [progress, setProgress] = useState(100);
  const [lastUpdateTime, setLastUpdateTime] = useState<Date | null>(null);
  const [timePickerValue, setTimePickerValue] = useState<Dayjs | undefined>(
    alarmTime?.time ? dayjs(alarmTime.time, 'HH:mm') : undefined
  );

  const fetchDeviceStatus = async () => {
    try {
      const response = await axios.get(`${API_URL}/api/device/status`);
      setDeviceStatus(response.data);
      setLastUpdateTime(new Date(response.data.last_seen));
    } catch (error) {
      console.error('Error fetching device status:', error);
    }
  };

  const fetchAlarmTime = async () => {
    try {
      const response = await axios.get(`${API_URL}/api/alarm`);
      setAlarmTime(response.data);
    } catch (error) {
      console.error('Error fetching alarm time:', error);
    }
  };

  const fetchSensorData = async () => {
    try {
      const response = await axios.get(`${API_URL}/api/sensor-data`);
      setSensorData(response.data);
    } catch (error) {
      console.error('Error fetching sensor data:', error);
    }
  };

  const updateAlarmTime = async (timeToSet: string) => {
    try {
      await axios.post(`${API_URL}/api/alarm`, { time: timeToSet });
      await fetchAlarmTime();
      window.alert('Alarm time updated successfully');
    } catch (error) {
      console.error('Error updating alarm time:', error);
      window.alert('Failed to update alarm time');
      // Reset the time picker value to the previous valid state
      if (alarmTime?.time) {
        setTimePickerValue(dayjs(alarmTime.time, 'HH:mm'));
      }
    }
  };

  const toggleAlarmArmed = async (armed: boolean) => {
    try {
      await axios.post(`${API_URL}/api/alarm/arm`, { armed });
      fetchAlarmTime();
    } catch (error) {
      console.error('Error toggling alarm:', error);
    }
  };

  useEffect(() => {
    fetchDeviceStatus();
    fetchAlarmTime();
    fetchSensorData();

    const interval = setInterval(() => {
      fetchDeviceStatus();
      fetchSensorData();
    }, 30000); // Refresh every 30 seconds

    return () => clearInterval(interval);
  }, []);

  // Update progress bar
  useEffect(() => {
    if (!lastUpdateTime) return;

    const updateProgress = () => {
      const now = new Date();
      const diff = (now.getTime() - lastUpdateTime.getTime()) / 1000;
      const newProgress = Math.max(0, 100 - (diff / UPDATE_INTERVAL) * 100);
      setProgress(newProgress);
    };

    const interval = setInterval(updateProgress, 1000);
    updateProgress();

    return () => clearInterval(interval);
  }, [lastUpdateTime]);

  // Update timePickerValue when alarmTime changes
  useEffect(() => {
    if (alarmTime?.time) {
      setTimePickerValue(dayjs(alarmTime.time, 'HH:mm'));
    }
  }, [alarmTime]);

  const isUpdateOverdue = progress === 0;

  return (
    <Layout style={{ minHeight: '100vh', padding: '20px' }}>
      <Content>
        <Title heading={2}>Home Server Dashboard</Title>

        <Space direction="vertical" size="large" style={{ width: '100%', display: 'flex' }}>
          {/* Device Status Card */}
          <Card title="Device Status">
            {deviceStatus ? (
              <Space direction="vertical" style={{ width: '100%' }}>
                <Text>Last Seen: {new Date(deviceStatus.last_seen).toLocaleString()}</Text>
                <Progress
                  percent={progress}
                  status={isUpdateOverdue ? 'error' : 'normal'}
                  formatText={() => `${Math.round(progress)}%`}
                  animation
                />
                {deviceStatus.error_code && (
                  <Alert
                    type="error"
                    content={deviceStatus.error_code}
                    icon={<IconExclamationCircle />}
                  />
                )}
                {deviceStatus.alarm_active && (
                  <Alert
                    type="warning"
                    title="Alarm Active"
                    content={`Active for ${deviceStatus.alarm_active_time} seconds`}
                    icon={<IconExclamationCircle />}
                  />
                )}
              </Space>
            ) : (
              <Text>No device status available</Text>
            )}
          </Card>

          {/* Alarm Settings Card */}
          <Card title="Alarm Settings">
            <Space direction="vertical" size="large">
              <Space>
                <TimePicker
                  format="HH:mm"
                  value={timePickerValue}
                  onChange={(valueString: string, time: Dayjs) => {
                    if (!time) return;
                    const newTime = time.format('HH:mm');
                    setTimePickerValue(time);
                    // Use Promise.resolve to ensure we're not blocking the render
                    Promise.resolve().then(() => {
                      updateAlarmTime(newTime);
                    });
                  }}
                />
              </Space>
              <Space>
                <Text>Alarm Armed:</Text>
                <Switch
                  checked={alarmTime?.armed}
                  onChange={toggleAlarmArmed}
                />
              </Space>
            </Space>
          </Card>

          {/* Sensor Data Charts */}
          <Row gutter={[16, 16]}>
            <Col span={12}>
              <Card title="CO2 Levels">
                <div style={{ width: '100%', height: 300 }}>
                  <ResponsiveContainer>
                    <LineChart data={sensorData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="timestamp" />
                      <YAxis />
                      <Tooltip />
                      <Line type="monotone" dataKey="co2_level" stroke="#8884d8" />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </Card>
            </Col>
            <Col span={12}>
              <Card title="Temperature">
                <div style={{ width: '100%', height: 300 }}>
                  <ResponsiveContainer>
                    <LineChart data={sensorData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="timestamp" />
                      <YAxis />
                      <Tooltip />
                      <Line type="monotone" dataKey="temperature" stroke="#82ca9d" />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </Card>
            </Col>
          </Row>
        </Space>
      </Content>
    </Layout>
  );
}

export default App;
